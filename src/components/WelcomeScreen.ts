import { el, Show } from '@samrey/runtime';
import {
  activeProjectSignal,
  activeViewSignal,
  backendStatusSignal,
  composerDraftSignal,
  configSignal,
  healthErrorSignal,
  refreshConnection,
  selectedModelSignal,
} from '../store/workspaceStore.ts';
import { AlertIcon, BrandLogoIcon, CodeIcon, RefreshIcon } from './Icons.ts';

interface StarterPrompt {
  title: string;
  description: string;
  prompt: string;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    title: 'FastAPI WebSocket Streaming Route',
    description: 'Review how VividCoder streams Qwen3.5 4B tokens from Ollama over WebSockets.',
    prompt:
      'Explain how a Python 3.12 FastAPI WebSocket endpoint `/ws/chat` streams NDJSON chunks from local Ollama (`/api/chat`) and cancels cleanly on a `chat.stop` frame.',
  },
  {
    title: 'SQLite Conversation Persistence',
    description: 'Inspect lightweight SQLite tables for projects, conversations, and messages.',
    prompt:
      'Write a clean Python `sqlite3` query pattern with foreign keys and parameterized statements for storing projects, conversations, and chat messages.',
  },
  {
    title: 'Samrey Fine-Grained Reactive Component',
    description: 'Create a reactive component using @samrey/runtime and @samrey/reactivity.',
    prompt:
      'Show how to build a searchable project list component in Samrey (`@samrey/runtime` + `@samrey/reactivity`) using `signal`, `computed`, and keyed `For`.',
  },
  {
    title: 'Qwen3.5 4B vs 9B on M2 16 GB',
    description: 'Compare 8K–16K context window trade-offs under 16 GB unified memory.',
    prompt:
      'Compare running `qwen3.5:4b` vs `qwen3.5:9b` in Ollama with an 8K–16K context window on an Apple Silicon MacBook Pro M2 with 16 GB unified memory.',
  },
];

export function WelcomeScreen(onFocusComposer: () => void): HTMLElement {
  return el(
    'div',
    { class: 'flex-1 flex flex-col justify-center max-w-3xl w-full mx-auto px-6 py-10' },
    // Brand Header
    el(
      'div',
      { class: 'mb-8' },
      el(
        'div',
        { class: 'flex items-center gap-3 mb-4' },
        BrandLogoIcon('w-8 h-8'),
        el(
          'h1',
          {
            class:
              'text-2xl sm:text-3xl font-semibold tracking-tight text-[#F9FAFB]',
          },
          'VividCoder'
        )
      ),
      el(
        'p',
        { class: 'text-[15px] leading-relaxed text-[#9CA3AF] max-w-2xl' },
        'Local-first AI coding workspace running on your MacBook Pro M2. Prompts stream directly from your local FastAPI backend and Ollama runtime.'
      ),
      el(
        'div',
        {
          class:
            'flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-3 text-xs text-[#6B7280] font-mono',
        },
        el('span', null, () => `Model: ${selectedModelSignal.value}`),
        el('span', { 'aria-hidden': 'true' }, '·'),
        el('span', null, () => `Project: ${activeProjectSignal.value?.name || 'No project selected'}`),
        el('span', { 'aria-hidden': 'true' }, '·'),
        el('span', null, 'SQLite + FastAPI + Ollama')
      )
    ),

    // Honest Offline / Error Notice when FastAPI backend is unreachable
    Show({
      when: () =>
        backendStatusSignal.value === 'offline' || backendStatusSignal.value === 'error',
      children: () =>
        el(
          'div',
          {
            class:
              'mb-7 rounded-lg border border-[#F59E0B]/30 bg-[#141820] p-4',
          },
          el(
            'div',
            { class: 'flex items-start gap-3' },
            AlertIcon('w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5'),
            el(
              'div',
              { class: 'flex-1 min-w-0' },
              el(
                'div',
                { class: 'flex flex-wrap items-center justify-between gap-2' },
                el(
                  'h2',
                  { class: 'text-sm font-semibold text-[#F3F4F6]' },
                  'Local FastAPI backend is currently offline'
                ),
                el(
                  'span',
                  { class: 'text-xs font-mono text-[#9CA3AF]' },
                  () => configSignal.value.apiBaseUrl
                )
              ),
              el(
                'p',
                { class: 'mt-1.5 text-[13px] leading-relaxed text-[#9CA3AF]' },
                () =>
                  healthErrorSignal.value ||
                  'Start your local Python 3.12+ FastAPI server and Ollama daemon on macOS to stream live responses from Qwen3.5 4B. VividCoder never simulates AI responses when disconnected.'
              ),
              el(
                'div',
                { class: 'flex flex-wrap items-center gap-3 mt-3' },
                el(
                  'button',
                  {
                    type: 'button',
                    onClick: () => void refreshConnection(),
                    class:
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1F2633] border border-[#ffffff14] text-[#E6E9EF] hover:bg-[#273040] transition-colors whitespace-nowrap shrink-0',
                  },
                  RefreshIcon('w-3.5 h-3.5'),
                  'Test Connection'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      activeViewSignal.value = 'settings';
                    },
                    class:
                      'inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-[#60A5FA] hover:text-[#93C5FD] transition-colors whitespace-nowrap shrink-0',
                  },
                  'Configure Backend & Integration Guide'
                )
              )
            )
          )
        ),
    }),

    // Prompt Templates Grid
    el(
      'div',
      null,
      el(
        'h2',
        { class: 'text-xs font-medium text-[#6B7280] mb-3' },
        'Starter Prompts'
      ),
      el(
        'div',
        { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' },
        STARTER_PROMPTS.map((item) =>
          el(
            'button',
            {
              type: 'button',
              onClick: () => {
                composerDraftSignal.value = item.prompt;
                onFocusComposer();
              },
              class:
                'text-left p-4 rounded-lg border border-[#ffffff10] bg-[#11141B] hover:bg-[#161B24] hover:border-[#ffffff20] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]',
            },
            el(
              'div',
              { class: 'flex items-center gap-2 mb-1.5' },
              CodeIcon('w-3.5 h-3.5 text-[#3B82F6] shrink-0'),
              el(
                'span',
                { class: 'text-sm font-medium text-[#E6E9EF] group-hover:text-white truncate' },
                item.title
              )
            ),
            el(
              'p',
              { class: 'text-[13px] leading-relaxed text-[#9CA3AF]' },
              item.description
            )
          )
        )
      )
    )
  );
}
