/**
 * Professional Ask prose — ChatGPT / Claude / Grok quality structure.
 *
 * The office Ask bubble renders safe markdown (bold, italics, lists,
 * paragraphs). Prompts ask the model for that shape; normalize only
 * cleans obvious mess (orphan markers, inconsistent list prefixes) and
 * never invents facts.
 */

import { ASK_SOURCE_FORMAT_RULES, normalizeAskSources } from './askSources.js';

/** Appended to interactive Ask system prompts (job file + clip). */
export const ASK_PROSE_FORMAT_RULES = `FORMAT (ChatGPT / Claude / Grok quality — the UI renders safe markdown):
- Write like a top-tier chat assistant: short opener paragraph, then a tight bullet list when listing facts, optional invite to go deeper.
- Use markdown for structure only: **bold** for short section labels (e.g. **Job setup:**), *italics* sparingly for asides, and "-" or "•" for bullet lists.
- Never dump raw asterisk soup (no "***", no decorative * around every phrase). One clean **Label:** per bullet is enough.
- No headings (#), no links, no images, no HTML, no code fences unless quoting a short on-file code-like string.
- Glance-simple first; save long quotes and timestamps for when they ask for depth.
- Stay grounded: only facts from the record — never invent evidence.

` + ASK_SOURCE_FORMAT_RULES;

/**
 * Light cleanup before store/return. Keeps intentional **bold** / *italic*
 * for the UI renderer; fixes list markers and strips orphan emphasis.
 */
export function normalizeAskProse(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;

  // Promote ASCII / markdown list markers to a consistent "- " form the
  // renderer and unicode-bullet UIs both understand.
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

  // Collapse accidental ***strong*** to **strong**.
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '**$1**');

  // Drop unpaired trailing/orphan emphasis runs that would show as stars
  // (e.g. a lone "**" left after a bad stream) — but keep balanced pairs.
  text = stripOrphanEmphasis(text);

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return normalizeAskSources(text);
}

function stripOrphanEmphasis(text: string): string {
  // Remove a trailing incomplete ** or * at end of string / line.
  let out = text.replace(/(\*\*?)(\s*)$/gm, '$2');
  // If odd count of **, drop the last leftover ** occurrence.
  const boldMarks = out.match(/\*\*/g);
  if (boldMarks && boldMarks.length % 2 === 1) {
    out = out.replace(/\*\*(?!.*\*\*)/, '');
  }
  return out;
}
