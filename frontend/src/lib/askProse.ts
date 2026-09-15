/**
 * Safe Ask markdown — ChatGPT / Claude / Grok style bubbles without HTML injection.
 *
 * Supports: paragraphs, bullet/numbered lists, **bold**, *italic*.
 * Everything else is plain text. Cite/seek tokens stay in text leaves for
 * splitAnswerCites to turn into buttons.
 */

export type AskInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: AskInline[] }
  | { kind: 'italic'; children: AskInline[] };

export type AskProseBlock =
  | { kind: 'paragraph'; children: AskInline[] }
  | { kind: 'list'; ordered: boolean; items: AskInline[][] };

/** Light cleanup mirrored from the API — keep balanced markdown for render. */
export function normalizeAskProse(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;

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
  text = text.replace(/(\*\*?)(\s*)$/gm, '$2');
  const boldMarks = text.match(/\*\*/g);
  if (boldMarks && boldMarks.length % 2 === 1) {
    text = text.replace(/\*\*(?!.*\*\*)/, '');
  }
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
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (input[i] === '*' && input[i + 1] !== '*') {
      const end = input.indexOf('*', i + 1);
      if (end > i + 1 && input[end + 1] !== '*') {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (input.startsWith('__', i)) {
      const end = input.indexOf('__', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (input[i] === '_' && input[i + 1] !== '_') {
      const end = input.indexOf('_', i + 1);
      if (end > i + 1 && input[end + 1] !== '_') {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
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

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushParagraph();
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
      if (node.kind === 'text') return node.text;
      return askInlineText(node.children);
    })
    .join('');
}
