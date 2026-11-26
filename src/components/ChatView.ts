import { computed, effect } from '@samrey/reactivity';
import { el, For, onMount, Show } from '@samrey/runtime';
import {
  activeConversationIdSignal,
  messagesErrorSignal,
  messagesLoadingSignal,
  messagesSignal,
  selectConversation,
} from '../store/workspaceStore.ts';
import { Composer } from './Composer.ts';
import { AlertIcon, RefreshIcon } from './Icons.ts';
import { MessageItem } from './MessageItem.ts';
import { WelcomeScreen } from './WelcomeScreen.ts';

export function ChatView(): HTMLElement {
  const composer = Composer();
  let scrollContainer: HTMLElement | null = null;
  const messageIds = computed(() => messagesSignal.value.map((m) => m.id));

  onMount(() => {
    effect(() => {
      const list = messagesSignal.value;
      const lastContentLen = list.length > 0 ? list[list.length - 1].content.length : 0;
      void lastContentLen;
      if (scrollContainer && list.length > 0) {
        queueMicrotask(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        });
      }
    });
  });

  const scrollArea = el(
    'div',
    { class: 'flex-1 overflow-y-auto' },
    Show({
      when: () => messagesLoadingSignal.value,
      children: () =>
        el(
          'div',
          { class: 'max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6' },
          [1, 2].map(() =>
            el(
              'div',
              { class: 'space-y-2.5' },
              el('div', { class: 'h-3 w-32 rounded bg-[#141820]' }),
              el('div', { class: 'h-20 rounded-lg bg-[#141820] border border-[#ffffff08]' })
            )
          )
        ),
      fallback: () =>
        Show({
          when: () => Boolean(messagesErrorSignal.value),
          children: () =>
            el(
              'div',
              { class: 'max-w-3xl mx-auto px-4 sm:px-6 py-10' },
              el(
                'div',
                {
                  class:
                    'rounded-lg border border-[#EF4444]/30 bg-[#141820] p-4 flex items-start gap-3',
                },
                AlertIcon('w-4 h-4 text-[#EF4444] shrink-0 mt-0.5'),
                el(
                  'div',
                  { class: 'space-y-2 flex-1' },
                  el('h2', { class: 'text-sm font-semibold text-[#F9FAFB]' }, 'Unable to load conversation'),
                  el(
                    'p',
                    { class: 'text-xs text-[#9CA3AF] leading-relaxed' },
                    () => messagesErrorSignal.value ?? 'Request failed.'
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        const id = activeConversationIdSignal.value;
                        if (id) void selectConversation(id);
                      },
                      class:
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1F2633] border border-[#ffffff14] text-[#E6E9EF] hover:bg-[#273040]',
                    },
                    RefreshIcon('w-3.5 h-3.5'),
                    'Retry'
                  )
                )
              )
            ),
          fallback: () =>
            Show({
              when: () => messageIds.value.length > 0,
              fallback: () => WelcomeScreen(() => composer.focus()),
              children: () =>
                el(
                  'div',
                  { class: 'max-w-3xl mx-auto px-4 sm:px-6 py-4' },
                  For({
                    each: () => messageIds.value,
                    key: (id) => id,
                    children: (id) => MessageItem(id),
                  })
                ),
            }),
        }),
    })
  );

  scrollContainer = scrollArea;

  return el(
    'section',
    { class: 'flex-1 flex flex-col min-h-0 bg-[#0B0D11]' },
    scrollArea,
    composer.element
  );
}
