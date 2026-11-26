import { effect } from '@samrey/reactivity';
import { el, onMount, Show } from '@samrey/runtime';
import {
  activeProjectSignal,
  backendStatusSignal,
  composerDraftSignal,
  isStreamingSignal,
  selectedModelSignal,
  sendMessage,
  stopGeneration,
} from '../store/workspaceStore.ts';
import { SendIcon, StopIcon } from './Icons.ts';

export interface ComposerHandle {
  element: HTMLElement;
  focus: () => void;
}

export function Composer(): ComposerHandle {
  let textareaRef: HTMLTextAreaElement | null = null;

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    const maxHeight = 180;
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, maxHeight)}px`;
  };

  onMount(() => {
    effect(() => {
      const draft = composerDraftSignal.value;
      if (textareaRef && textareaRef.value !== draft) {
        textareaRef.value = draft;
      }
      autoResize();
    });
  });

  const handleSubmit = () => {
    if (isStreamingSignal.value) return;
    if (!composerDraftSignal.value.trim()) return;
    sendMessage();
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  };

  const textareaEl = el('textarea', {
    rows: '2',
    placeholder: 'Ask VividCoder to write, refactor, or explain code...',
    'aria-label': 'Message input',
    value: () => composerDraftSignal.value,
    onInput: (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      composerDraftSignal.value = target.value;
      autoResize();
    },
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    class:
      'w-full bg-transparent text-[15px] leading-relaxed text-[#E6E9EF] placeholder-[#6B7280] resize-none focus:outline-none px-4 pt-3.5 pb-2 max-h-[180px]',
  }) as HTMLTextAreaElement;

  textareaRef = textareaEl;

  const element = el(
    'div',
    { class: 'border-t border-[#ffffff0d] bg-[#0B0D11] px-4 sm:px-6 py-4' },
    el(
      'div',
      { class: 'max-w-3xl mx-auto' },
      el(
        'div',
        {
          class:
            'rounded-xl border border-[#ffffff14] bg-[#141820] focus-within:border-[#3B82F6]/60 transition-colors',
        },
        textareaEl,
        el(
          'div',
          {
            class:
              'flex items-center justify-between gap-3 px-3.5 py-2.5 border-t border-[#ffffff0a]',
          },
          el(
            'div',
            { class: 'flex items-center gap-2 text-xs text-[#6B7280] min-w-0 truncate' },
            el(
              'span',
              { class: 'font-mono truncate' },
              () => selectedModelSignal.value
            ),
            el('span', { 'aria-hidden': 'true' }, '·'),
            el(
              'span',
              { class: 'truncate' },
              () => activeProjectSignal.value?.name || 'Global workspace'
            ),
            Show({
              when: () => backendStatusSignal.value === 'offline',
              children: () => [
                el('span', { 'aria-hidden': 'true' }, '·'),
                el('span', { class: 'text-[#F59E0B] whitespace-nowrap' }, 'Backend offline'),
              ],
            })
          ),
          el(
            'div',
            { class: 'flex items-center gap-2 shrink-0' },
            Show({
              when: () => isStreamingSignal.value,
              fallback: () =>
                el(
                  'button',
                  {
                    type: 'button',
                    onClick: handleSubmit,
                    disabled: () => !composerDraftSignal.value.trim(),
                    class: () =>
                      composerDraftSignal.value.trim()
                        ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer'
                        : 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#1F2633] text-[#6B7280] cursor-not-allowed whitespace-nowrap shrink-0',
                  },
                  'Send',
                  SendIcon('w-3.5 h-3.5')
                ),
              children: () =>
                el(
                  'button',
                  {
                    type: 'button',
                    onClick: stopGeneration,
                    class:
                      'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#DC2626] hover:bg-[#B91C1C] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  },
                  StopIcon('w-3.5 h-3.5'),
                  'Stop Generation'
                ),
            })
          )
        )
      ),
      el(
        'div',
        { class: 'flex items-center justify-between mt-2 px-1 text-[11px] text-[#6B7280]' },
        el('span', null, 'Enter to send · Shift+Enter for new line'),
        el('span', { class: 'hidden sm:inline font-mono' }, 'Cmd/Ctrl+K New Chat')
      )
    )
  );

  return {
    element,
    focus: () => textareaRef?.focus(),
  };
}
