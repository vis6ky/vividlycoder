import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ApiError,
  VividCoderApiClient,
  deriveWsUrlFromHttp,
  normalizeHttpBaseUrl,
  normalizeWsBaseUrl,
} from '../src/api/client.ts';
import { VividCoderStreamClient } from '../src/api/ws.ts';
import {
  buildChatHistorySnapshot,
  configSignal,
  messagesSignal,
  resetBackendConfig,
  saveBackendConfig,
  selectedModelSignal,
} from '../src/store/workspaceStore.ts';
import type { BackendConfig, ChatMessage } from '../src/types/vividcoder.ts';
import { parseInlineSpans, parseMarkdownBlocks } from '../src/utils/markdown.ts';

describe('VividCoder API Client Abstraction', () => {
  const baseConfig: BackendConfig = {
    apiBaseUrl: 'http://127.0.0.1:8000',
    wsBaseUrl: 'ws://127.0.0.1:8000',
    defaultModel: 'qwen3.5:4b',
    temperature: 0.2,
    numCtx: 8192,
    requestTimeoutMs: 5000,
  };

  it('normalizes HTTP/WS URLs and rejects invalid schemes', () => {
    assert.equal(normalizeHttpBaseUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
    assert.equal(normalizeWsBaseUrl('ws://127.0.0.1:8000/'), 'ws://127.0.0.1:8000');
    assert.equal(deriveWsUrlFromHttp('http://127.0.0.1:8000'), 'ws://127.0.0.1:8000');
    assert.equal(deriveWsUrlFromHttp('https://local.test'), 'wss://local.test');
    assert.throws(() => normalizeHttpBaseUrl('ftp://127.0.0.1:8000'), ApiError);
    assert.throws(() => normalizeWsBaseUrl('http://127.0.0.1:8000'), ApiError);
  });

  it('parses health, models, and REST chat responses via fetch', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/health')) {
          return new Response(
            JSON.stringify({
              backendStatus: 'ok',
              provider: 'ollama',
              ollamaStatus: 'connected',
              defaultModel: 'qwen3.5:4b',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/api/models')) {
          return new Response(
            JSON.stringify({ models: [{ name: 'qwen3.5:4b', role: 'default' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/api/chat')) {
          return new Response(
            JSON.stringify({
              conversationId: 'conv_1',
              message: {
                id: 'msg_1',
                conversationId: 'conv_1',
                role: 'assistant',
                content: 'ok',
                createdAt: '2026-11-26T00:00:00Z',
                status: 'complete',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
      }) as typeof fetch;

      const client = new VividCoderApiClient(() => baseConfig);
      const health = await client.checkHealth();
      assert.equal(health.ollamaStatus, 'connected');
      assert.equal(health.defaultModel, 'qwen3.5:4b');

      const models = await client.listModels();
      assert.equal(models[0].name, 'qwen3.5:4b');

      const chat = await client.sendChatRest({
        conversationId: 'conv_1',
        projectId: null,
        model: 'qwen3.5:4b',
        prompt: 'ping',
        messages: [{ role: 'user', content: 'ping' }],
        options: { temperature: 0.2, num_ctx: 8192 },
      });
      assert.equal(chat.message.content, 'ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces NETWORK_UNREACHABLE instead of simulating responses when offline', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;

      const client = new VividCoderApiClient(() => baseConfig);
      await assert.rejects(
        () => client.checkHealth(),
        (err: unknown) => err instanceof ApiError && err.code === 'NETWORK_UNREACHABLE'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Markdown & Security Parsing', () => {
  it('parses fenced code blocks including incomplete streaming blocks', () => {
    const blocks = parseMarkdownBlocks('# Title\n\n```python\ndef hi():\n  return 1');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'heading');
    assert.equal(blocks[1].type, 'code');
    if (blocks[1].type === 'code') {
      assert.equal(blocks[1].language, 'python');
      assert.ok(blocks[1].code.includes('def hi():'));
    }
  });

  it('blocks dangerous javascript: URIs in markdown links', () => {
    const spans = parseInlineSpans('[click](javascript:alert(1))');
    assert.equal(spans[0].type, 'text');
  });
});

describe('Workspace Store Configuration & History Consistency', () => {
  it('defaults to qwen3.5:4b and clamps context window between 4096 and 16384', () => {
    resetBackendConfig();
    assert.equal(configSignal.value.defaultModel, 'qwen3.5:4b');
    assert.equal(configSignal.value.numCtx, 8192);
    assert.equal(selectedModelSignal.value, 'qwen3.5:4b');

    const res = saveBackendConfig({
      apiBaseUrl: 'http://127.0.0.1:8000',
      defaultModel: 'qwen3.5:9b',
      numCtx: 65536,
    });
    assert.equal(res.ok, true);
    assert.equal(configSignal.value.numCtx, 16384);
    assert.equal(selectedModelSignal.value, 'qwen3.5:9b');

    resetBackendConfig();
  });

  it('filters empty/errored assistant messages and deduplicates trailing prompt in historySnapshot', () => {
    const history: ChatMessage[] = [
      {
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: 'Explain FastAPI lifespan',
        createdAt: '2026-11-26T00:00:00Z',
        status: 'complete',
      },
      {
        id: 'm2',
        conversationId: 'c1',
        role: 'assistant',
        content: 'FastAPI lifespan runs startup and shutdown hooks.',
        createdAt: '2026-11-26T00:00:01Z',
        status: 'complete',
      },
      {
        id: 'm3',
        conversationId: 'c1',
        role: 'user',
        content: 'Write a SQLite query',
        createdAt: '2026-11-26T00:00:02Z',
        status: 'complete',
      },
      {
        id: 'm4',
        conversationId: 'c1',
        role: 'assistant',
        content: '',
        createdAt: '2026-11-26T00:00:03Z',
        status: 'error',
        errorMessage: 'Ollama offline',
      },
      {
        id: 'm5',
        conversationId: 'c1',
        role: 'assistant',
        content: 'partial failed output',
        createdAt: '2026-11-26T00:00:04Z',
        status: 'error',
        errorMessage: 'Stream aborted',
      },
      {
        id: 'm6',
        conversationId: 'c1',
        role: 'user',
        content: 'Retry SQLite query',
        createdAt: '2026-11-26T00:00:05Z',
        status: 'complete',
      },
      {
        id: 'm7',
        conversationId: 'c1',
        role: 'assistant',
        content: '   ',
        createdAt: '2026-11-26T00:00:06Z',
        status: 'stopped',
      },
    ];

    const snapshot = buildChatHistorySnapshot(history, 'Retry SQLite query');
    assert.deepEqual(snapshot, [
      { role: 'user', content: 'Explain FastAPI lifespan' },
      { role: 'assistant', content: 'FastAPI lifespan runs startup and shutdown hooks.' },
      { role: 'user', content: 'Write a SQLite query' },
    ]);
    messagesSignal.value = [];
  });
});

describe('WebSocket Stream Client Cancellation & Disconnect Handling', () => {
  it('sends chat.stop cleanly before closing socket and reports unexpected close', () => {
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalWebSocket = globalThis.WebSocket;

    const sentFrames: string[] = [];
    let closedCode: number | undefined;
    const listeners = new Map<string, Array<(ev: unknown) => void>>();

    class FakeWebSocket {
      public static readonly CONNECTING = 0;
      public static readonly OPEN = 1;
      public static readonly CLOSING = 2;
      public static readonly CLOSED = 3;
      public readyState = 1;

      constructor(_url: string) {}
      addEventListener(type: string, cb: (ev: unknown) => void) {
        const list = listeners.get(type) ?? [];
        list.push(cb);
        listeners.set(type, list);
      }
      send(data: string) {
        sentFrames.push(data);
      }
      close(code?: number) {
        closedCode = code;
        this.readyState = 3;
      }
    }

    (globalThis as Record<string, unknown>).window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;

    try {
      const client = new VividCoderStreamClient();
      const events: string[] = [];

      client.startStream(
        'ws://127.0.0.1:8000',
        {
          type: 'chat.start',
          conversationId: 'conv_stop_test',
          projectId: null,
          model: 'qwen3.5:4b',
          prompt: 'hello',
          messages: [{ role: 'user', content: 'hello' }],
          options: { temperature: 0.2, num_ctx: 8192 },
        },
        {
          onOpen: () => events.push('open'),
          onToken: (tok) => events.push(`delta:${tok}`),
          onDone: () => events.push('done'),
          onStopped: () => events.push('stopped'),
          onError: (msg) => events.push(`error:${msg}`),
        }
      );

      for (const cb of listeners.get('open') ?? []) cb({});
      for (const cb of listeners.get('message') ?? []) {
        cb({ data: JSON.stringify({ type: 'chat.delta', token: 'hi' }) });
      }

      // Trigger stop: chat.stop is sent without immediately killing the socket before backend ack
      client.stopGeneration();
      assert.equal(sentFrames.length, 2);
      assert.equal(JSON.parse(sentFrames[1]).type, 'chat.stop');
      assert.equal(closedCode, undefined);

      // Simulate backend acknowledging chat.stopped
      for (const cb of listeners.get('message') ?? []) {
        cb({ data: JSON.stringify({ type: 'chat.stopped', messageId: 'm_1' }) });
      }
      assert.equal(closedCode, 1000);
      assert.deepEqual(events, ['open', 'delta:hi']);

      // Simulate unexpected close on a fresh stream
      listeners.clear();
      const errors: string[] = [];
      client.startStream(
        'ws://127.0.0.1:8000',
        {
          type: 'chat.start',
          conversationId: 'conv_err_test',
          projectId: null,
          model: 'qwen3.5:4b',
          prompt: 'hello',
          messages: [{ role: 'user', content: 'hello' }],
          options: { temperature: 0.2, num_ctx: 8192 },
        },
        {
          onToken: () => {},
          onDone: () => {},
          onStopped: () => {},
          onError: (msg, code) => errors.push(`${code}:${msg}`),
        }
      );
      for (const cb of listeners.get('open') ?? []) cb({});
      for (const cb of listeners.get('close') ?? []) cb({ code: 1006, reason: 'Dropped' });
      assert.equal(errors.length, 1);
      assert.ok(errors[0].startsWith('WS_CLOSED_UNEXPECTEDLY:'));
    } finally {
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
    }
  });
});
