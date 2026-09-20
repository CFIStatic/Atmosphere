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
- Never dump raw asterisk soup (no "***", no decorative * around every phrase, no unbalanced **). One clean **Label:** per bullet is enough — orphan stars must never appear in the answer.
- Capability-only asks ("can you search Google/the web?", "are you connected?") → 1–3 short professional sentences saying yes (when web search is available), optionally offer to search something specific. Do NOT live-search, do NOT append ⟦web:…⟧ / [[web:…]], and do NOT cite google.com or how-to-search pages.
- No headings (#), no inline URLs, no images, no HTML, no code fences unless quoting a short on-file code-like string. Web citations use the unicode ⟦web: Title|url⟧ trailer only on its own line (never ASCII [[web:…]], never mid-sentence) when you actually used WEB SEARCH RESULTS.
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

  // Collapse accidental ***strong*** to **strong**, then drop leftover soup.
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '**$1**');
  text = stripOrphanEmphasis(text);

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return normalizeAskSources(text);
}

/**
 * Drop unpaired / decorative asterisks so the chat bubble never shows
 * literal "***" / dangling "**" / lone "*" star soup. Balanced **bold**
 * and *italic* pairs are preserved.
 */
export function stripOrphanEmphasis(text: string): string {
  let out = String(text ?? '');
  if (!out) return out;

  // ***wrapped*** → **wrapped** (repeat for nested accidents)
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/\*\*\*([^*][\s\S]*?)\*\*\*/g, '**$1**');
    if (next === out) break;
    out = next;
  }

  // Decorative runs of 3+ asterisks (not wrapping content)
  out = out.replace(/\*{3,}/g, '');

  // Trailing incomplete ** / * only when clearly orphaned (whitespace before marker).
  // Do NOT strip a closing *italic* or **bold** marker at EOL.
  out = out.replace(/(^|\s)(\*\*?)(\s*)$/gm, '$1$3');

  // Odd count of ** → drop the last leftover opener
  let boldMarks = out.match(/\*\*/g);
  while (boldMarks && boldMarks.length % 2 === 1) {
    out = out.replace(/\*\*(?!.*\*\*)/, '');
    boldMarks = out.match(/\*\*/g);
  }

  // Protect balanced **bold** / *italic*, strip any remaining lone *
  out = stripUnpairedSingleAsterisks(out);

  // Tidying after removals
  out = out
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/([({\[]) +/g, '$1');

  return out;
}

function stripUnpairedSingleAsterisks(text: string): string {
  const placeholders: string[] = [];
  const stash = (value: string) => {
    const idx = placeholders.length;
    placeholders.push(value);
    return `\u0000${idx}\u0000`;
  };

  // Protect **bold** first so inner * is not treated as italic.
  let out = text.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => stash(`**${inner}**`));

  // Protect *italic* (single stars, not adjacent to another *)
  out = out.replace(
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    (_m, pre: string, inner: string) => `${pre}${stash(`*${inner}*`)}`,
  );

  // Anything left is orphan soup — drop it.
  out = out.replace(/\*/g, '');

  out = out.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => placeholders[Number(n)] ?? '');
  return out;
}
