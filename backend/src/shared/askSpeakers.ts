/**
 * Speaker labels in Ask.
 *
 * Only diarization output names a speaker ("Speaker 1", "Speaker 2"), or a
 * name the file explicitly attaches to that diarized speaker. Nothing is ever
 * inferred: not a name from who filmed the clip, not a role, posture, or
 * relationship from the video reading. When a speaker is not identified the
 * label is "Unidentified speaker" and prose says "an unidentified speaker",
 * with nothing appended.
 */

export const UNIDENTIFIED_SPEAKER = 'Unidentified speaker';
export const UNIDENTIFIED_SPEAKER_PROSE = 'an unidentified speaker';

/**
 * A diarization label as Ask shows it. Zero-based transcriber ids
 * (SPEAKER_00) become one-based. Anything else returns null.
 */
export function diarizationLabel(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const zeroBased = text.match(/^SPEAKER_(\d{1,3})$/);
  if (zeroBased) return `Speaker ${Number(zeroBased[1]) + 1}`;
  const plain = text.match(/^(?:speaker|spk)[\s_-]*(\d{1,3}|[a-z])$/i);
  if (plain) return `Speaker ${/^\d+$/.test(plain[1]!) ? Number(plain[1]) : plain[1]!.toUpperCase()}`;
  return null;
}

const VISUAL_LABEL =
  /\bperson\s*\d+\b|\bperson\s+[a-d]\b|\b(?:seated|standing|walking|kneeling|crouching)\b|\bunknown(?:\s+role)?\b|\bcrew-?like\b|\bpossible\b|\bunconfirmed\b|\b(?:gray|grey|white|black|blue|red|green)\s+shirt\b|[()]/i;

/** A visual or guessed label ("Person 1 (Seated", "Seated man", "Unknown"), not an identity. */
export function isFabricatedSpeakerLabel(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return true;
  if (diarizationLabel(text)) return false;
  if (VISUAL_LABEL.test(text)) return true;
  return /^(?:(?:the|a|an)\s+)?(?:man|woman|person|guy|girl|speaker|voice|someone|homeowner|crew(?: member)?|worker|contractor|client|customer|adjuster|tech(?:nician)?)$/i.test(text);
}

/**
 * The label Ask may show for a speaker: a diarization label, a name the file
 * explicitly gave that speaker, or "Unidentified speaker".
 */
export function speakerLabelOrUnidentified(raw: unknown): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const diarized = diarizationLabel(text);
  if (diarized) return diarized;
  if (!text || text.length > 40 || isFabricatedSpeakerLabel(text)) return UNIDENTIFIED_SPEAKER;
  return text;
}

/**
 * Speaker labels from diarization on a clip's findings (people.speakers[]).
 * Visual people labels are never used as speakers.
 */
export function diarizedSpeakerLabels(findings: unknown): string[] {
  if (!findings || typeof findings !== 'object') return [];
  const root = findings as Record<string, unknown>;
  const block = root.people && typeof root.people === 'object' ? (root.people as Record<string, unknown>) : root;
  const speakers = Array.isArray(block.speakers) ? block.speakers : [];
  const out: string[] = [];
  for (const row of speakers) {
    if (!row || typeof row !== 'object') continue;
    const speaker = row as { displayName?: unknown; speakerLabel?: unknown };
    const name = String(speaker.displayName ?? '').trim();
    const label =
      name && !isFabricatedSpeakerLabel(name) && name.length <= 40 ? name : diarizationLabel(speaker.speakerLabel);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

const SPEECH_AFTER =
  /^[\s,]*(?:\w+\s+){0,2}?(?:said|says|saying|asks|asked|asking|mentions|mentioned|replies|replied|told|tells|adds|added|answers|answered|responds|responded|commented|comments|remarks|remarked|notes|noted|explains|explained|speaks|spoke|is heard|was heard|committed|commits|agreed|agrees|promised|promises|volunteered|:|[-–—]\s*[“"])/i;
const SPEECH_BEFORE = /(?:said by|spoken by|from|according to|quote from|line from|asked by|voice of)\s*$/i;

function replacement(before: string, after: string): string {
  return SPEECH_AFTER.test(after) || SPEECH_BEFORE.test(before) ? UNIDENTIFIED_SPEAKER_PROSE : 'an unidentified person';
}

function articleFix(text: string): string {
  return text
    .replace(/\b(?:the|a|an|one)\s+(an unidentified (?:speaker|person))\b/gi, '$1')
    .replace(/(^\s*(?:[-*•]\s+)?|[.!?]\s+|\n\s*(?:[-*•]\s+)?|[“"]\s*)an unidentified (speaker|person)\b/g, (_m, lead: string, kind: string) => `${lead}An unidentified ${kind}`);
}

/**
 * Replace fabricated speaker labels in answer prose. "Person 1 (Seated,
 * Unknown Role) said" and "the seated man said" become "an unidentified
 * speaker said". A dangling "Person 1 (Seated" (the old comma-split bug) is
 * removed whole, so no unclosed parenthesis survives.
 */
export function sanitizeSpeakerProse(input: string, opts?: { protect?: string[] }): string {
  const raw = String(input ?? '');
  if (!raw) return raw;
  // Quoted speech, "(Clip, m:ss)" attachments, machine trailers and clip titles
  // are evidence text, not labels: mask them so they are never rewritten.
  const masked: string[] = [];
  const mask = (value: string) => {
    masked.push(value);
    return `\uE000${masked.length - 1}\uE001`;
  };
  let text = raw.replace(/⟦[^⟧]*⟧|“[^”\n]*”|"[^"\n]*"|\([^()\n]*,\s*\d{1,2}:\d{2}(?::\d{2})?\)/g, mask);
  const titles = [...new Set((opts?.protect ?? []).map((t) => String(t ?? '').trim()).filter((t) => t.length >= 3))].sort(
    (x, y) => y.length - x.length,
  );
  for (const title of titles) {
    text = text.split(title).join(mask(title));
  }
  text = sanitizeUnmasked(text);
  return text.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => masked[Number(i)] ?? '');
}

function sanitizeUnmasked(input: string): string {
  let text = input;
  const patterns: RegExp[] = [
    // "Person 1 (Seated, Unknown Role)" and the unclosed "Person 1 (Seated".
    /\bPerson\s+\d+\s*\((?:[^()\n⟧|]*\)|[A-Z][\w/'-]*(?:,?\s+[A-Z][\w/'-]*){0,5})/g,
    /\bPerson\s+\d+\b/g,
    /\b(?:(?:the|a|an|one)\s+)?(?:seated|standing|walking|kneeling|crouching)\s+(?:man|woman|person|guy|girl|speaker)\b/gi,
    /\b(?:(?:the|a|an)\s+)?unknown speaker\b/gi,
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern, (match: string, ...args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      const before = whole.slice(Math.max(0, offset - 24), offset);
      const after = whole.slice(offset + match.length, offset + match.length + 40);
      if (/unknown speaker/i.test(match)) return UNIDENTIFIED_SPEAKER_PROSE;
      return replacement(before, after);
    });
  }
  // "(an unidentified speaker)" appended after a label adds nothing.
  text = text.replace(/\s*\((?:an unidentified speaker|unidentified speaker)\)/gi, '');
  return articleFix(text);
}
