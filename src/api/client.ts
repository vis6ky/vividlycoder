import type {
  BackendConfig,
  ChatMessage,
  Conversation,
  CreateProjectPayload,
  HealthResponse,
  OllamaModel,
  Project,
  RestChatRequest,
  RestChatResponse,
} from '../types/vividcoder.ts';

export type ApiErrorCode =
  | 'NETWORK_UNREACHABLE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_URL'
  | 'ABORTED';

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status?: number;
  public readonly details?: string;

  constructor(code: ApiErrorCode, message: string, status?: number, details?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeHttpBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError('INVALID_URL', `Invalid backend URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError('INVALID_URL', 'Backend URL must use http:// or https://');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function normalizeWsBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError('INVALID_URL', `Invalid WebSocket URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new ApiError('INVALID_URL', 'WebSocket URL must use ws:// or wss://');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function deriveWsUrlFromHttp(httpUrl: string): string {
  const normalized = normalizeHttpBaseUrl(httpUrl);
  if (normalized.startsWith('https://')) {
    return 'wss://' + normalized.slice('https://'.length);
  }
  return 'ws://' + normalized.slice('http://'.length);
}

export class VividCoderApiClient {
  private getConfig: () => BackendConfig;

  constructor(getConfig: () => BackendConfig) {
    this.getConfig = getConfig;
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {}
  ): Promise<T> {
    const config = this.getConfig();
    const baseUrl = normalizeHttpBaseUrl(config.apiBaseUrl);
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;

    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        throw new ApiError('ABORTED', 'Request aborted');
      }
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorText = response.statusText;
        try {
          const payload = (await response.json()) as { detail?: string; message?: string };
          if (payload?.detail) errorText = payload.detail;
          else if (payload?.message) errorText = payload.message;
        } catch {
          // Non-JSON error body
        }
        throw new ApiError(
          'HTTP_ERROR',
          `Backend returned HTTP ${response.status}: ${errorText || 'Request failed'}`,
          response.status
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new ApiError('INVALID_JSON', `Invalid JSON response from ${path}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (timedOut) {
          throw new ApiError(
            'TIMEOUT',
            `Request to ${baseUrl} timed out after ${timeoutMs} ms`
          );
        }
        throw new ApiError('ABORTED', 'Request aborted');
      }
      throw new ApiError(
        'NETWORK_UNREACHABLE',
        `Unable to reach local FastAPI backend at ${baseUrl}. Ensure FastAPI is running and CORS allows this origin.`
      );
    } finally {
      globalThis.clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  public checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health', { signal, timeoutMs: 4000 });
  }

  public async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const res = await this.request<{ models: OllamaModel[] } | OllamaModel[]>('/api/models', {
      signal,
      timeoutMs: 6000,
    });
    return Array.isArray(res) ? res : res.models ?? [];
  }

  public async listProjects(signal?: AbortSignal): Promise<Project[]> {
    const res = await this.request<{ projects: Project[] } | Project[]>('/api/projects', { signal });
    return Array.isArray(res) ? res : res.projects ?? [];
  }

  public createProject(payload: CreateProjectPayload, signal?: AbortSignal): Promise<Project> {
    return this.request<Project>('/api/projects', {
      method: 'POST',
      body: payload,
      signal,
    });
  }

  public async listConversations(projectId?: string | null, signal?: AbortSignal): Promise<Conversation[]> {
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    const res = await this.request<{ conversations: Conversation[] } | Conversation[]>(
      `/api/conversations${query}`,
      { signal }
    );
    return Array.isArray(res) ? res : res.conversations ?? [];
  }

  public createConversation(
    payload: { title?: string; projectId?: string | null; model: string },
    signal?: AbortSignal
  ): Promise<Conversation> {
    return this.request<Conversation>('/api/conversations', {
      method: 'POST',
      body: payload,
      signal,
    });
  }

  public deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
      signal,
    });
  }

  public async getConversationMessages(conversationId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
    const res = await this.request<{ messages: ChatMessage[] } | ChatMessage[]>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { signal }
    );
    return Array.isArray(res) ? res : res.messages ?? [];
  }

  public sendChatRest(payload: RestChatRequest, signal?: AbortSignal): Promise<RestChatResponse> {
    return this.request<RestChatResponse>('/api/chat', {
      method: 'POST',
      body: payload,
      signal,
      timeoutMs: 120000,
    });
  }
}
