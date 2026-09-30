/**
 * Render-time speaker labels.
 *
 * Mirrors backend/src/shared/askSpeakers.ts. Stored text such as
 * "Person 1 (Seated, Unknown Role)" displays as "Speaker 1". A role or
 * posture with no index displays as "Unidentified speaker". Prose uses
 * "an unidentified speaker" for those, and "Speaker N" for a Person N index.
 * Nothing here rewrites stored rows.
 */

export const UNIDENTIFIED_SPEAKER = 'Unidentified speaker';
export const UNIDENTIFIED_SPEAKER_PROSE = 'an unidentified speaker';

const VISUAL_LABEL =
  /\bperson\s*\d+\b|\bperson\s+[a-d]\b|\b(?:seated|standing|walking|kneeling|crouching)\b|\bunknown(?:\s+role)?\b|\bcrew-?like\b|\bpossible\b|\bunconfirmed\b|\b(?:gray|grey|white|black|blue|red|green)\s+shirt\b|[()]/i;

export function diarizationLabel(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const zeroBased = text.match(/^SPEAKER_(\d{1,3})\b/);
  if (zeroBased) return `Speaker ${Number(zeroBased[1]) + 1}`;
  const plain = text.match(/^(?:speaker|spk)[\s_-]*(\d{1,3}|[a-z])\b/i);
  if (plain)
    return `Speaker ${/^\d+$/.test(plain[1]!) ? Number(plain[1]) : plain[1]!.toUpperCase()}`;
  const person = text.match(/^person\s*(\d{1,3})\b/i);
  if (person) return `Speaker ${Number(person[1])}`;
  return null;
}

export function isFabricatedSpeakerLabel(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return true;
  if (diarizationLabel(text)) return false;
  if (VISUAL_LABEL.test(text)) return true;
  return /^(?:(?:the|a|an)\s+)?(?:man|woman|person|guy|girl|speaker|voice|someone|homeowner|crew(?: member)?|worker|contractor|client|customer|adjuster|tech(?:nician)?)$/i.test(
    text,
  );
}

/** The label a card, caption, or transcript row may show. */
export function displaySpeakerLabel(raw: unknown): string {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const diarized = diarizationLabel(text);
  if (diarized) return diarized;
  if (!text || text.length > 40 || isFabricatedSpeakerLabel(text)) return UNIDENTIFIED_SPEAKER;
  return text;
}

const SPEECH_AFTER =
  /^[\s,]*(?:\w+\s+){0,2}?(?:said|says|saying|asks|asked|asking|mentions|mentioned|replies|replied|told|tells|adds|added|answers|answered|responds|responded|commented|comments|remarks|remarked|notes|noted|explains|explained|speaks|spoke|is heard|was heard|committed|commits|agreed|agrees|promised|promises|volunteered|:|[-–—]\s*[“"])/i;
const SPEECH_BEFORE =
  /(?:said by|spoken by|from|according to|quote from|line from|asked by|voice of)\s*$/i;

function replacement(before: string, after: string): string {
  return SPEECH_AFTER.test(after) || SPEECH_BEFORE.test(before)
    ? UNIDENTIFIED_SPEAKER_PROSE
    : 'an unidentified person';
}

function articleFix(text: string): string {
  return text
    .replace(/\b(?:the|a|an|one)\s+(an unidentified (?:speaker|person))\b/gi, '$1')
    .replace(
      /(^\s*(?:[-*•]\s+)?|[.!?]\s+|\n\s*(?:[-*•]\s+)?|[“"]\s*)an unidentified (speaker|person)\b/g,
      (_m, lead: string, kind: string) => `${lead}An unidentified ${kind}`,
    );
}

/** Titles already named by this answer: "(Title, m:ss)" citations and clip= trailers. */
function titlesNamedInAnswer(raw: string): string[] {
  const found: string[] = [];
  for (const match of raw.matchAll(/\(([^()\n]+),\s*\d{1,2}:\d{2}(?::\d{2})?\)/g)) {
    const title = match[1]?.trim();
    if (title) found.push(title);
  }
  for (const match of raw.matchAll(/(?:^|[|])clip=([^|⟧\n]+)/g)) {
    const title = match[1]?.trim();
    if (title) found.push(title);
  }
  return found;
}

/**
 * Stored answer prose, normalized at render time. Quoted speech, timed
 * citations, and clip titles are evidence text and are left alone.
 */
export function sanitizeSpeakerProse(input: string, opts?: { protect?: string[] }): string {
  const raw = String(input ?? '');
  if (!raw) return raw;
  const masked: string[] = [];
  const mask = (value: string) => {
    masked.push(value);
    return `\uE000${masked.length - 1}\uE001`;
  };
  let text = raw.replace(
    /⟦[^⟧]*⟧|“[^”\n]*”|"[^"\n]*"|\([^()\n]*,\s*\d{1,2}:\d{2}(?::\d{2})?\)/g,
    mask,
  );
  const titles = [
    ...new Set(
      [...(opts?.protect ?? []), ...titlesNamedInAnswer(raw)]
        .map((title) => String(title ?? '').trim())
        .filter((title) => title.length >= 3),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const title of titles) {
    text = text.split(title).join(mask(title));
  }
  text = sanitizeUnmasked(text);
  return text.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => masked[Number(i)] ?? '');
}

function sanitizeUnmasked(input: string): string {
  let text = input;
  const patterns: RegExp[] = [
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
      const person = match.match(/\bPerson\s+(\d+)/i);
      if (person) return `Speaker ${Number(person[1])}`;
      if (/unknown speaker/i.test(match)) return UNIDENTIFIED_SPEAKER_PROSE;
      return replacement(before, after);
    });
  }
  text = text.replace(/\s*\((?:an unidentified speaker|unidentified speaker)\)/gi, '');
  // A tentative role is a guess. Evidence, quotes, and exports keep Speaker N.
  text = text.replace(/\s+\((?:likely\s+)?(?:homeowner|subcontractor|crew|adjuster|other)\)/gi, '');
  return articleFix(text);
}
