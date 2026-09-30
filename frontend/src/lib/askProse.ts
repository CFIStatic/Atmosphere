/**
 * Safe Ask markdown — ChatGPT / Claude / Grok style bubbles without HTML injection.
 *
 * Supports: paragraphs, bullet/numbered lists, **bold**, *italic*.
 * Everything else is plain text. Cite/seek tokens stay in text leaves for
 * splitAnswerCites to turn into buttons.
 */

import { stripAskWebTrailer } from './askSources';

export type AskInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: AskInline[] }
  | { kind: 'italic'; children: AskInline[] }
  | { kind: 'link'; text: string; href: string };

export type AskProseBlock =
  | { kind: 'paragraph'; children: AskInline[] }
  | { kind: 'heading'; level: 2 | 3; children: AskInline[] }
  | { kind: 'list'; ordered: boolean; items: AskInline[][] }
  | { kind: 'table'; headers: AskInline[][]; rows: AskInline[][][] };

export function splitAskArtifact(input: string): { prose: string; artifact: string | null } {
  const text = String(input ?? '');
  const match = text.match(/⟦artifact⟧\s*([\s\S]*?)\s*⟦\/artifact⟧/);
  if (!match) return { prose: text.trim(), artifact: null };
  return {
    prose: text.replace(match[0], '').trim(),
    artifact: (match[1] ?? '').trim() || null,
  };
}

/**
 * Drop unpaired / decorative asterisks so the chat bubble never shows
 * literal "***" / dangling "**" / lone "*" star soup. Balanced **bold**
 * and *italic* pairs are preserved.
 */
export function stripOrphanEmphasis(text: string): string {
  let out = String(text ?? '');
  if (!out) return out;

  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/\*\*\*([^*][\s\S]*?)\*\*\*/g, '**$1**');
    if (next === out) break;
    out = next;
  }

  out = out.replace(/\*{3,}/g, '');
  // Trailing incomplete ** / * only when orphaned (whitespace before marker)
  out = out.replace(/(^|\s)(\*\*?)(\s*)$/gm, '$1$3');

  let boldMarks = out.match(/\*\*/g);
  while (boldMarks && boldMarks.length % 2 === 1) {
    out = out.replace(/\*\*(?!.*\*\*)/, '');
    boldMarks = out.match(/\*\*/g);
  }

  out = stripUnpairedSingleAsterisks(out);

  return out
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/([({\[]) +/g, '$1');
}

function stripUnpairedSingleAsterisks(text: string): string {
  const placeholders: string[] = [];
  const stash = (value: string) => {
    const idx = placeholders.length;
    placeholders.push(value);
    return `\u0000${idx}\u0000`;
  };

  let out = text.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => stash(`**${inner}**`));
  out = out.replace(
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    (_m, pre: string, inner: string) => `${pre}${stash(`*${inner}*`)}`,
  );
  out = out.replace(/\*/g, '');
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => placeholders[Number(n)] ?? '');
  return out;
}

/** Light cleanup mirrored from the API — keep balanced markdown for render. */
export function normalizeAskProse(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;

  // Defense in depth: never leave raw [[web:]] / ⟦web:⟧ trailers in prose.
  text = stripAskWebTrailer(text);

  text = text
    .split('\n')
    .map((raw) => {
      const line = raw.replace(/\s+$/g, '');
      const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (ordered) {
        const body = (ordered[3] ?? '').trim();
        if (!body) return '';
        return `${ordered[1] ?? ''}${ordered[2]}. ${body}`;
      }
      const bullet = line.match(/^(\s*)(?:[-*•–—])\s+(.*)$/);
      if (!bullet) return line;
      const body = (bullet[2] ?? '').trim();
      if (!body) return '';
      return `${bullet[1] ?? ''}- ${body}`;
    })
    .join('\n');

  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '**$1**');
  text = stripOrphanEmphasis(text);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function parseInline(input: string): AskInline[] {
  const nodes: AskInline[] = [];
  let i = 0;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    nodes.push({ kind: 'text', text: buf });
    buf = '';
  };

  while (i < input.length) {
    if (input[i] === '[') {
      const link = input.slice(i).match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (link) {
        flush();
        nodes.push({ kind: 'link', text: link[1] ?? '', href: link[2] ?? '' });
        i += link[0].length;
        continue;
      }
    }
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      // Unmatched ** — skip markers so they never render as literal stars.
      i += 2;
      continue;
    }
    if (input[i] === '*' && input[i + 1] !== '*') {
      const end = input.indexOf('*', i + 1);
      if (end > i + 1 && input[end + 1] !== '*') {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
      // Unmatched * — skip.
      i += 1;
      continue;
    }
    if (input.startsWith('__', i)) {
      const end = input.indexOf('__', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (input[i] === '_' && input[i + 1] !== '_') {
      const end = input.indexOf('_', i + 1);
      if (end > i + 1 && input[end + 1] !== '_') {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
      i += 1;
      continue;
    }
    buf += input[i];
    i += 1;
  }
  flush();
  return nodes.length ? nodes : [{ kind: 'text', text: '' }];
}

/**
 * Parse assistant prose into blocks the Ask bubble can render like peer chat UIs.
 */
export function parseAskProseBlocks(input: string): AskProseBlock[] {
  const text = normalizeAskProse(input);
  if (!text) return [];

  const blocks: AskProseBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const body = paragraphLines.join('\n').trim();
    paragraphLines = [];
    if (body) blocks.push({ kind: 'paragraph', children: parseInline(body) });
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({
      kind: 'list',
      ordered: listOrdered,
      items: listItems.map((item) => parseInline(item)),
    });
    listItems = [];
    listOrdered = false;
  };
  const flushAll = () => {
    flushList();
    flushParagraph();
  };

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = (heading[1] ?? '').length >= 3 ? 3 : 2;
      blocks.push({ kind: 'heading', level, children: parseInline((heading[2] ?? '').trim()) });
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index] ?? '')) {
        tableLines.push((lines[index] ?? '').trim());
        index += 1;
      }
      index -= 1;
      flushAll();
      const parsed = tableLines
        .filter((row) => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row))
        .map((row) =>
          row
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => parseInline(cell.trim())),
        );
      if (parsed.length) {
        blocks.push({ kind: 'table', headers: parsed[0] ?? [], rows: parsed.slice(1) });
      }
      continue;
    }
    const unordered = line.match(/^\s*[-*•–—]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (listItems.length && listOrdered) flushList();
      listOrdered = false;
      listItems.push((unordered[1] ?? '').trim());
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listItems.length && !listOrdered) flushList();
      listOrdered = true;
      listItems.push((ordered[1] ?? '').trim());
      continue;
    }
    flushList();
    paragraphLines.push(line.trim());
  }
  flushList();
  flushParagraph();
  return blocks;
}

/** Flatten inline nodes to plain text (tests / a11y). */
export function askInlineText(nodes: AskInline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'link') return node.text;
      return askInlineText(node.children);
    })
    .join('');
}
