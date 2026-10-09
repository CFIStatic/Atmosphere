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
/**
 * How every Chat reply should sound. Shared by the job-file, lookup, clip and
 * upload prompts so they all read like Grok Bot.
 */
export const CHAT_VOICE_RULES = `VOICE (Grok Bot quality — every Chat reply):
- Lead with the answer: the yes/no, the number, the name or the recommendation comes first. Don't restate the question. No meta openers ("Here's a summary", "Based on the job file", "Great question"). No filler closings ("Let me know if…", "Hope this helps", "Feel free to ask").
- Warm, plain, natural language with contractions (it's, didn't, you'll). Most answers are 1–3 short sentences. Go longer only when they ask for detail, a list, a draft or a full breakdown.
- Prose by default. Bullets only for genuinely parallel items; numbered lists only for steps; headers only for long multi-part breakdowns. Bold sparingly: a key number or name at most, never every label.
- Evidence: quote only when the quote supports a claim, inline in the sentence with the clip and time, like: The homeowner wants the skylights left alone: “Don't touch the skylights.” (Kitchen walkthrough, 0:15). Never reply with only a quote. Documents have no speakers; name the file instead.
- No internal or system text: no section tags ("brief ·", "scope · excluded"), no field or column names (jobNumber, workDate, claim_number), no raw errors or status codes, no comment on whether an uploaded file is about this job. Mention "the job file" only when it actually helps the reader.
- A very short message ("?", "ok", "hi", "thanks") gets a short friendly reply: acknowledge it or ask what they'd like to know. Never an error or a refusal.`;

export const ASK_PROSE_FORMAT_RULES = `${CHAT_VOICE_RULES}

FORMAT (Grok Bot quality — the UI renders safe markdown):
- Glance-simple first: plain short paragraphs. A tight "-" bullet list only when listing parallel facts; save long quotes and timestamps for when they ask for depth.
- Use markdown for structure only: **bold** sparingly for a key fact or a short label, *italics* rarely, \`inline code\` only for a code someone would type (a lockbox or gate code), and a simple table only for side-by-side comparisons.
- Never dump raw asterisk soup (no "***", no decorative * around every phrase, no unbalanced **). orphan stars must never appear in the answer.
- Capability-only asks ("can you search Google/the web?", "are you connected?") → 1–3 short sentences saying yes (when web search is available), optionally offer to search something specific. Do NOT live-search, do NOT append ⟦web:…⟧ / [[web:…]], and do NOT cite google.com or how-to-search pages.
- No images, no HTML, no code fences unless quoting a short on-file code-like string. Headings (##) only for long multi-part breakdowns. Do not write markdown links, bare URLs, or a Web results heading. The app attaches web sources separately. Never write ⟦web:…⟧ or [[web:…]].
- Stay grounded: only facts from the record — never invent evidence.

` + ASK_SOURCE_FORMAT_RULES;

/** A "heading" longer than this is a scraped paragraph, not a title. */
const MAX_HEADING_CHARS = 64;

/**
 * Leftovers of scraped web pages that must never show in a Chat answer:
 * "[...]" / "[…]" elision marks, heading markers in the middle of a line
 * ("Final ### Week 3"), and site labels glued to text ("Team LogoCOLTS").
 * Mid-line markers start a new paragraph; an over-long heading line is kept
 * as a plain paragraph. Mirrored by the office renderer (frontend/src/lib/askProse.ts).
 */
export function stripScrapeJunk(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;
  const fences: string[] = [];
  text = text.replace(/(```|~~~)[\s\S]*?\1/g, (block) => {
    fences.push(block);
    return `\uE000${fences.length - 1}\uE000`;
  });
  text = text
    .replace(/[ \t]*\[\s*(?:\.\s*){3}\]|[ \t]*\[\s*…\s*\]/g, ' ')
    .replace(/[ \t]*\bTeam Logo(?:[A-Z]{2,}(?=[\d\s,.;:]|$))?/g, ' ')
    .replace(/[ \t]*\bWatch Replay\b/g, '')
    // "text ### Heading" → paragraph break before the heading text.
    .replace(/([^\s#])[ \t]+#{2,6}[ \t]+(?=\S)/g, '$1\n\n')
    .split('\n')
    .map((line) => {
      const heading = line.match(/^(\s*)(#{1,6})[ \t]*(\S.*)$/);
      if (!heading) return line.replace(/(\S)[ \t]{2,}/g, '$1 ');
      const hashes = heading[2] ?? '';
      const body = (heading[3] ?? '').trim();
      // "#1 pick" / "#5" are not headings.
      if (hashes.length === 1 && !/^\s*#\s/.test(line)) return line;
      if (body.replace(/\s+#+\s*$/, '').length > MAX_HEADING_CHARS) return `${heading[1] ?? ''}${body}`;
      return `${heading[1] ?? ''}${hashes} ${body}`.replace(/(\S)[ \t]{2,}/g, '$1 ');
    })
    .join('\n');
  return text.replace(/\uE000(\d+)\uE000/g, (_m, n: string) => fences[Number(n)] ?? '');
}

/**
 * Light cleanup before store/return. Keeps intentional **bold** / *italic*
 * for the UI renderer; fixes list markers and strips orphan emphasis.
 */
export function normalizeAskProse(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;

  text = stripScrapeJunk(text);

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
    .replace(/([({[]) +/g, '$1');

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

  // eslint-disable-next-line no-control-regex -- strips control characters on purpose
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => placeholders[Number(n)] ?? '');
  return out;
}

const META_OPENER_LINE_RE =
  /^(?:here(?:'|’)s|here is|below is|sure[,!]? here(?:'|’)s)\b[^\n]{0,80}:\s*$/i;
const META_OPENER_PREFIX_RE =
  /^(?:(?:certainly|great question|sure thing|of course|absolutely|happy to help)[!.,]?\s+|(?:here(?:'|’)s|here is) (?:a |the |my |what |an )?(?:quick |short |brief )?(?:summary|overview|rundown|breakdown|answer)[^:.\n]{0,40}:\s+|based on (?:the |this )(?:job file|record|file|documents?|uploaded (?:file|document)s?)[^,\n]{0,30},\s+)/i;
const FILLER_CLOSING_RE =
  /\s*(?:(?:please )?let me know if\b[^.!?\n]*[.!?]|i hope (?:this|that) helps\b[^.!?\n]*[.!?]|hope (?:this|that) helps\b[^.!?\n]*[.!?]|feel free to\b[^.!?\n]*[.!?]|if you (?:have|need) any (?:other|more|further) (?:questions|help)\b[^.!?\n]*[.!?]|is there anything else\b[^.!?\n]*[.!?]|happy to help(?: further| more)?[.!]?)\s*$/i;
/** A request to write something on the user's behalf: leave its wording alone. */
const DRAFT_REQUEST_RE = /\b(?:draft|write|compose|email|e-mail|text message|letter|reply to|message to)\b/i;

/**
 * Drop meta openers ("Here's a summary:") and filler closings ("Let me know
 * if…") from a Chat reply so it leads with the answer, like Grok Bot. Only the
 * first and last prose paragraphs are touched; ⟦artifact⟧ drafts, machine
 * trailers and drafting requests are left as written.
 */
export function trimChatFiller(input: string, opts?: { question?: string | null }): string {
  const text = String(input ?? '');
  if (!text.trim()) return text;
  if (DRAFT_REQUEST_RE.test(String(opts?.question ?? ''))) return text;
  if (/⟦artifact⟧/.test(text)) return text;

  const trailerAt = text.search(/\n*⟦(?:sources|quotes|followups|actions|web)\b/);
  const body = trailerAt >= 0 ? text.slice(0, trailerAt) : text;
  const trailer = trailerAt >= 0 ? text.slice(trailerAt) : '';

  const paragraphs = body.split(/\n{2,}/);
  // Opener: a whole "Here's a summary:" line, or a prefix on the first line.
  if (paragraphs.length > 1 && !paragraphs[0]!.includes('\n') && META_OPENER_LINE_RE.test(paragraphs[0]!.trim())) {
    paragraphs.shift();
  } else if (paragraphs.length) {
    const lines = paragraphs[0]!.split('\n');
    if (lines.length > 1 && META_OPENER_LINE_RE.test(lines[0]!.trim())) lines.shift();
    const first = lines[0] ?? '';
    const stripped = first.replace(META_OPENER_PREFIX_RE, '');
    if (stripped !== first && stripped.trim()) lines[0] = stripped.replace(/^([a-z])/, (c) => c.toUpperCase());
    paragraphs[0] = lines.join('\n');
  }
  // Closing: filler sentence(s) at the end of the last prose paragraph.
  for (let guard = 0; guard < 3 && paragraphs.length; guard += 1) {
    const lastIndex = paragraphs.length - 1;
    const last = paragraphs[lastIndex]!;
    if (/^\s*(?:[-*•]|\d+[.)]|\|)/m.test(last.split('\n').pop() ?? '')) break;
    const next = last.replace(FILLER_CLOSING_RE, '');
    if (next === last) break;
    if (next.trim()) paragraphs[lastIndex] = next.trimEnd();
    else if (paragraphs.length > 1) paragraphs.pop();
    else break;
  }
  const cleaned = paragraphs.join('\n\n').trimEnd();
  if (!cleaned.trim()) return text;
  return trailer ? `${cleaned}\n\n${trailer.replace(/^\n+/, '')}` : cleaned;
}
