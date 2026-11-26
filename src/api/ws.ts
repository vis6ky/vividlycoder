import type {
  ChatStartOutboundFrame,
  ChatStopOutboundFrame,
  WsInboundFrame,
} from '../types/vividcoder.ts';
import { normalizeWsBaseUrl } from './client.ts';

export interface StreamCallbacks {
  onOpen?: () => void;
  onToken: (token: string, messageId?: string) => void;
  onDone: (meta: { messageId?: string; tokenCount?: number; durationMs?: number }) => void;
  onStopped: (messageId?: string) => void;
  onError: (message: string, code?: string) => void;
}

export class VividCoderStreamClient {
  private socket: WebSocket | null = null;
  private connectTimer: number | null = null;
  private stopTimer: number | null = null;
  private settled = false;
  private stopRequested = false;
  private activeConversationId: string | null = null;

  public startStream(
    wsBaseUrl: string,
    payload: ChatStartOutboundFrame,
    callbacks: StreamCallbacks,
    connectTimeoutMs = 5000
  ): void {
    this.cleanupSocket();
    this.settled = false;
    this.stopRequested = false;
    this.activeConversationId = payload.conversationId;

    let endpoint: string;
    try {
      const normalized = normalizeWsBaseUrl(wsBaseUrl);
      endpoint = `${normalized}/ws/chat`;
    } catch (err) {
      this.settled = true;
      callbacks.onError(
        err instanceof Error ? err.message : 'Invalid WebSocket URL configuration',
        'INVALID_WS_URL'
      );
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      this.settled = true;
      callbacks.onError(
        `Failed to initialize WebSocket connection to ${endpoint}.`,
        'WS_INIT_FAILED'
      );
      return;
    }

    this.socket = ws;

    this.connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING && !this.settled) {
        this.settled = true;
        this.cleanupSocket();
        callbacks.onError(
          `WebSocket connection to ${endpoint} timed out. Ensure local FastAPI is running with WebSocket support.`,
          'WS_CONNECT_TIMEOUT'
        );
      }
    }, connectTimeoutMs);

    ws.addEventListener('open', () => {
      this.clearConnectTimer();
      if (this.stopRequested) {
        this.settled = true;
        this.cleanupSocket();
        return;
      }
      callbacks.onOpen?.();
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        if (!this.settled) {
          this.settled = true;
          this.cleanupSocket();
          callbacks.onError('Failed to send prompt frame over WebSocket.', 'WS_SEND_FAILED');
        }
      }
    });

    ws.addEventListener('message', (event) => {
      let frame: WsInboundFrame;
      try {
        frame = JSON.parse(String(event.data)) as WsInboundFrame;
      } catch {
        return;
      }

      if (this.stopRequested) {
        if (frame.type === 'chat.stopped' || frame.type === 'chat.done' || frame.type === 'chat.error') {
          this.settled = true;
          this.cleanupSocket();
        }
        return;
      }

      if (this.settled) return;

      switch (frame.type) {
        case 'chat.started':
          break;
        case 'chat.delta':
          if (typeof frame.token === 'string') {
            callbacks.onToken(frame.token, frame.messageId);
          }
          break;
        case 'chat.done':
          this.settled = true;
          this.cleanupSocket();
          callbacks.onDone({
            messageId: frame.messageId,
            tokenCount: frame.tokenCount,
            durationMs: frame.durationMs,
          });
          break;
        case 'chat.stopped':
          this.settled = true;
          this.cleanupSocket();
          callbacks.onStopped(frame.messageId);
          break;
        case 'chat.error':
          this.settled = true;
          this.cleanupSocket();
          callbacks.onError(frame.message || 'Backend streaming error', frame.code);
          break;
      }
    });

    ws.addEventListener('error', () => {
      if (this.settled || this.stopRequested) {
        this.settled = true;
        this.cleanupSocket();
        return;
      }
      this.settled = true;
      this.cleanupSocket();
      callbacks.onError(
        `WebSocket unreachable at ${endpoint}. Start your local FastAPI server and verify Ollama is running.`,
        'WS_CONNECTION_ERROR'
      );
    });

    ws.addEventListener('close', (event) => {
      this.clearConnectTimer();
      this.clearStopTimer();
      if (!this.settled && !this.stopRequested) {
        this.settled = true;
        this.socket = null;
        if (event.code === 1000) {
          callbacks.onStopped();
        } else {
          callbacks.onError(
            `WebSocket closed unexpectedly (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
            'WS_CLOSED_UNEXPECTEDLY'
          );
        }
      } else {
        this.settled = true;
        this.socket = null;
      }
    });
  }

  public stopGeneration(): void {
    const ws = this.socket;
    if (!ws) return;

    this.stopRequested = true;

    if (ws.readyState === WebSocket.OPEN && this.activeConversationId) {
      const stopFrame: ChatStopOutboundFrame = {
        type: 'chat.stop',
        conversationId: this.activeConversationId,
      };
      try {
        ws.send(JSON.stringify(stopFrame));
        this.clearStopTimer();
        this.stopTimer = window.setTimeout(() => {
          if (!this.settled) {
            this.settled = true;
            this.cleanupSocket();
          }
        }, 750);
        return;
      } catch {
        // Fallback to immediate cleanup
      }
    }

    if (!this.settled) {
      this.settled = true;
      this.cleanupSocket();
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private cleanupSocket(): void {
    this.clearConnectTimer();
    this.clearStopTimer();
    const ws = this.socket;
    this.socket = null;
    this.activeConversationId = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'Client finished');
      } catch {
        // Ignore close errors
      }
    }
  }
}
