import { signal } from '@samrey/reactivity';
import { el, Show } from '@samrey/runtime';
import { deriveWsUrlFromHttp } from '../api/client.ts';
import {
  backendStatusSignal,
  configSignal,
  healthErrorSignal,
  healthInfoSignal,
  lastCheckedAtSignal,
  ollamaStatusSignal,
  refreshConnection,
  resetBackendConfig,
  saveBackendConfig,
} from '../store/workspaceStore.ts';
import { CodeBlock } from './CodeBlock.ts';
import { CheckIcon, RefreshIcon, ServerIcon } from './Icons.ts';

const FASTAPI_CONTRACT_SNIPPET = `# Start the VividCoder Python 3.12+ FastAPI backend locally on macOS:
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Pull the initial model (and optional 9B evaluation candidate):
ollama pull qwen3.5:4b
# Optional evaluation candidate (close other heavy apps on 16 GB M2):
# ollama pull qwen3.5:9b`;

export function SettingsView(): HTMLElement {
  const initial = configSignal.value;
  const apiBaseUrl = signal(initial.apiBaseUrl);
  const wsBaseUrl = signal(initial.wsBaseUrl);
  const defaultModel = signal(initial.defaultModel);
  const temperature = signal(String(initial.temperature));
  const numCtx = signal(String(initial.numCtx));
  const autoSyncWs = signal(true);

  const feedbackMessage = signal<string | null>(null);
  const feedbackError = signal<string | null>(null);

  const handleSave = (e: Event) => {
    e.preventDefault();
    feedbackMessage.value = null;
    feedbackError.value = null;

    const parsedTemp = Number(temperature.value);
    const parsedCtx = Number(numCtx.value);

    const res = saveBackendConfig({
      apiBaseUrl: apiBaseUrl.value,
      wsBaseUrl: wsBaseUrl.value,
      defaultModel: defaultModel.value,
      temperature: Number.isFinite(parsedTemp) ? parsedTemp : 0.2,
      numCtx: Number.isFinite(parsedCtx) ? parsedCtx : 8192,
    });

    if (!res.ok) {
      feedbackError.value = res.error || 'Failed to save configuration.';
      return;
    }

    feedbackMessage.value = 'Local backend configuration saved to browser storage.';
    void refreshConnection();
  };

  const handleReset = () => {
    resetBackendConfig();
    const fresh = configSignal.value;
    apiBaseUrl.value = fresh.apiBaseUrl;
    wsBaseUrl.value = fresh.wsBaseUrl;
    defaultModel.value = fresh.defaultModel;
    temperature.value = String(fresh.temperature);
    numCtx.value = String(fresh.numCtx);
    feedbackError.value = null;
    feedbackMessage.value = 'Restored default macOS local endpoints.';
  };

  return el(
    'section',
    { class: 'flex-1 overflow-y-auto bg-[#0B0D11]' },
    el(
      'div',
      { class: 'max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8' },
      // Header
      el(
        'div',
        { class: 'border-b border-[#ffffff0d] pb-5 space-y-1' },
        el('h1', { class: 'text-xl font-semibold text-[#F9FAFB]' }, 'Settings & Local Integration'),
        el(
          'p',
          { class: 'text-sm text-[#9CA3AF]' },
          'Configure local Python FastAPI and Ollama endpoints. No API keys or secrets are stored in browser code.'
        )
      ),

      // Local Backend Form
      el(
        'form',
        {
          onSubmit: handleSave,
          class: 'rounded-lg border border-[#ffffff12] bg-[#11141B] p-5 space-y-5',
        },
        el(
          'div',
          { class: 'flex flex-wrap items-center justify-between gap-2' },
          el('h2', { class: 'text-sm font-semibold text-[#F3F4F6]' }, 'Local Backend Endpoints'),
          el(
            'div',
            { class: 'flex items-center gap-2 text-xs font-mono text-[#9CA3AF]' },
            el('span', null, () => `Backend: ${backendStatusSignal.value}`),
            el('span', { 'aria-hidden': 'true' }, '·'),
            el('span', null, () => `Ollama: ${ollamaStatusSignal.value}`),
            Show({
              when: () => Boolean(lastCheckedAtSignal.value),
              children: () => [
                el('span', { 'aria-hidden': 'true' }, '·'),
                el('span', { class: 'tabular-nums' }, () => lastCheckedAtSignal.value ?? ''),
              ],
            })
          )
        ),

        el(
          'div',
          { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
          el(
            'div',
            { class: 'space-y-1.5' },
            el(
              'label',
              { for: 'cfg-api-url', class: 'block text-xs text-[#9CA3AF]' },
              'FastAPI REST Base URL'
            ),
            el('input', {
              id: 'cfg-api-url',
              type: 'url',
              value: () => apiBaseUrl.value,
              onInput: (e: Event) => {
                const next = (e.target as HTMLInputElement).value;
                apiBaseUrl.value = next;
                if (autoSyncWs.value) {
                  try {
                    wsBaseUrl.value = deriveWsUrlFromHttp(next);
                  } catch {
                    // Wait until valid URL
                  }
                }
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
            })
          ),
          el(
            'div',
            { class: 'space-y-1.5' },
            el(
              'label',
              { for: 'cfg-ws-url', class: 'block text-xs text-[#9CA3AF]' },
              'FastAPI WebSocket URL'
            ),
            el('input', {
              id: 'cfg-ws-url',
              type: 'text',
              value: () => wsBaseUrl.value,
              onInput: (e: Event) => {
                autoSyncWs.value = false;
                wsBaseUrl.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
            })
          )
        ),

        el(
          'div',
          { class: 'grid grid-cols-1 sm:grid-cols-3 gap-4' },
          el(
            'div',
            { class: 'space-y-1.5' },
            el(
              'label',
              { for: 'cfg-model', class: 'block text-xs text-[#9CA3AF]' },
              'Default Ollama Model'
            ),
            el('input', {
              id: 'cfg-model',
              type: 'text',
              value: () => defaultModel.value,
              onInput: (e: Event) => {
                defaultModel.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
            })
          ),
          el(
            'div',
            { class: 'space-y-1.5' },
            el(
              'label',
              { for: 'cfg-temp', class: 'block text-xs text-[#9CA3AF]' },
              'Temperature (0.0 – 2.0)'
            ),
            el('input', {
              id: 'cfg-temp',
              type: 'number',
              step: '0.1',
              min: '0',
              max: '2',
              value: () => temperature.value,
              onInput: (e: Event) => {
                temperature.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono tabular-nums text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
            })
          ),
          el(
            'div',
            { class: 'space-y-1.5' },
            el(
              'label',
              { for: 'cfg-ctx', class: 'block text-xs text-[#9CA3AF]' },
              'Context Window (8K–16K)'
            ),
            el('input', {
              id: 'cfg-ctx',
              type: 'number',
              step: '1024',
              min: '4096',
              max: '16384',
              value: () => numCtx.value,
              onInput: (e: Event) => {
                numCtx.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono tabular-nums text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
            })
          )
        ),

        // Feedback banners
        Show({
          when: () => Boolean(feedbackError.value),
          children: () =>
            el('p', { class: 'text-xs text-[#EF4444]' }, () => feedbackError.value ?? ''),
        }),
        Show({
          when: () => Boolean(feedbackMessage.value),
          children: () =>
            el(
              'div',
              { class: 'flex items-center gap-2 text-xs text-[#22C55E]' },
              CheckIcon('w-3.5 h-3.5'),
              el('span', null, () => feedbackMessage.value ?? '')
            ),
        }),
        Show({
          when: () => Boolean(healthErrorSignal.value),
          children: () =>
            el(
              'p',
              { class: 'text-xs text-[#F59E0B] leading-relaxed' },
              () => `Last diagnostic: ${healthErrorSignal.value}`
            ),
        }),
        Show({
          when: () => Boolean(healthInfoSignal.value?.ollamaVersion),
          children: () =>
            el(
              'p',
              { class: 'text-xs font-mono text-[#22C55E]' },
              () =>
                `Connected to Ollama ${healthInfoSignal.value?.ollamaVersion} · SQLite ${healthInfoSignal.value?.sqliteStatus ?? 'ok'}`
            ),
        }),

        el(
          'div',
          { class: 'flex flex-wrap items-center gap-3 pt-1' },
          el(
            'button',
            {
              type: 'submit',
              class:
                'px-4 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors whitespace-nowrap cursor-pointer',
            },
            'Save & Test Connection'
          ),
          el(
            'button',
            {
              type: 'button',
              onClick: () => void refreshConnection(),
              class:
                'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#ffffff14] bg-[#141820] hover:bg-[#1A1F29] text-xs font-medium text-[#E6E9EF] transition-colors whitespace-nowrap cursor-pointer',
            },
            RefreshIcon('w-3.5 h-3.5'),
            'Test Now'
          ),
          el(
            'button',
            {
              type: 'button',
              onClick: handleReset,
              class:
                'px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white transition-colors whitespace-nowrap cursor-pointer',
            },
            'Reset Defaults'
          )
        )
      ),

      // Hardware & Architecture Target Table
      el(
        'div',
        { class: 'rounded-lg border border-[#ffffff12] bg-[#11141B] overflow-hidden' },
        el(
          'div',
          { class: 'px-5 py-3.5 border-b border-[#ffffff0d] flex items-center gap-2' },
          ServerIcon('w-4 h-4 text-[#3B82F6]'),
          el(
            'h2',
            { class: 'text-sm font-semibold text-[#F3F4F6]' },
            'Target Local Runtime Profile'
          )
        ),
        el(
          'div',
          { class: 'grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#ffffff0d] text-xs' },
          el(
            'div',
            { class: 'p-5 space-y-2.5' },
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Hardware'), el('span', { class: 'font-mono text-[#E6E9EF]' }, 'MacBook Pro M2')),
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Unified Memory'), el('span', { class: 'font-mono tabular-nums text-[#E6E9EF]' }, '16 GB')),
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Storage'), el('span', { class: 'font-mono tabular-nums text-[#E6E9EF]' }, '256 GB SSD'))
          ),
          el(
            'div',
            { class: 'p-5 space-y-2.5' },
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Frontend'), el('span', { class: 'font-mono text-[#E6E9EF]' }, 'Samrey + TS + Vite')),
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Backend / DB'), el('span', { class: 'font-mono text-[#E6E9EF]' }, 'Python 3.12+ FastAPI + SQLite')),
            el('div', { class: 'flex justify-between' }, el('span', { class: 'text-[#6B7280]' }, 'Initial / Eval Model'), el('span', { class: 'font-mono text-[#E6E9EF]' }, 'Qwen3.5 4B / 9B (1 loaded)'))
          )
        )
      ),

      // Integration Contract Reference
      el(
        'div',
        { class: 'space-y-2' },
        el(
          'h2',
          { class: 'text-sm font-semibold text-[#F3F4F6]' },
          'Local Backend Quick Start (backend/)'
        ),
        el(
          'p',
          { class: 'text-xs text-[#9CA3AF]' },
          'Run the Python 3.12+ FastAPI backend in backend/ on 127.0.0.1:8000. See docs/FASTAPI_INTEGRATION.md for full REST and WebSocket contracts.'
        ),
        CodeBlock({ language: 'bash', code: FASTAPI_CONTRACT_SNIPPET })
      )
    )
  );
}
