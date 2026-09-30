/**
 * Tentative role guesses for speakers who are not identified.
 *
 * The guess comes from what that speaker says. When an Ask provider is
 * configured, the existing completion path (`completeAskText`) is asked for
 * JSON. Otherwise a transcript-grounded reading of the same roles is stored.
 * Either way the quote must be an exact substring of that speaker's line.
 * Roles only — never a name. A guess is not an identity.
 */

import type { TranscriptLine } from './speakerNamePickup.js';

export const SPEAKER_ROLES = ['homeowner', 'subcontractor', 'crew', 'adjuster', 'other'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export type RoleGuess = {
  speakerLabel: string;
  role: SpeakerRole;
  confidence: number;
  tSec: number | null;
  quote: string;
  source: 'llm' | 'transcript';
};

const ROLE_SET = new Set<string>(SPEAKER_ROLES);

const CUES: Array<{ role: SpeakerRole; pattern: RegExp; confidence: number }> = [
  { role: 'homeowner', pattern: /\b(?:my house|my home|i live here|our deductible|my deductible|my kitchen|my bathroom|the adjuster told me|we're the owners|we own the (?:house|home))\b/i, confidence: 0.62 },
  { role: 'adjuster', pattern: /\b(?:i['’]?m the adjuster|the carrier|claim number|this claim|coverage|scope of loss|depreciation)\b/i, confidence: 0.64 },
  { role: 'subcontractor', pattern: /\b(?:we sub(?:contract)?|i['’]?m the (?:plumber|electrician|roofer)|our bid|my (?:sub )?crew will)\b/i, confidence: 0.6 },
  { role: 'crew', pattern: /\b(?:we['’]?ll tear out|on the truck|let me grab|we['’]?re pulling|i['’]?ll get the (?:fan|meter|saw))\b/i, confidence: 0.58 },
];

function clampConfidence(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function asRole(raw: unknown): SpeakerRole | null {
  const role = String(raw ?? '').trim().toLowerCase();
  return ROLE_SET.has(role) ? (role as SpeakerRole) : null;
}

function speakerLines(lines: TranscriptLine[]): Map<string, TranscriptLine[]> {
  const groups = new Map<string, TranscriptLine[]>();
  for (const line of lines) {
    const label = line.speakerLabel?.trim() || 'Unidentified speaker';
    const list = groups.get(label) ?? [];
    list.push(line);
    groups.set(label, list);
  }
  return groups;
}

function quoteIsExact(quote: string, lines: TranscriptLine[]): TranscriptLine | null {
  const needle = quote.replace(/\s+/g, ' ').trim();
  if (needle.length < 3) return null;
  for (const line of lines) {
    if (line.text.includes(needle)) return line;
  }
  return null;
}

/** Parse a model JSON payload. Drops any guess whose quote is not verbatim. */
export function parseRoleGuessResponse(raw: string, lines: TranscriptLine[]): RoleGuess[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const guesses = parsed && typeof parsed === 'object' ? (parsed as { guesses?: unknown }).guesses : null;
  if (!Array.isArray(guesses)) return [];
  const groups = speakerLines(lines);
  const out: RoleGuess[] = [];
  const seen = new Set<string>();
  for (const row of guesses) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { speaker?: unknown; role?: unknown; confidence?: unknown; quote?: unknown; name?: unknown };
    if (rec.name) continue;
    const role = asRole(rec.role);
    const quote = String(rec.quote ?? '').replace(/\s+/g, ' ').trim();
    const requested = String(rec.speaker ?? '').trim();
    if (!role || !quote) continue;
    const pool = groups.get(requested) ?? [...groups.values()].flat();
    const hit = quoteIsExact(quote, requested ? (groups.get(requested) ?? []) : pool);
    if (!hit) continue;
    const speakerLabel = hit.speakerLabel?.trim() || requested || 'Unidentified speaker';
    if (seen.has(speakerLabel.toLowerCase())) continue;
    seen.add(speakerLabel.toLowerCase());
    out.push({
      speakerLabel,
      role,
      confidence: clampConfidence(rec.confidence, 0.55),
      tSec: hit.tSec,
      quote,
      source: 'llm',
    });
  }
  return out;
}

/** Role from the words on the line. Used when Ask has no provider configured. */
export function lexicalRoleGuesses(lines: TranscriptLine[], identified: Set<string>): RoleGuess[] {
  const out: RoleGuess[] = [];
  const seen = new Set<string>();
  for (const [label, group] of speakerLines(lines)) {
    if (identified.has(label.toLowerCase())) continue;
    if (seen.has(label.toLowerCase())) continue;
    for (const line of group) {
      const cue = CUES.find((row) => row.pattern.test(line.text));
      if (!cue) continue;
      const match = line.text.match(cue.pattern);
      const quote = match?.[0] ?? '';
      if (!quote || !line.text.includes(quote)) continue;
      seen.add(label.toLowerCase());
      out.push({
        speakerLabel: label,
        role: cue.role,
        confidence: cue.confidence,
        tSec: line.tSec,
        quote,
        source: 'transcript',
      });
      break;
    }
  }
  return out;
}

export function roleGuessPrompt(lines: TranscriptLine[]): { system: string; user: string } {
  const body = lines
    .map((line) => {
      const who = line.speakerLabel?.trim() || 'Unidentified speaker';
      const at = line.tSec == null ? '' : ` [${line.tSec}]`;
      return `${who}${at}: ${line.text}`;
    })
    .join('\n');
  return {
    system: [
      'You label unidentified speakers with a tentative role from their own words.',
      'Allowed roles: homeowner, subcontractor, crew, adjuster, other.',
      'Never guess a personal name. Never use who filmed the clip.',
      'Return JSON only: {"guesses":[{"speaker":"Speaker 1","role":"homeowner","confidence":0.6,"quote":"exact words"}]}',
      'quote must be copied exactly from that speaker\'s line. Omit a speaker when the words do not support a role.',
    ].join(' '),
    user: body || 'No transcript lines.',
  };
}

export type RoleCompleter = (input: { system: string; user: string }) => Promise<{ text: string } | null>;

/** LLM first, using the caller-supplied Ask completion. Lexical only if that returns nothing. */
export async function guessSpeakerRoles(
  lines: TranscriptLine[],
  identified: Iterable<string>,
  complete?: RoleCompleter | null,
): Promise<RoleGuess[]> {
  const identifiedSet = new Set([...identified].map((label) => label.toLowerCase()));
  const open = lines.filter((line) => !identifiedSet.has((line.speakerLabel?.trim() || 'Unidentified speaker').toLowerCase()));
  if (!open.length) return [];
  if (complete) {
    try {
      const prompt = roleGuessPrompt(open);
      const result = await complete(prompt);
      const parsed = result?.text ? parseRoleGuessResponse(result.text, open) : [];
      if (parsed.length) return parsed.filter((guess) => !identifiedSet.has(guess.speakerLabel.toLowerCase()));
    } catch {
      /* fall through to the transcript reading */
    }
  }
  return lexicalRoleGuesses(open, identifiedSet);
}
