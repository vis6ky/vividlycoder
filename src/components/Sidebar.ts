import { computed } from '@samrey/reactivity';
import { el, For, Show } from '@samrey/runtime';
import {
  activeConversationIdSignal,
  activeViewSignal,
  backendStatusSignal,
  conversationsErrorSignal,
  conversationsLoadingSignal,
  deleteConversation,
  filteredConversationsSignal,
  historySearchQuerySignal,
  ollamaStatusSignal,
  refreshConnection,
  selectConversation,
  sidebarOpenMobileSignal,
  startNewChat,
} from '../store/workspaceStore.ts';
import type { ConnectionState } from '../types/vividcoder.ts';
import {
  BrandLogoIcon,
  ChatIcon,
  CloseIcon,
  FolderIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from './Icons.ts';

function statusLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'checking':
      return 'Checking';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function statusDotClass(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'w-2 h-2 rounded-full bg-[#22C55E] shrink-0';
    case 'checking':
      return 'w-2 h-2 rounded-full bg-[#F59E0B] shrink-0';
    case 'offline':
    case 'error':
      return 'w-2 h-2 rounded-full bg-[#EF4444] shrink-0';
    default:
      return 'w-2 h-2 rounded-full bg-[#6B7280] shrink-0';
  }
}

function statusTextClass(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'text-[#22C55E]';
    case 'checking':
      return 'text-[#F59E0B]';
    case 'offline':
    case 'error':
      return 'text-[#EF4444]';
    default:
      return 'text-[#9CA3AF]';
  }
}

export function Sidebar(): HTMLElement {
  const conversationIds = computed(() =>
    filteredConversationsSignal.value.map((c) => c.id)
  );

  const navButtonClass = (view: 'chat' | 'projects' | 'settings') =>
    activeViewSignal.value === view
      ? 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-[#1A1F29] text-[#F9FAFB] transition-colors whitespace-nowrap'
      : 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[#9CA3AF] hover:text-[#E6E9EF] hover:bg-[#141820] transition-colors whitespace-nowrap';

  return el(
    'aside',
    {
      class: () =>
        `fixed inset-y-0 left-0 z-40 w-[264px] bg-[#0F1217] border-r border-[#ffffff12] flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 ${
          sidebarOpenMobileSignal.value ? 'translate-x-0' : '-translate-x-full'
        }`,
      'aria-label': 'Primary workspace sidebar',
    },
    // Top Brand Header + Mobile Close
    el(
      'div',
      {
        class:
          'h-14 px-4 flex items-center justify-between border-b border-[#ffffff0d] shrink-0',
      },
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            activeViewSignal.value = 'chat';
            sidebarOpenMobileSignal.value = false;
          },
          class:
            'flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6] rounded',
        },
        BrandLogoIcon('w-6 h-6 shrink-0'),
        el(
          'span',
          {
            class:
              'font-semibold text-[15px] tracking-tight text-[#F9FAFB] whitespace-nowrap',
            style: 'font-family: var(--font-display)',
          },
          'VividCoder'
        )
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            sidebarOpenMobileSignal.value = false;
          },
          'aria-label': 'Close sidebar',
          class:
            'lg:hidden p-1.5 rounded-md text-[#9CA3AF] hover:text-white hover:bg-[#1A1F29]',
        },
        CloseIcon('w-4 h-4')
      )
    ),

    // New Chat Action
    el(
      'div',
      { class: 'p-3 shrink-0' },
      el(
        'button',
        {
          type: 'button',
          onClick: startNewChat,
          class:
            'w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD]',
        },
        PlusIcon('w-4 h-4'),
        'New Chat'
      )
    ),

    // Navigation Views
    el(
      'nav',
      { class: 'px-3 pb-3 space-y-1 border-b border-[#ffffff0d] shrink-0', 'aria-label': 'Views' },
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            activeViewSignal.value = 'chat';
            sidebarOpenMobileSignal.value = false;
          },
          class: () => navButtonClass('chat'),
        },
        ChatIcon('w-4 h-4 shrink-0'),
        'Workspace'
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            activeViewSignal.value = 'projects';
            sidebarOpenMobileSignal.value = false;
          },
          class: () => navButtonClass('projects'),
        },
        FolderIcon('w-4 h-4 shrink-0'),
        'Projects'
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            activeViewSignal.value = 'settings';
            sidebarOpenMobileSignal.value = false;
          },
          class: () => navButtonClass('settings'),
        },
        SettingsIcon('w-4 h-4 shrink-0'),
        'Settings'
      )
    ),

    // Conversation History Section
    el(
      'div',
      { class: 'flex-1 flex flex-col min-h-0 px-3 pt-3' },
      el(
        'div',
        { class: 'flex items-center justify-between px-1 mb-2' },
        el('span', { class: 'text-xs font-medium text-[#6B7280]' }, 'Conversation History'),
        el(
          'span',
          { class: 'text-xs tabular-nums text-[#6B7280]' },
          () => String(filteredConversationsSignal.value.length)
        )
      ),
      // Search input
      el(
        'div',
        { class: 'relative mb-2.5 shrink-0' },
        el(
          'span',
          {
            class:
              'absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] pointer-events-none',
          },
          SearchIcon('w-3.5 h-3.5')
        ),
        el('input', {
          type: 'search',
          placeholder: 'Filter threads...',
          'aria-label': 'Filter conversation history',
          value: () => historySearchQuerySignal.value,
          onInput: (e: Event) => {
            historySearchQuerySignal.value = (e.target as HTMLInputElement).value;
          },
          class:
            'w-full pl-8 pr-2.5 py-1.5 rounded-md bg-[#141820] border border-[#ffffff10] text-xs text-[#E6E9EF] placeholder-[#6B7280] focus:outline-none focus:border-[#3B82F6]/60',
        })
      ),

      // Scrollable History List
      el(
        'div',
        { class: 'flex-1 overflow-y-auto space-y-1 pr-1 pb-3' },
        Show({
          when: () => conversationsLoadingSignal.value,
          children: () =>
            el(
              'div',
              { class: 'space-y-2 py-1' },
              [1, 2, 3].map(() =>
                el('div', {
                  class: 'h-9 rounded-md bg-[#141820] border border-[#ffffff08]',
                })
              )
            ),
          fallback: () =>
            Show({
              when: () =>
                Boolean(conversationsErrorSignal.value) &&
                filteredConversationsSignal.value.length === 0,
              children: () =>
                el(
                  'div',
                  {
                    class:
                      'rounded-md border border-[#ffffff10] bg-[#141820] p-3 text-xs text-[#9CA3AF] space-y-2',
                  },
                  el('p', { class: 'leading-relaxed' }, 'History unavailable while FastAPI is offline.'),
                  el(
                    'button',
                    {
                      type: 'button',
                      onClick: () => void refreshConnection(),
                      class:
                        'inline-flex items-center gap-1.5 text-[#60A5FA] hover:text-[#93C5FD] font-medium',
                    },
                    RefreshIcon('w-3 h-3'),
                    'Retry'
                  )
                ),
              fallback: () =>
                For({
                  each: () => conversationIds.value,
                  key: (id) => id,
                  fallback: () =>
                    el(
                      'div',
                      { class: 'px-2 py-4 text-xs text-[#6B7280]' },
                      'No conversations yet. Start a prompt to create a thread.'
                    ),
                  children: (convId) => {
                    const convSig = computed(() =>
                      filteredConversationsSignal.value.find((c) => c.id === convId)
                    );
                    return el(
                      'div',
                      {
                        class: () =>
                          `group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-md text-xs transition-colors ${
                            activeConversationIdSignal.value === convId
                              ? 'bg-[#1A1F29] text-[#F9FAFB]'
                              : 'text-[#9CA3AF] hover:text-[#E6E9EF] hover:bg-[#141820]'
                          }`,
                      },
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => void selectConversation(convId),
                          class: 'flex-1 text-left min-w-0 truncate font-medium cursor-pointer',
                        },
                        () => convSig.value?.title ?? 'Untitled thread'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: (e: Event) => {
                            e.stopPropagation();
                            void deleteConversation(convId);
                          },
                          'aria-label': 'Delete conversation',
                          class:
                            'opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-[#6B7280] hover:text-[#EF4444] transition-opacity shrink-0',
                        },
                        TrashIcon('w-3.5 h-3.5')
                      )
                    );
                  },
                }),
            }),
        })
      )
    ),

    // Bottom Live Connection Status Area (Backend + Ollama)
    el(
      'div',
      {
        class:
          'p-3 border-t border-[#ffffff0d] bg-[#0C0F14] space-y-2 text-xs shrink-0',
      },
      el(
        'div',
        { class: 'flex items-center justify-between' },
        el('span', { class: 'text-[#9CA3AF]' }, 'FastAPI Backend'),
        el(
          'div',
          { class: 'flex items-center gap-1.5 font-mono text-[11px]' },
          el('span', { class: () => statusDotClass(backendStatusSignal.value) }),
          el(
            'span',
            { class: () => statusTextClass(backendStatusSignal.value) },
            () => statusLabel(backendStatusSignal.value)
          )
        )
      ),
      el(
        'div',
        { class: 'flex items-center justify-between' },
        el('span', { class: 'text-[#9CA3AF]' }, 'Ollama Runtime'),
        el(
          'div',
          { class: 'flex items-center gap-1.5 font-mono text-[11px]' },
          el('span', { class: () => statusDotClass(ollamaStatusSignal.value) }),
          el(
            'span',
            { class: () => statusTextClass(ollamaStatusSignal.value) },
            () => statusLabel(ollamaStatusSignal.value)
          )
        )
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: () => void refreshConnection(),
          class:
            'w-full mt-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#ffffff10] bg-[#141820] hover:bg-[#1A1F29] text-[11px] font-medium text-[#D1D5DB] transition-colors whitespace-nowrap',
        },
        RefreshIcon('w-3 h-3'),
        'Refresh Status'
      )
    )
  );
}
