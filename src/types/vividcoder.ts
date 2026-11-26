/**
 * VividCoder Phase 1 Domain Types
 * Frontend: Samrey + TypeScript + Vite
 * Backend: Python 3.12+ + FastAPI + Model-Independent AI Provider (Ollama: Qwen3.5 4B / 9B) + SQLite
 */

export type WorkspaceView = 'chat' | 'projects' | 'settings';

export type ConnectionState = 'idle' | 'checking' | 'connected' | 'offline' | 'error';

export type ActivityState = 'idle' | 'connecting' | 'streaming' | 'loading' | 'error';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'complete' | 'streaming' | 'stopped' | 'error';

export interface BackendConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  defaultModel: string;
  temperature: number;
  numCtx: number;
  requestTimeoutMs: number;
}

export interface HardwareProfile {
  machine?: string;
  memoryGb?: number;
  storageGb?: number;
  maxLoadedModels?: number;
  recommendedContextWindow?: string;
}

export interface HealthResponse {
  backendStatus: 'ok' | 'degraded';
  provider?: string;
  ollamaStatus: 'connected' | 'offline' | 'error';
  ollamaVersion?: string;
  ollamaError?: string;
  sqliteStatus?: 'ok' | 'error';
  activeModel?: string;
  loadedModels?: string[];
  defaultModel?: string;
  evaluationModel?: string;
  hardwareProfile?: HardwareProfile;
}

export interface OllamaModel {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modifiedAt?: string;
  role?: 'default' | 'evaluation' | 'available';
  isLoaded?: boolean;
  memoryEstimateGb?: number;
  fitsIn16Gb?: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  language?: string;
  lastOpenedAt: string;
  fileCount?: number;
}

export interface CreateProjectPayload {
  name: string;
  path: string;
  language?: string;
}

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  model?: string;
  createdAt: string;
  status: MessageStatus;
  errorMessage?: string;
  tokenCount?: number;
  durationMs?: number;
}

export interface RestChatRequest {
  conversationId: string;
  projectId: string | null;
  model: string;
  prompt: string;
  messages: Array<{ role: MessageRole; content: string }>;
  options: {
    temperature: number;
    num_ctx: number;
  };
}

export interface RestChatResponse {
  conversationId: string;
  message: ChatMessage;
}

export interface ChatStartOutboundFrame {
  type: 'chat.start';
  conversationId: string;
  projectId: string | null;
  model: string;
  prompt: string;
  messages: Array<{ role: MessageRole; content: string }>;
  options: {
    temperature: number;
    num_ctx: number;
  };
}

export interface ChatStopOutboundFrame {
  type: 'chat.stop';
  conversationId: string;
}

export type WsOutboundFrame = ChatStartOutboundFrame | ChatStopOutboundFrame;

export type WsInboundFrame =
  | { type: 'chat.started'; messageId?: string; conversationId?: string }
  | { type: 'chat.delta'; token: string; messageId?: string }
  | { type: 'chat.done'; messageId?: string; tokenCount?: number; durationMs?: number }
  | { type: 'chat.stopped'; messageId?: string }
  | { type: 'chat.error'; code?: string; message: string };
