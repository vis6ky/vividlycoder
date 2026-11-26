import { signal } from '@samrey/reactivity';
import { el, Show } from '@samrey/runtime';
import { highlightCodeLine } from '../utils/markdown.ts';
import { CheckIcon, CopyIcon } from './Icons.ts';

export interface CodeBlockProps {
  language: string;
  code: string;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CodeBlock(props: CodeBlockProps): HTMLElement {
  const copied = signal(false);
  const lines = props.code.split('\n');
  const lineCount = lines.length;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(props.code);
    if (ok) {
      copied.value = true;
      window.setTimeout(() => {
        copied.value = false;
      }, 1800);
    }
  };

  return el(
    'div',
    {
      class:
        'my-3 rounded-lg border border-[#ffffff14] bg-[#0E1117] overflow-hidden',
    },
    // Header bar
    el(
      'div',
      {
        class:
          'flex items-center justify-between px-3.5 py-2 border-b border-[#ffffff0d] bg-[#141820] text-xs text-[#9CA3AF]',
      },
      el(
        'div',
        { class: 'flex items-center gap-2 font-mono' },
        el('span', { class: 'text-[#E6E9EF]' }, props.language || 'text'),
        el('span', { 'aria-hidden': 'true', class: 'text-[#4B5563]' }, '·'),
        el(
          'span',
          { class: 'tabular-nums text-[#6B7280]' },
          `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`
        )
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: handleCopy,
          'aria-label': 'Copy code to clipboard',
          class:
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-[#1F2633] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]',
        },
        Show({
          when: () => copied.value,
          fallback: () => [CopyIcon('w-3.5 h-3.5'), el('span', null, 'Copy code')],
          children: () => [
            CheckIcon('w-3.5 h-3.5 text-[#22C55E]'),
            el('span', { class: 'text-[#22C55E]' }, 'Copied'),
          ],
        })
      )
    ),
    // Code lines
    el(
      'pre',
      {
        class:
          'p-3.5 overflow-x-auto text-[13px] leading-[1.6] font-mono text-[#E6E9EF] m-0',
      },
      el(
        'code',
        { class: 'block' },
        lines.map((line, index) =>
          el(
            'div',
            { class: 'flex' },
            el(
              'span',
              {
                class:
                  'select-none w-9 shrink-0 pr-3 text-right text-[#4B5563] tabular-nums text-[12px]',
                'aria-hidden': 'true',
              },
              String(index + 1)
            ),
            el('span', { class: 'flex-1 whitespace-pre' }, ...highlightCodeLine(line))
          )
        )
      )
    )
  );
}
