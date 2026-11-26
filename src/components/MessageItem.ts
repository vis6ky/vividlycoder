import { computed } from '@samrey/reactivity';
import { el, Show } from '@samrey/runtime';
import { activeViewSignal, messagesSignal, retryMessage } from '../store/workspaceStore.ts';
import type { ChatMessage } from '../types/vividcoder.ts';
import { parseMarkdownBlocks, renderInlineSpans } from '../utils/markdown.ts';
import { CodeBlock } from './CodeBlock.ts';
import { AlertIcon, RefreshIcon } from './Icons.ts';

function formatMessageTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderMarkdownNodes(content: string): Node[] {
  const blocks = parseMarkdownBlocks(content);
  return blocks.map((block) => {
    switch (block.type) {
      case 'code':
        return CodeBlock({ language: block.language, code: block.code });
      case 'heading': {
        const tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
        const sizeClass =
          block.level === 1
            ? 'text-lg font-semibold text-[#F3F4F6] mt-4 mb-2'
            : block.level === 2
              ? 'text-base font-semibold text-[#F3F4F6] mt-3.5 mb-1.5'
              : 'text-sm font-semibold text-[#E5E7EB] mt-3 mb-1';
        return el(tag, { class: sizeClass }, ...renderInlineSpans(block.spans));
      }
      case 'blockquote':
        return el(
          'blockquote',
          {
            class:
              'my-2.5 px-3.5 py-2 rounded-md border border-[#ffffff10] bg-[#141820] text-[#9CA3AF] text-[14px] leading-relaxed',
          },
          ...renderInlineSpans(block.spans)
        );
      case 'list':
        return el(
          block.ordered ? 'ol' : 'ul',
          {
            class: block.ordered
              ? 'my-2.5 pl-5 list-decimal space-y-1 text-[15px] leading-[1.65] text-[#D1D5DB]'
              : 'my-2.5 pl-5 list-disc space-y-1 text-[15px] leading-[1.65] text-[#D1D5DB]',
          },
          ...block.items.map((itemSpans) =>
            el('li', null, ...renderInlineSpans(itemSpans))
          )
        );
      case 'paragraph':
        return el(
          'p',
          {
            class: 'my-2 text-[15px] leading-[1.65] text-[#E6E9EF] whitespace-pre-wrap',
          },
          ...renderInlineSpans(block.spans)
        );
    }
  });
}

export function MessageItem(messageId: string): HTMLElement {
  const msgSig = computed<ChatMessage | undefined>(() =>
    messagesSignal.value.find((m) => m.id === messageId)
  );

  const initial = msgSig.value;
  if (!initial) {
    return el('div', { class: 'hidden' });
  }

  const isUser = initial.role === 'user';

  return el(
    'article',
    {
      class: 'py-5 border-b border-[#ffffff08]',
    },
    // Role + Metadata header (unboxed text with typographic separators)
    el(
      'div',
      { class: 'flex items-center justify-between gap-4 mb-2 text-xs text-[#9CA3AF]' },
      el(
        'div',
        { class: 'flex items-center gap-2 min-w-0' },
        el(
          'span',
          {
            class: isUser
              ? 'font-semibold text-[#E6E9EF]'
              : 'font-semibold text-[#60A5FA]',
          },
          isUser ? 'You' : 'VividCoder'
        ),
        !isUser && initial.model
          ? [
              el('span', { 'aria-hidden': 'true', class: 'text-[#4B5563]' }, '·'),
              el('span', { class: 'font-mono text-[#9CA3AF] truncate' }, initial.model),
            ]
          : null,
        el('span', { 'aria-hidden': 'true', class: 'text-[#4B5563]' }, '·'),
        el('span', { class: 'tabular-nums text-[#6B7280]' }, formatMessageTime(initial.createdAt))
      ),
      el(
        'div',
        { class: 'flex items-center gap-2 shrink-0 text-xs tabular-nums' },
        () => {
          const cur = msgSig.value;
          if (!cur) return null;
          if (cur.status === 'streaming') {
            return el('span', { class: 'text-[#F59E0B] font-medium' }, 'Streaming...');
          }
          if (cur.status === 'stopped') {
            return el('span', { class: 'text-[#9CA3AF]' }, 'Stopped');
          }
          if (cur.tokenCount !== undefined) {
            return el(
              'span',
              { class: 'text-[#6B7280]' },
              `${cur.tokenCount} tokens${cur.durationMs ? ` · ${(cur.durationMs / 1000).toFixed(1)}s` : ''}`
            );
          }
          return null;
        }
      )
    ),

    // Body content
    isUser
      ? el(
          'div',
          {
            class:
              'text-[15px] leading-[1.65] text-[#F3F4F6] whitespace-pre-wrap bg-[#141820] border border-[#ffffff10] rounded-lg px-4 py-3',
          },
          () => msgSig.value?.content ?? ''
        )
      : el(
          'div',
          { class: 'space-y-1 max-w-none' },
          () => {
            const cur = msgSig.value;
            if (!cur) return null;
            if (!cur.content.trim()) {
              if (cur.status === 'streaming') {
                return el(
                  'div',
                  { class: 'text-sm text-[#9CA3AF] py-1' },
                  'Waiting for response tokens from local Ollama runtime...'
                );
              }
              return null;
            }
            return renderMarkdownNodes(cur.content);
          },
          Show({
            when: () => {
              const cur = msgSig.value;
              return Boolean(cur && cur.status === 'error' && cur.errorMessage);
            },
            children: () =>
              el(
                'div',
                {
                  class:
                    'mt-3 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 p-3.5 text-sm text-[#FCA5A5]',
                },
                el(
                  'div',
                  { class: 'flex items-start gap-2.5' },
                  AlertIcon('w-4 h-4 text-[#EF4444] shrink-0 mt-0.5'),
                  el(
                    'div',
                    { class: 'flex-1 min-w-0 space-y-2' },
                    el(
                      'p',
                      { class: 'font-medium text-[#FEE2E2]' },
                      'Local backend stream failed'
                    ),
                    el(
                      'p',
                      { class: 'text-[13px] leading-relaxed text-[#FECACA]' },
                      () =>
                        msgSig.value?.errorMessage ||
                        'Unable to reach local FastAPI WebSocket endpoint.'
                    ),
                    el(
                      'div',
                      { class: 'flex flex-wrap items-center gap-2.5 pt-1' },
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => retryMessage(messageId),
                          class:
                            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#141820] border border-[#ffffff1a] text-[#E6E9EF] hover:bg-[#1F2633] transition-colors whitespace-nowrap shrink-0',
                        },
                        RefreshIcon('w-3.5 h-3.5'),
                        'Retry'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => {
                            activeViewSignal.value = 'settings';
                          },
                          class:
                            'inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-[#93C5FD] hover:text-white hover:underline whitespace-nowrap shrink-0',
                        },
                        'Check Backend Settings'
                      )
                    )
                  )
                )
              ),
          })
        )
  );
}
