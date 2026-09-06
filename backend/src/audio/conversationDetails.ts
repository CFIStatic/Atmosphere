/**
 * Pull the useful facts out of a filed mic transcript.
 *
 * Some day films are work. Some are the contractor standing in the kitchen
 * talking to the homeowner. Both are evidence. Vision already described the
 * frames; this is the matching pass for what was said — agreements, rooms,
 * insurance, leaks, "please don't" — so Ask can answer without a second listen.
 *
 * Deterministic on purpose. A model can rewrite the same sentences later;
 * the office still gets the facts when no provider is configured.
 */

export type ConversationDetails = {
  summary: string | null;
  details: string[];
  agreements: string[];
  concerns: string[];
  roomsMentioned: string[];
};

const ROOMS = [
  'bathroom',
  'kitchen',
  'bedroom',
  'living room',
  'dining room',
  'hallway',
  'garage',
  'basement',
  'attic',
  'laundry',
  'closet',
  'office',
  'den',
  'foyer',
  'stair',
  'roof',
  'driveway',
  'yard',
];

const DETAIL =
  /\b(said|says|told|asked|agreed|approve|approved|declined|don't|do not|insurance|adjuster|claim|leak|mold|water|replace|mirror|cabinet|drywall|flood|cut|extra|change order|deductible|homeowner|owner)\b/i;

const AGREEMENT =
  /\b(agreed|agreement|approve|approved|go ahead|yes[,.]|that's fine|ok to|okay to|you can|please (do|go)(?! not))\b/i;

const CONCERN =
  /\b(don't|do not|worried|concern|mold|leak|smell|refused|declined|not in scope|out of scope|extra|charge)\b/i;

export function conversationSentences(text: string): string[] {
  return text
    .replace(/\[(?:\d+:)+\d+\]/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 12);
}

function unique(values: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function roomsMentionedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return ROOMS.filter((room) => lower.includes(room));
}

export function extractConversationDetails(transcript: string | null | undefined): ConversationDetails {
  const raw = String(transcript || '').trim();
  if (!raw) {
    return { summary: null, details: [], agreements: [], concerns: [], roomsMentioned: [] };
  }

  const lines = conversationSentences(raw);
  const details = unique(lines.filter((line) => DETAIL.test(line)));
  const agreements = unique(lines.filter((line) => AGREEMENT.test(line)));
  const concerns = unique(lines.filter((line) => CONCERN.test(line)));
  const roomsMentioned = roomsMentionedIn(raw);

  const lead = details[0] || lines[0] || raw.slice(0, 240);
  const summary = roomsMentioned.length
    ? `Conversation on site covering ${roomsMentioned.slice(0, 4).join(', ')}. ${lead}`
    : `Conversation on site. ${lead}`;

  return {
    summary: summary.slice(0, 500),
    details,
    agreements,
    concerns,
    roomsMentioned,
  };
}

/** Real talk worth a timeline row — not an empty, skipped, or noise-only mic. */
export function hasConversation(details: ConversationDetails): boolean {
  return (
    details.details.length > 0 ||
    details.agreements.length > 0 ||
    details.concerns.length > 0 ||
    details.roomsMentioned.length > 0
  );
}
