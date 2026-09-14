/**
 * Speaker identity: replace generic Speaker A/B with real names only when
 * we can do so accurately.
 *
 * Paths (in priority order):
 *   1. roster — visible name text matches an org member (never face-match)
 *   2. ocr — readable nameplate / chyron / badge text on screen
 *   3. web — public broadcast / media-in-frame ONLY, high-confidence identify
 *      with a cited source (Gemini + optional Google Search grounding)
 *
 * Guardrails:
 *   - Never invent names. Uncertainty → keep role / Speaker N.
 *   - Private Field Capture / job footage: web face-search is OFF by default.
 *   - Voice celebrity DB is not faked; voice method reserved for future
 *     in-clip / labeled-prior embedding match.
 */

import {
  matchPeopleToOrgMembers,
  type OrgMemberHint,
  type PeoplePresent,
  type PersonPresent,
  type SpeakerIndex,
} from './peoplePresent.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';

export type IdentityMethod = 'roster' | 'ocr' | 'web' | 'voice' | 'unknown';

export type SceneKind = 'private_job' | 'public_media' | 'unknown';

export type SpeakerIdentity = {
  displayName: string;
  confidence: number;
  method: IdentityMethod;
  source: string | null;
  personId: string | null;
};

const WEB_MIN_CONFIDENCE = 0.85;
const OCR_MIN_CONFIDENCE = 0.8;
const ROSTER_MIN_CONFIDENCE = 0.75;

function clampConfidence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function looksLikeLegalName(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length < 3 || s.length > 80) return false;
  if (
    /^(person|speaker|crew|homeowner|owner|tech|contractor|worker|adjuster|inspector|host|guest)\b/i.test(
      s,
    )
  ) {
    return false;
  }
  // Two+ capitalized tokens, or a single well-known mononym with capital.
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+$/.test(s)) return true;
  if (/^[A-Z][a-z]{2,}$/.test(s) && !/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(s)) {
    return false; // single token alone is too weak without context
  }
  return false;
}

/**
 * Classify whether web identify is allowed.
 * Public broadcast / podcast / TV / YouTube-in-frame → public_media.
 * Typical Field Capture jobsite → private_job (web OFF).
 */
export function classifySceneKind(input: {
  narrationText?: string | null;
  summary?: string | null;
  sourceHint?: string | null;
  allowWebIdentify?: boolean | null;
}): SceneKind {
  if (input.allowWebIdentify === false) return 'private_job';
  if (input.allowWebIdentify === true) return 'public_media';

  const blob = [input.narrationText, input.summary, input.sourceHint]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!blob.trim()) return 'unknown';

  const media =
    /\b(youtube|podcast|broadcast|tv\b|television|msnbc|cnn|fox news|chyron|lower.?third|talk show|interview desk|news desk|livestream|streamed|host and guest)\b/.test(
      blob,
    ) || /\b(on[- ]screen (logo|text|name)|network logo|show logo)\b/.test(blob);

  const jobsite =
    /\b(job ?site|jobsite|field capture|bathroom|drywall|vanity|roof|attic|crawlspace|water damage|restoration|crew|homeowner|adjuster on site|kitchen remodel)\b/.test(
      blob,
    );

  if (media && !jobsite) return 'public_media';
  if (jobsite && !media) return 'private_job';
  if (media && jobsite) {
    // Film of a screen on a job → treat as media for the on-screen figures only.
    if (/\b(watching|screen|tv|youtube|laptop|monitor)\b/.test(blob)) return 'public_media';
    return 'private_job';
  }
  return 'unknown';
}

/** Pull candidate name strings from narration / OCR-ish vision text. */
export function extractVisibleNameHints(texts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Capitalized name tokens only — no /i flag (that would let "talks at" look like names).
  // Letters / apostrophe / hyphen only — never "." which would eat "Name tag".
  const NAME_TOKEN = "[A-Z][A-Za-z'-]+";
  const push = (raw: string) => {
    const s = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!s || seen.has(s.toLowerCase())) return;
    if (!looksLikeLegalName(s) && !new RegExp(`^${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3}$`).test(s)) {
      return;
    }
    seen.add(s.toLowerCase());
    out.push(s);
  };

  for (const text of texts) {
    const src = String(text || '');
    if (!src.trim()) continue;

    // Explicit tags: "Name tag: Alex Rivera", "chyron: Lex Fridman", "Lower-third: …"
    // Keyword side is case-insensitive via character classes; name side stays case-sensitive.
    const tagged = new RegExp(
      `\\b(?:[Nn]ame\\s*[Tt]ag|[Nn]ame\\s*[Bb]adge|[Nn]ame\\s*[Pp]late|[Bb]adge|[Cc]hyron|[Ll]ower[\\s-]?[Tt]hird|[Oo]n[\\s-]?[Ss]creen(?:\\s+[Nn]ame)?|[Ll]abeled)\\s*[:\\-–—]\\s*(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,3})`,
      'g',
    );
    for (const m of src.matchAll(tagged)) {
      if (m[1]) push(m[1]);
    }

    // "with Lex Fridman" / "Host Lex Fridman" / "guest Joe Rogan"
    const hosted = new RegExp(
      `\\b(?:[Hh]ost|[Gg]uest|[Ss]peaker|[Ff]eaturing|[Ww]ith|[Ii]nterviewer|[Ii]nterviewee)\\s+(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})\\b`,
      'g',
    );
    for (const m of src.matchAll(hosted)) {
      if (m[1]) push(m[1]);
    }

    // Quoted nameplates in brackets
    const bracketed = new RegExp(`\\[(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3})\\]`, 'g');
    for (const m of src.matchAll(bracketed)) {
      if (m[1]) push(m[1]);
    }
  }

  return out.slice(0, 24);
}

function identityFromPerson(person: PersonPresent): SpeakerIdentity | null {
  const display =
    (typeof person.displayName === 'string' && person.displayName.trim()
      ? person.displayName.trim()
      : null) ||
    (person.matchedName && person.matchedName.trim() ? person.matchedName.trim() : null);
  if (!display) return null;
  const method: IdentityMethod =
    person.identityMethod === 'roster' ||
    person.identityMethod === 'ocr' ||
    person.identityMethod === 'web' ||
    person.identityMethod === 'voice'
      ? person.identityMethod
      : person.matchedOrgUserId
        ? 'roster'
        : person.identityMethod === 'unknown'
          ? 'unknown'
          : 'ocr';
  const confidence =
    clampConfidence(person.identityConfidence ?? person.matchConfidence) ??
    (method === 'roster' ? 0.85 : method === 'ocr' ? 0.8 : 0);
  if (confidence < 0.7) return null;
  return {
    displayName: display.slice(0, 80),
    confidence,
    method,
    source: typeof person.identitySource === 'string' ? person.identitySource : null,
    personId: person.id,
  };
}

/** Map diarization label → confident display identity. */
export function speakerIdentityMap(people: PeoplePresent): Map<string, SpeakerIdentity> {
  const map = new Map<string, SpeakerIdentity>();

  for (const sp of people.speakers) {
    const label = sp.speakerLabel?.trim();
    if (!label) continue;
    if (sp.displayName && (sp.identityConfidence ?? 0) >= 0.7) {
      map.set(label.toLowerCase(), {
        displayName: sp.displayName,
        confidence: sp.identityConfidence ?? 0.8,
        method: (sp.identityMethod as IdentityMethod) || 'unknown',
        source: sp.identitySource ?? null,
        personId: sp.personId,
      });
    }
  }

  for (const person of people.people) {
    const id = identityFromPerson(person);
    if (!id) continue;
    const label = person.speakerLabel?.trim();
    if (label && !map.has(label.toLowerCase())) {
      map.set(label.toLowerCase(), id);
    }
  }

  return map;
}

export function resolveSpeakerDisplayName(
  speakerLabel: string | null | undefined,
  people: PeoplePresent | null | undefined,
): string {
  const label = String(speakerLabel || '').trim();
  if (!label) return '';
  if (!people) return label;
  const hit = speakerIdentityMap(people).get(label.toLowerCase());
  return hit?.displayName || label;
}

/** Overlay display names onto turn / segment speaker labels when known. */
export function overlaySpeakerLabels<T extends { speakerLabel?: string | null }>(
  rows: T[],
  people: PeoplePresent | null | undefined,
): T[] {
  if (!people || !rows.length) return rows;
  const map = speakerIdentityMap(people);
  if (!map.size) return rows;
  return rows.map((row) => {
    const label = String(row.speakerLabel || '').trim();
    if (!label) return row;
    const hit = map.get(label.toLowerCase());
    if (!hit) return row;
    return { ...row, speakerLabel: hit.displayName };
  });
}

function applyIdentityToPerson(
  person: PersonPresent,
  identity: Omit<SpeakerIdentity, 'personId'> & { personId?: string | null },
): PersonPresent {
  return {
    ...person,
    label: identity.displayName,
    displayName: identity.displayName,
    matchedName: identity.method === 'roster' ? identity.displayName : person.matchedName ?? identity.displayName,
    matchConfidence: identity.confidence,
    identityConfidence: identity.confidence,
    identityMethod: identity.method,
    identitySource: identity.source,
  };
}

function rebuildSpeakers(people: PersonPresent[], speakers: SpeakerIndex[]): SpeakerIndex[] {
  const byLabel = new Map<string, PersonPresent>();
  for (const p of people) {
    if (p.speakerLabel) byLabel.set(p.speakerLabel.toLowerCase(), p);
  }
  return speakers.map((sp) => {
    const person =
      (sp.personId ? people.find((p) => p.id === sp.personId) : null) ||
      byLabel.get(sp.speakerLabel.toLowerCase()) ||
      null;
    const id = person ? identityFromPerson(person) : null;
    if (!id) {
      return {
        ...sp,
        displayName: sp.displayName ?? null,
        identityConfidence: sp.identityConfidence ?? null,
        identityMethod: sp.identityMethod ?? null,
        identitySource: sp.identitySource ?? null,
      };
    }
    return {
      ...sp,
      personId: sp.personId || id.personId,
      displayName: id.displayName,
      identityConfidence: id.confidence,
      identityMethod: id.method,
      identitySource: id.source,
    };
  });
}

/**
 * Apply OCR nameplate identities from visible text / vision matchedName.
 * Does not call the web. Safe for private job footage.
 */
export function applyOcrIdentities(
  people: PeoplePresent,
  visibleTextHints: string[],
): PeoplePresent {
  if (!people.people.length) return people;
  const hints = visibleTextHints.map((h) => h.trim()).filter((h) => h.length >= 3);
  const next = people.people.map((person, index) => {
    if (identityFromPerson(person) && (person.identityMethod === 'roster' || person.matchedOrgUserId)) {
      return person;
    }
    // Vision already put a matchedName from readable badge — keep as OCR.
    if (person.matchedName && looksLikeLegalName(person.matchedName) && !person.matchedOrgUserId) {
      return applyIdentityToPerson(person, {
        displayName: person.matchedName,
        confidence: clampConfidence(person.matchConfidence) ?? OCR_MIN_CONFIDENCE,
        method: 'ocr',
        source: person.identitySource ?? 'on-screen name text',
      });
    }
    // Match person to a visible hint when appearance/note mentions name tag, or sole unnamed speaker.
    for (const hint of hints) {
      if (!looksLikeLegalName(hint)) continue;
      const blob = [person.appearance, person.label, ...(person.appearMoments ?? []).map((m) => m.note)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const hintLower = hint.toLowerCase();
      const tagged =
        /\b(name\s*tag|badge|chyron|lower[\s-]?third|on[\s-]?screen)\b/.test(blob) ||
        blob.includes(hintLower);
      // If only one person and one hint, allow OCR when narration explicitly named them.
      const sole = people.people.length === 1 && hints.length === 1;
      if (!tagged && !sole) continue;
      return applyIdentityToPerson(person, {
        displayName: hint,
        confidence: tagged ? OCR_MIN_CONFIDENCE : 0.72,
        method: 'ocr',
        source: 'visible on-screen text',
      });
    }
    // Assign distinct hints to distinct speakers in order when counts match and all look like names.
    if (
      hints.length >= people.people.length &&
      people.people.length > 0 &&
      hints.slice(0, people.people.length).every(looksLikeLegalName) &&
      !people.people.some((p) => identityFromPerson(p))
    ) {
      const hint = hints[index];
      if (hint && looksLikeLegalName(hint)) {
        return applyIdentityToPerson(person, {
          displayName: hint,
          confidence: 0.75,
          method: 'ocr',
          source: 'on-screen labels',
        });
      }
    }
    return person;
  });

  return {
    ...people,
    people: next,
    speakers: rebuildSpeakers(next, people.speakers),
    count: next.length,
  };
}

/**
 * Apply web identities for public_media scenes only.
 * Candidates must already be high-confidence from the model response.
 */
export function applyWebIdentities(
  people: PeoplePresent,
  candidates: Array<{
    speakerLabel?: string | null;
    personId?: string | null;
    displayName: string;
    confidence: number;
    source: string | null;
  }>,
  sceneKind: SceneKind,
): PeoplePresent {
  if (sceneKind !== 'public_media') return people;
  if (!candidates.length) return people;

  const next = people.people.map((person) => {
    if (identityFromPerson(person)?.method === 'roster') return person;
    const hit = candidates.find((c) => {
      if (c.personId && c.personId === person.id) return true;
      if (
        c.speakerLabel &&
        person.speakerLabel &&
        c.speakerLabel.toLowerCase() === person.speakerLabel.toLowerCase()
      ) {
        return true;
      }
      return false;
    });
    if (!hit) return person;
    const confidence = clampConfidence(hit.confidence) ?? 0;
    if (confidence < WEB_MIN_CONFIDENCE) return person;
    if (!looksLikeLegalName(hit.displayName)) return person;
    if (!hit.source || !String(hit.source).trim()) return person; // require citation
    return applyIdentityToPerson(person, {
      displayName: hit.displayName.trim().slice(0, 80),
      confidence,
      method: 'web',
      source: String(hit.source).trim().slice(0, 200),
    });
  });

  // Also allow creating speaker-index-only overlays when person link missing.
  let speakers = rebuildSpeakers(next, people.speakers);
  speakers = speakers.map((sp) => {
    if (sp.displayName && (sp.identityConfidence ?? 0) >= WEB_MIN_CONFIDENCE) return sp;
    const hit = candidates.find(
      (c) =>
        c.speakerLabel &&
        c.speakerLabel.toLowerCase() === sp.speakerLabel.toLowerCase() &&
        (clampConfidence(c.confidence) ?? 0) >= WEB_MIN_CONFIDENCE &&
        looksLikeLegalName(c.displayName) &&
        c.source,
    );
    if (!hit) return sp;
    return {
      ...sp,
      displayName: hit.displayName.trim().slice(0, 80),
      identityConfidence: clampConfidence(hit.confidence),
      identityMethod: 'web' as const,
      identitySource: String(hit.source).trim().slice(0, 200),
    };
  });

  return { ...people, people: next, speakers, count: next.length };
}

export type IdentifySpeakersInput = {
  people: PeoplePresent;
  narrationText?: string | null;
  summary?: string | null;
  sourceHint?: string | null;
  orgMembers?: OrgMemberHint[];
  /** Extra OCR / vision text strings (name tags already extracted). */
  visibleTextHints?: string[];
  /** Force scene kind / web gate. */
  allowWebIdentify?: boolean | null;
  /**
   * Optional async web identifier for public_media.
   * Must return only high-confidence cited names — never invent.
   */
  webIdentify?: (ctx: {
    sceneKind: SceneKind;
    hints: string[];
    people: PeoplePresent;
  }) => Promise<
    Array<{
      speakerLabel?: string | null;
      personId?: string | null;
      displayName: string;
      confidence: number;
      source: string | null;
    }>
  >;
};

/**
 * Full identity pass: roster → OCR → optional gated web.
 * Never invents. Private jobs skip web.
 */
export async function identifySpeakers(input: IdentifySpeakersInput): Promise<PeoplePresent> {
  let people = input.people;
  if (!people.people.length && !people.speakers.length) return people;

  const sceneKind = classifySceneKind({
    narrationText: input.narrationText,
    summary: input.summary,
    sourceHint: input.sourceHint,
    allowWebIdentify: input.allowWebIdentify,
  });

  const hints = [
    ...extractVisibleNameHints([input.narrationText, input.summary, ...(input.visibleTextHints ?? [])]),
    ...(input.visibleTextHints ?? []),
  ];
  const uniqueHints = [...new Set(hints.map((h) => h.trim()).filter(Boolean))];

  if (input.orgMembers?.length) {
    people = matchPeopleToOrgMembers(people, input.orgMembers, uniqueHints);
    const rosterPeople = people.people.map((p) => {
      if (!p.matchedOrgUserId || !p.matchedName) return p;
      const confidence = clampConfidence(p.matchConfidence) ?? 0.85;
      if (confidence < ROSTER_MIN_CONFIDENCE) return p;
      return applyIdentityToPerson(p, {
        displayName: p.matchedName,
        confidence,
        method: 'roster',
        source: 'org roster match on visible name text',
      });
    });
    people = {
      ...people,
      people: rosterPeople,
      speakers: rebuildSpeakers(rosterPeople, people.speakers),
      count: rosterPeople.length,
    };
  }

  people = applyOcrIdentities(people, uniqueHints);

  if (sceneKind === 'public_media' && input.webIdentify) {
    try {
      const candidates = await input.webIdentify({ sceneKind, hints: uniqueHints, people });
      people = applyWebIdentities(people, candidates ?? [], sceneKind);
    } catch (err) {
      console.warn(
        '[speaker-identity] web identify skipped:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    ...people,
    people: people.people,
    speakers: rebuildSpeakers(people.people, people.speakers),
    count: people.people.length,
  };
}

/**
 * Gemini + Google Search grounding for public figures when scene is media-like.
 * Returns [] on any uncertainty / missing key / parse failure — never invents.
 */
export async function webIdentifyPublicSpeakers(input: {
  hints: string[];
  speakerLabels: string[];
  narrationText?: string | null;
  summary?: string | null;
  signal?: AbortSignal;
}): Promise<
  Array<{
    speakerLabel?: string | null;
    personId?: string | null;
    displayName: string;
    confidence: number;
    source: string | null;
  }>
> {
  const apiKey = googleVisionApiKey();
  if (!apiKey) return [];
  if (!input.hints.length && !/(chyron|podcast|youtube|host|guest)/i.test(String(input.narrationText || ''))) {
    return [];
  }

  const model =
    (process.env.SPEAKER_IDENTITY_MODEL || process.env.VERIFICATION_PRIMARY_MODEL || 'gemini-2.5-flash').trim();
  const baseUrl = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(
    /\/+$/,
    '',
  );
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const system = [
    'You identify PUBLIC figures visible or labeled in broadcast / podcast / YouTube footage.',
    'ONLY return a name when an on-screen chyron, nameplate, or widely known host identity is clear AND you can cite a source.',
    'If unsure, omit that speaker. NEVER invent or guess a private person / homeowner / crew member.',
    'Reply JSON only: {"identities":[{"speakerLabel":"Speaker A"|null,"displayName":"Full Name","confidence":0.0-1.0,"source":"citation"}]}',
    `Minimum confidence ${WEB_MIN_CONFIDENCE}. Include source (show name, Wikipedia, official site).`,
  ].join(' ');

  const userText = [
    `Speaker labels in clip: ${input.speakerLabels.join(', ') || '(none)'}`,
    `Visible name hints: ${input.hints.join('; ') || '(none)'}`,
    input.summary ? `Summary:\n${input.summary.slice(0, 1500)}` : '',
    input.narrationText ? `Narration:\n${input.narrationText.slice(0, 2500)}` : '',
    'Identify only high-confidence public figures. JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: input.signal ?? AbortSignal.timeout(45_000),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Search grounding may be unavailable on some keys/models — fail closed.
    return [];
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  return parseWebIdentityJson(text);
}

export function parseWebIdentityJson(raw: string): Array<{
  speakerLabel?: string | null;
  personId?: string | null;
  displayName: string;
  confidence: number;
  source: string | null;
}> {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const list = (data as { identities?: unknown }).identities;
  if (!Array.isArray(list)) return [];
  const out: Array<{
    speakerLabel?: string | null;
    personId?: string | null;
    displayName: string;
    confidence: number;
    source: string | null;
  }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const displayName = String(row.displayName ?? row.name ?? '').trim();
    const confidence = clampConfidence(row.confidence) ?? 0;
    const source = typeof row.source === 'string' && row.source.trim() ? row.source.trim().slice(0, 200) : null;
    if (!looksLikeLegalName(displayName)) continue;
    if (confidence < WEB_MIN_CONFIDENCE) continue;
    if (!source) continue;
    out.push({
      speakerLabel:
        typeof row.speakerLabel === 'string' && row.speakerLabel.trim()
          ? row.speakerLabel.trim().slice(0, 24)
          : null,
      personId: typeof row.personId === 'string' ? row.personId : null,
      displayName: displayName.slice(0, 80),
      confidence,
      source,
    });
  }
  return out.slice(0, 16);
}
