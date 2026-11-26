import { batch, computed, signal } from '@samrey/reactivity';
import {
  ApiError,
  VividCoderApiClient,
  deriveWsUrlFromHttp,
  normalizeHttpBaseUrl,
  normalizeWsBaseUrl,
} from '../api/client.ts';
import { VividCoderStreamClient } from '../api/ws.ts';
import type {
  ActivityState,
  BackendConfig,
  ChatMessage,
  ConnectionState,
  Conversation,
  CreateProjectPayload,
  HealthResponse,
  MessageRole,
  OllamaModel,
  Project,
  WorkspaceView,
} from '../types/vividcoder.ts';

const CONFIG_STORAGE_KEY = 'vividcoder.backend_config.v1';

const envVars = (import.meta as { env?: Record<string, string | undefined> }).env;

const DEFAULT_CONFIG: BackendConfig = {
  apiBaseUrl: envVars?.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
  wsBaseUrl: envVars?.VITE_WS_BASE_URL || 'ws://127.0.0.1:8000',
  defaultModel: envVars?.VITE_DEFAULT_MODEL || 'qwen3.5:4b',
  temperature: 0.2,
  numCtx: 8192,
  requestTimeoutMs: 10000,
};

function loadInitialConfig(): BackendConfig {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BackendConfig>;
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : DEFAULT_CONFIG.apiBaseUrl,
      wsBaseUrl: typeof parsed.wsBaseUrl === 'string' ? parsed.wsBaseUrl : DEFAULT_CONFIG.wsBaseUrl,
      defaultModel: typeof parsed.defaultModel === 'string' ? parsed.defaultModel : DEFAULT_CONFIG.defaultModel,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_CONFIG.temperature,
      numCtx: typeof parsed.numCtx === 'number' ? parsed.numCtx : DEFAULT_CONFIG.numCtx,
      requestTimeoutMs:
        typeof parsed.requestTimeoutMs === 'number'
          ? parsed.requestTimeoutMs
          : DEFAULT_CONFIG.requestTimeoutMs,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function buildChatHistorySnapshot(
  messages: ChatMessage[],
  nextPrompt?: string
): Array<{ role: MessageRole; content: string }> {
  const sanitized: Array<{ role: MessageRole; content: string }> = [];

  for (const msg of messages) {
    if (!msg.content || !msg.content.trim()) {
      continue;
    }
    if (msg.role === 'assistant' && msg.status === 'error') {
      continue;
    }
    const prev = sanitized[sanitized.length - 1];
    if (prev && prev.role === msg.role && prev.content === msg.content) {
      continue;
    }
    sanitized.push({
      role: msg.role,
      content: msg.content,
    });
  }

  if (nextPrompt !== undefined) {
    const trimmedPrompt = nextPrompt.trim();
    const last = sanitized[sanitized.length - 1];
    if (last && last.role === 'user' && last.content.trim() === trimmedPrompt) {
      sanitized.pop();
    }
  }

  return sanitized;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const initialConfig = loadInitialConfig();

// Reactive Signals
export const configSignal = signal<BackendConfig>(initialConfig);
export const activeViewSignal = signal<WorkspaceView>('chat');
export const sidebarOpenMobileSignal = signal<boolean>(false);

// Health & Connectivity
export const backendStatusSignal = signal<ConnectionState>('idle');
export const ollamaStatusSignal = signal<ConnectionState>('idle');
export const healthInfoSignal = signal<HealthResponse | null>(null);
export const healthErrorSignal = signal<string | null>(null);
export const lastCheckedAtSignal = signal<string | null>(null);

// Models
export const modelsSignal = signal<OllamaModel[]>([]);
export const modelsLoadingSignal = signal<boolean>(false);
export const modelsErrorSignal = signal<string | null>(null);
export const selectedModelSignal = signal<string>(initialConfig.defaultModel);

// Projects
export const projectsSignal = signal<Project[]>([]);
export const projectsLoadingSignal = signal<boolean>(false);
export const projectsErrorSignal = signal<string | null>(null);
export const activeProjectIdSignal = signal<string | null>(null);

// Conversations
export const conversationsSignal = signal<Conversation[]>([]);
export const conversationsLoadingSignal = signal<boolean>(false);
export const conversationsErrorSignal = signal<string | null>(null);
export const activeConversationIdSignal = signal<string | null>(null);
export const historySearchQuerySignal = signal<string>('');

// Messages & Streaming
export const messagesSignal = signal<ChatMessage[]>([]);
export const messagesLoadingSignal = signal<boolean>(false);
export const messagesErrorSignal = signal<string | null>(null);
export const composerDraftSignal = signal<string>('');
export const activityStateSignal = signal<ActivityState>('idle');
export const streamingMessageIdSignal = signal<string | null>(null);
export const streamErrorSignal = signal<string | null>(null);

// Computed derivations
export const activeProjectSignal = computed<Project | null>(() => {
  const id = activeProjectIdSignal.value;
  if (!id) return null;
  return projectsSignal.value.find((p) => p.id === id) ?? null;
});

export const activeConversationSignal = computed<Conversation | null>(() => {
  const id = activeConversationIdSignal.value;
  if (!id) return null;
  return conversationsSignal.value.find((c) => c.id === id) ?? null;
});

export const filteredConversationsSignal = computed<Conversation[]>(() => {
  const q = historySearchQuerySignal.value.trim().toLowerCase();
  const activeProj = activeProjectIdSignal.value;
  const list = conversationsSignal.value;
  return list.filter((conv) => {
    if (activeProj && conv.projectId && conv.projectId !== activeProj) {
      return false;
    }
    if (!q) return true;
    return conv.title.toLowerCase().includes(q) || conv.model.toLowerCase().includes(q);
  });
});

export const isStreamingSignal = computed<boolean>(() => {
  return activityStateSignal.value === 'streaming' || activityStateSignal.value === 'connecting';
});

const apiClient = new VividCoderApiClient(() => configSignal.value);
const streamClient = new VividCoderStreamClient();

let healthAbortController: AbortController | null = null;

export async function refreshConnection(): Promise<void> {
  if (healthAbortController) {
    healthAbortController.abort();
  }
  const controller = new AbortController();
  healthAbortController = controller;

  batch(() => {
    backendStatusSignal.value = 'checking';
    ollamaStatusSignal.value = 'checking';
    healthErrorSignal.value = null;
  });

  try {
    const health = await apiClient.checkHealth(controller.signal);
    batch(() => {
      healthInfoSignal.value = health;
      backendStatusSignal.value = health.backendStatus === 'ok' ? 'connected' : 'error';
      ollamaStatusSignal.value =
        health.ollamaStatus === 'connected'
          ? 'connected'
          : health.ollamaStatus === 'offline'
            ? 'offline'
            : 'error';
      if (health.ollamaStatus !== 'connected' && health.ollamaError) {
        healthErrorSignal.value = health.ollamaError;
      }
      lastCheckedAtSignal.value = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    });

    await Promise.all([
      loadModels(controller.signal),
      loadProjects(controller.signal),
      loadConversations(controller.signal),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ABORTED') return;
    const message =
      err instanceof Error ? err.message : 'Unable to connect to local FastAPI backend.';
    batch(() => {
      healthInfoSignal.value = null;
      backendStatusSignal.value = 'offline';
      ollamaStatusSignal.value = 'offline';
      healthErrorSignal.value = message;
      modelsErrorSignal.value = message;
      projectsErrorSignal.value = message;
      conversationsErrorSignal.value = message;
      lastCheckedAtSignal.value = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    });
  }
}

export async function loadModels(signal?: AbortSignal): Promise<void> {
  modelsLoadingSignal.value = true;
  modelsErrorSignal.value = null;
  try {
    const models = await apiClient.listModels(signal);
    batch(() => {
      modelsSignal.value = models;
      if (models.length > 0 && !models.some((m) => m.name === selectedModelSignal.value)) {
        selectedModelSignal.value = models[0].name;
      }
      modelsLoadingSignal.value = false;
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ABORTED') return;
    batch(() => {
      modelsErrorSignal.value =
        err instanceof Error ? err.message : 'Failed to load Ollama models.';
      modelsLoadingSignal.value = false;
    });
  }
}

export async function loadProjects(signal?: AbortSignal): Promise<void> {
  projectsLoadingSignal.value = true;
  projectsErrorSignal.value = null;
  try {
    const projects = await apiClient.listProjects(signal);
    batch(() => {
      projectsSignal.value = projects;
      projectsLoadingSignal.value = false;
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ABORTED') return;
    batch(() => {
      projectsErrorSignal.value =
        err instanceof Error ? err.message : 'Failed to load local projects.';
      projectsLoadingSignal.value = false;
    });
  }
}

export async function createProject(payload: CreateProjectPayload): Promise<boolean> {
  projectsLoadingSignal.value = true;
  projectsErrorSignal.value = null;
  try {
    const created = await apiClient.createProject(payload);
    batch(() => {
      projectsSignal.value = [created, ...projectsSignal.value];
      activeProjectIdSignal.value = created.id;
      projectsLoadingSignal.value = false;
    });
    return true;
  } catch (err) {
    batch(() => {
      projectsErrorSignal.value =
        err instanceof Error ? err.message : 'Failed to register project.';
      projectsLoadingSignal.value = false;
    });
    return false;
  }
}

export async function loadConversations(signal?: AbortSignal): Promise<void> {
  conversationsLoadingSignal.value = true;
  conversationsErrorSignal.value = null;
  try {
    const list = await apiClient.listConversations(activeProjectIdSignal.value, signal);
    batch(() => {
      conversationsSignal.value = list;
      conversationsLoadingSignal.value = false;
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ABORTED') return;
    batch(() => {
      conversationsErrorSignal.value =
        err instanceof Error ? err.message : 'Failed to load conversation history.';
      conversationsLoadingSignal.value = false;
    });
  }
}

export async function selectConversation(conversationId: string): Promise<void> {
  if (isStreamingSignal.value) {
    stopGeneration();
  }
  batch(() => {
    activeConversationIdSignal.value = conversationId;
    activeViewSignal.value = 'chat';
    sidebarOpenMobileSignal.value = false;
    messagesLoadingSignal.value = true;
    messagesErrorSignal.value = null;
    streamErrorSignal.value = null;
  });

  const existing = conversationsSignal.value.find((c) => c.id === conversationId);
  if (existing?.model) {
    selectedModelSignal.value = existing.model;
  }

  try {
    const msgs = await apiClient.getConversationMessages(conversationId);
    batch(() => {
      messagesSignal.value = msgs;
      messagesLoadingSignal.value = false;
    });
  } catch (err) {
    batch(() => {
      messagesSignal.value = [];
      messagesErrorSignal.value =
        err instanceof Error ? err.message : 'Failed to load messages for this conversation.';
      messagesLoadingSignal.value = false;
    });
  }
}

export function startNewChat(): void {
  if (isStreamingSignal.value) {
    stopGeneration();
  }
  batch(() => {
    activeConversationIdSignal.value = null;
    messagesSignal.value = [];
    messagesErrorSignal.value = null;
    streamErrorSignal.value = null;
    activityStateSignal.value = 'idle';
    activeViewSignal.value = 'chat';
    sidebarOpenMobileSignal.value = false;
  });
}

export function setActiveProject(projectId: string | null): void {
  activeProjectIdSignal.value = projectId;
  if (backendStatusSignal.value === 'connected') {
    void loadConversations();
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  try {
    await apiClient.deleteConversation(conversationId);
    batch(() => {
      conversationsSignal.value = conversationsSignal.value.filter((c) => c.id !== conversationId);
      if (activeConversationIdSignal.value === conversationId) {
        activeConversationIdSignal.value = null;
        messagesSignal.value = [];
      }
    });
  } catch (err) {
    conversationsErrorSignal.value =
      err instanceof Error ? err.message : 'Failed to delete conversation.';
  }
}

export function sendMessage(overridePrompt?: string): void {
  const promptText = (overridePrompt ?? composerDraftSignal.value).trim();
  if (!promptText || isStreamingSignal.value) return;

  const model = selectedModelSignal.value || configSignal.value.defaultModel;
  const projectId = activeProjectIdSignal.value;
  let conversationId = activeConversationIdSignal.value;

  const nowIso = new Date().toISOString();
  const userMessage: ChatMessage = {
    id: createId('msg_u'),
    conversationId: conversationId || 'pending',
    role: 'user',
    content: promptText,
    createdAt: nowIso,
    status: 'complete',
  };

  const assistantMsgId = createId('msg_a');
  const assistantMessage: ChatMessage = {
    id: assistantMsgId,
    conversationId: conversationId || 'pending',
    role: 'assistant',
    content: '',
    model,
    createdAt: nowIso,
    status: 'streaming',
  };

  const isNewConversation = !conversationId;
  if (!conversationId) {
    conversationId = createId('conv');
    userMessage.conversationId = conversationId;
    assistantMessage.conversationId = conversationId;
  }

  const historySnapshot = buildChatHistorySnapshot(messagesSignal.value, promptText);

  batch(() => {
    if (!overridePrompt) {
      composerDraftSignal.value = '';
    }
    activeConversationIdSignal.value = conversationId;
    messagesErrorSignal.value = null;
    streamErrorSignal.value = null;
    activityStateSignal.value = 'connecting';
    streamingMessageIdSignal.value = assistantMsgId;
    messagesSignal.value = [...messagesSignal.value, userMessage, assistantMessage];

    if (isNewConversation) {
      const title = promptText.length > 48 ? `${promptText.slice(0, 48)}...` : promptText;
      const newConv: Conversation = {
        id: conversationId!,
        title,
        projectId,
        model,
        createdAt: nowIso,
        updatedAt: nowIso,
        messageCount: 2,
      };
      conversationsSignal.value = [newConv, ...conversationsSignal.value];
    }
  });

  const cfg = configSignal.value;

  streamClient.startStream(
    cfg.wsBaseUrl,
    {
      type: 'chat.start',
      conversationId,
      projectId,
      model,
      prompt: promptText,
      messages: [...historySnapshot, { role: 'user', content: promptText }],
      options: {
        temperature: cfg.temperature,
        num_ctx: cfg.numCtx,
      },
    },
    {
      onOpen: () => {
        batch(() => {
          activityStateSignal.value = 'streaming';
          backendStatusSignal.value = 'connected';
        });
      },
      onToken: (token) => {
        messagesSignal.value = messagesSignal.value.map((m) =>
          m.id === assistantMsgId ? { ...m, content: m.content + token } : m
        );
      },
      onDone: (meta) => {
        batch(() => {
          activityStateSignal.value = 'idle';
          streamingMessageIdSignal.value = null;
          messagesSignal.value = messagesSignal.value.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'complete',
                  tokenCount: meta.tokenCount,
                  durationMs: meta.durationMs,
                }
              : m
          );
        });
      },
      onStopped: () => {
        batch(() => {
          activityStateSignal.value = 'idle';
          streamingMessageIdSignal.value = null;
          messagesSignal.value = messagesSignal.value.map((m) =>
            m.id === assistantMsgId ? { ...m, status: 'stopped' } : m
          );
        });
      },
      onError: (errMsg, code) => {
        batch(() => {
          activityStateSignal.value = 'error';
          streamingMessageIdSignal.value = null;
          streamErrorSignal.value = errMsg;
          if (
            code === 'WS_CONNECTION_ERROR' ||
            code === 'WS_CONNECT_TIMEOUT' ||
            code === 'WS_INIT_FAILED'
          ) {
            backendStatusSignal.value = 'offline';
          } else if (code === 'RUNTIME_OFFLINE') {
            ollamaStatusSignal.value = 'offline';
          }
          messagesSignal.value = messagesSignal.value.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'error',
                  errorMessage: errMsg,
                }
              : m
          );
        });
      },
    }
  );
}

export function stopGeneration(): void {
  const streamingId = streamingMessageIdSignal.value;
  streamClient.stopGeneration();
  batch(() => {
    activityStateSignal.value = 'idle';
    streamingMessageIdSignal.value = null;
    if (streamingId) {
      messagesSignal.value = messagesSignal.value.map((m) =>
        m.id === streamingId && m.status === 'streaming'
          ? { ...m, status: 'stopped' }
          : m
      );
    }
  });
}

export function retryMessage(failedAssistantMsgId: string): void {
  const list = messagesSignal.value;
  const idx = list.findIndex((m) => m.id === failedAssistantMsgId);
  if (idx <= 0) return;

  let userIdx = -1;
  let userPrompt: string | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (list[i].role === 'user') {
      userIdx = i;
      userPrompt = list[i].content;
      break;
    }
  }
  if (!userPrompt || userIdx === -1) return;

  // Remove specifically the failed assistant message and its preceding user turn
  messagesSignal.value = list.filter((_, i) => i !== idx && i !== userIdx);
  sendMessage(userPrompt);
}

export function saveBackendConfig(next: Partial<BackendConfig>): { ok: boolean; error?: string } {
  const current = configSignal.value;
  const rawApi = next.apiBaseUrl ?? current.apiBaseUrl;
  const rawWs = next.wsBaseUrl ?? deriveWsUrlFromHttp(rawApi);

  try {
    const apiBaseUrl = normalizeHttpBaseUrl(rawApi);
    const wsBaseUrl = normalizeWsBaseUrl(rawWs);
    const merged: BackendConfig = {
      apiBaseUrl,
      wsBaseUrl,
      defaultModel: (next.defaultModel ?? current.defaultModel).trim() || DEFAULT_CONFIG.defaultModel,
      temperature:
        typeof next.temperature === 'number'
          ? Math.min(2, Math.max(0, next.temperature))
          : current.temperature,
      numCtx:
        typeof next.numCtx === 'number'
          ? Math.min(16384, Math.max(4096, Math.round(next.numCtx)))
          : current.numCtx,
      requestTimeoutMs:
        typeof next.requestTimeoutMs === 'number'
          ? Math.min(60000, Math.max(2000, Math.round(next.requestTimeoutMs)))
          : current.requestTimeoutMs,
    };

    configSignal.value = merged;
    selectedModelSignal.value = merged.defaultModel;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(merged));
      }
    } catch {
      // Ignore storage quota errors
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid backend configuration.',
    };
  }
}

export function resetBackendConfig(): void {
  configSignal.value = { ...DEFAULT_CONFIG };
  selectedModelSignal.value = DEFAULT_CONFIG.defaultModel;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(CONFIG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}
