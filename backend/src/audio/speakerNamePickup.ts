/**
 * Candidate names from what a diarized speaker says.
 *
 * A self-introduction ("I'm Marco") attaches to the speaker of that line.
 * A direct address ("hey Marco") attaches to the other diarized speaker when
 * the clip makes that person obvious (they answer next, or they are the only
 * other speaker). The line itself is kept as an exact quote with its timestamp.
 * Nothing here confirms an identity.
 */

export type TranscriptLine = {
  speakerLabel: string | null;
  text: string;
  tSec: number | null;
};

export type NameCandidate = {
  speakerLabel: string;
  name: string;
  kind: 'self_introduction' | 'direct_address';
  tSec: number | null;
  quote: string;
};

const ROLE_OR_FILLER =
  /^(?:speaker|person|homeowner|owner|crew|adjuster|inspector|subcontractor|contractor|customer|client|tech|technician|guy|man|woman|someone|hey|hi|hello|yo|the|a|an|i|im|it's|its)$/i;

const NAME = String.raw`[A-Z][a-z]+(?:['’-][A-Z][a-z]+)?(?:\s+[A-Z][a-z]+(?:['’-][A-Z][a-z]+)?){0,2}`;

const SELF_INTRO = new RegExp(
  String.raw`\b(?:i\s*am|i['’]?m|my name is|this is|it['’]?s|name['’]?s)\s+(${NAME})\b`,
  'gi',
);

const DIRECT_ADDRESS = new RegExp(String.raw`\b(?:hey|hi|hello|yo)\s+(${NAME})\b`, 'gi');

const VOCATIVE = new RegExp(String.raw`^(${NAME}),\s+\S`);

function cleanName(raw: string): string | null {
  const name = raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  if (!name || name.length > 60) return null;
  const parts = name.split(' ');
  if (parts.some((part) => ROLE_OR_FILLER.test(part))) return null;
  return name;
}

function quoteFor(line: string, name: string): string | null {
  const at = line.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, line.lastIndexOf(' ', Math.max(0, at - 24)));
  const end = Math.min(line.length, at + name.length + 24);
  const slice = line.slice(start, end).trim();
  return slice.toLowerCase().includes(name.toLowerCase()) ? slice : line.slice(at, at + name.length);
}

/** SPEAKER_00 and "Speaker 2" both become the office label. */
export function officeSpeakerLabel(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return 'Unidentified speaker';
  const zero = text.match(/^SPEAKER_(\d{1,3})\b/i);
  if (zero) return `Speaker ${Number(zero[1]) + 1}`;
  const plain = text.match(/^(?:speaker|spk)[\s_-]*(\d{1,3}|[a-z])\b/i);
  if (plain) return `Speaker ${/^\d+$/.test(plain[1]!) ? Number(plain[1]) : plain[1]!.toUpperCase()}`;
  return text;
}

/** Lines from a stamped transcript. Speaker prefixes are optional. */
export function linesFromTranscript(transcript: string | null | undefined): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const rawLine of String(transcript ?? '').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let rest = line;
    let tSec: number | null = null;
    const stamp = rest.match(/^\[(\d+):(\d{2})(?::(\d{2}))?\]\s*/);
    if (stamp) {
      const h = stamp[3] != null ? Number(stamp[1]) : 0;
      const m = stamp[3] != null ? Number(stamp[2]) : Number(stamp[1]);
      const s = stamp[3] != null ? Number(stamp[3]) : Number(stamp[2]);
      tSec = h * 3600 + m * 60 + s;
      rest = rest.slice(stamp[0].length);
    }
    let speakerLabel: string | null = null;
    const prefix = rest.match(/^((?:SPEAKER_\d{1,3}|(?:speaker|spk)[\s_-]*(?:\d{1,3}|[a-z]))):\s+(\S[\s\S]*)$/i);
    if (prefix) {
      speakerLabel = prefix[1] ?? null;
      rest = prefix[2] ?? '';
    }
    const text = rest.replace(/\s+/g, ' ').trim();
    if (text) lines.push({ speakerLabel: speakerLabel ? officeSpeakerLabel(speakerLabel) : null, text, tSec });
  }
  return lines;
}

function otherSpeaker(lines: TranscriptLine[], index: number): string | null {
  const current = lines[index]?.speakerLabel?.trim() || null;
  const next = lines[index + 1];
  if (next?.speakerLabel && next.speakerLabel.trim() && next.speakerLabel.trim() !== current) {
    return next.speakerLabel.trim();
  }
  const others = new Set<string>();
  for (const line of lines) {
    const label = line.speakerLabel?.trim();
    if (label && label !== current) others.add(label);
  }
  if (others.size === 1) return [...others][0]!;
  return null;
}

function pushCandidate(
  out: NameCandidate[],
  seen: Set<string>,
  candidate: NameCandidate,
): void {
  const key = `${candidate.speakerLabel.toLowerCase()}|${candidate.name.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(candidate);
}

/**
 * Candidate names only. Self-introductions name the speaker of the line.
 * Direct address names someone else, and is dropped when that person cannot
 * be tied to a diarized speaker.
 */
export function pickupSpeakerNames(lines: TranscriptLine[]): NameCandidate[] {
  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const text = line.text;
    SELF_INTRO.lastIndex = 0;
    for (const match of text.matchAll(SELF_INTRO)) {
      const name = cleanName(match[1] ?? '');
      if (!name) continue;
      const quote = quoteFor(text, name);
      if (!quote || !text.includes(quote) && !text.includes(name)) continue;
      pushCandidate(out, seen, {
        speakerLabel: line.speakerLabel?.trim() || 'Unidentified speaker',
        name,
        kind: 'self_introduction',
        tSec: line.tSec,
        quote: text.includes(quote) ? quote : name,
      });
    }
    const addressed = new Set<string>();
    DIRECT_ADDRESS.lastIndex = 0;
    for (const match of text.matchAll(DIRECT_ADDRESS)) {
      const name = cleanName(match[1] ?? '');
      if (name) addressed.add(name);
    }
    const vocative = text.match(VOCATIVE);
    if (vocative) {
      const name = cleanName(vocative[1] ?? '');
      if (name) addressed.add(name);
    }
    for (const name of addressed) {
      const speaker = otherSpeaker(lines, index);
      if (!speaker) continue;
      const quote = quoteFor(text, name);
      if (!quote) continue;
      pushCandidate(out, seen, {
        speakerLabel: speaker,
        name,
        kind: 'direct_address',
        tSec: line.tSec,
        quote,
      });
    }
  });
  return out;
}
