import { el } from '@samrey/runtime';
import { sanitizeUri } from '@samrey/security';

export type InlineSpan =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'link'; label: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { type: 'blockquote'; spans: InlineSpan[] }
  | { type: 'code'; language: string; code: string };

export function parseInlineSpans(input: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      spans.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('**') && token.endsWith('**')) {
      spans.push({ type: 'bold', value: token.slice(2, -2) });
    } else if (token.startsWith('[')) {
      const sep = token.indexOf('](');
      if (sep !== -1) {
        const label = token.slice(1, sep);
        const rawHref = token.slice(sep + 2, -1);
        const safeHref = sanitizeUri(rawHref);
        if (safeHref && safeHref !== 'about:blank') {
          spans.push({ type: 'link', label, href: safeHref });
        } else {
          spans.push({ type: 'text', value: label });
        }
      } else {
        spans.push({ type: 'text', value: token });
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < input.length) {
    spans.push({ type: 'text', value: input.slice(lastIndex) });
  }
  return spans;
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block (supports unclosed blocks while streaming)
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim().split(/\s+/)[0] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length && (lines[i] ?? '').trim().startsWith('```')) {
        i++;
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({
        type: 'heading',
        level,
        spans: parseInlineSpans(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        spans: parseInlineSpans(quoteLines.join(' ')),
      });
      continue;
    }

    // Unordered or ordered list
    const ulMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: InlineSpan[][] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? '').trim();
        const m = ordered ? /^\d+\.\s+(.+)$/.exec(cur) : /^[-*]\s+(.+)$/.exec(cur);
        if (!m) break;
        items.push(parseInlineSpans(m[1]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      const curTrim = cur.trim();
      if (
        !curTrim ||
        curTrim.startsWith('```') ||
        /^(#{1,3})\s+/.test(curTrim) ||
        curTrim.startsWith('>') ||
        /^[-*]\s+/.test(curTrim) ||
        /^\d+\.\s+/.test(curTrim)
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      spans: parseInlineSpans(paraLines.join('\n')),
    });
  }

  return blocks;
}

export function renderInlineSpans(spans: InlineSpan[]): Array<Node | string> {
  return spans.map((span) => {
    switch (span.type) {
      case 'text':
        return span.value;
      case 'bold':
        return el('strong', { class: 'font-semibold text-[#F3F4F6]' }, span.value);
      case 'code':
        return el(
          'code',
          {
            class:
              'px-1.5 py-0.5 rounded bg-[#1A1F29] border border-[#ffffff14] text-[#93C5FD] text-[0.85em]',
          },
          span.value
        );
      case 'link':
        return el(
          'a',
          {
            href: span.href,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'text-[#60A5FA] underline underline-offset-2 hover:text-[#93C5FD]',
          },
          span.label
        );
    }
  });
}

const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def',
  'default', 'elif', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'from', 'function', 'if', 'implements', 'import', 'in', 'interface', 'is', 'let',
  'match', 'new', 'None', 'null', 'pass', 'private', 'public', 'raise', 'readonly',
  'return', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'CREATE', 'TABLE',
  'PRIMARY', 'KEY', 'TEXT', 'INTEGER', 'switch', 'throw', 'true', 'True', 'False',
  'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
]);

const TYPES = new Set([
  'string', 'number', 'boolean', 'Promise', 'Record', 'Array', 'str', 'int', 'float',
  'bool', 'dict', 'list', 'Optional', 'FastAPI', 'WebSocket', 'BaseModel', 'Signal',
  'HTMLElement', 'DocumentFragment', 'Node', 'Error',
]);

/**
 * Tokenizes a single line of code into safe DOM nodes (never using innerHTML).
 */
export function highlightCodeLine(line: string): Array<Node | string> {
  if (!line) return [''];

  const tokens: Array<Node | string> = [];
  const tokenRe =
    /(#.*$|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(line.slice(lastIndex, match.index));
    }
    const word = match[0];
    if (word.startsWith('#') || word.startsWith('//')) {
      tokens.push(el('span', { class: 'vc-tok-comment' }, word));
    } else if (word.startsWith('"') || word.startsWith("'") || word.startsWith('`')) {
      tokens.push(el('span', { class: 'vc-tok-string' }, word));
    } else if (/^\d/.test(word)) {
      tokens.push(el('span', { class: 'vc-tok-number' }, word));
    } else if (KEYWORDS.has(word)) {
      tokens.push(el('span', { class: 'vc-tok-keyword' }, word));
    } else if (TYPES.has(word)) {
      tokens.push(el('span', { class: 'vc-tok-type' }, word));
    } else {
      tokens.push(word);
    }
    lastIndex = match.index + word.length;
  }

  if (lastIndex < line.length) {
    tokens.push(line.slice(lastIndex));
  }

  return tokens;
}
