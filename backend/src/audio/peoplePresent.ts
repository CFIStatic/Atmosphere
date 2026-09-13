/**
 * WHO is in a filed video — distinct people, roles, appearance, speakers.
 *
 * Never invent a legal identity from pixels alone. Prefer role + appearance
 * labels ("Person 1 (crew-like)") until a name tag / known org member can be
 * matched safely from existing org user data.
 *
 * Persisted under `ai_findings.people`.
 */

import {
  conversationFromStored,
  type ConversationDetails,
  type ConversationTurn,
} from './conversationDetails.js';

export const PEOPLE_FINDINGS_VERSION = 1;

export type PersonRole =
  | 'crew'
  | 'homeowner'
  | 'adjuster'
  | 'inspector'
  | 'other'
  | 'unknown';

export type PersonAppearMoment = {
  tSec: number;
  note?: string | null;
};

export type PersonPresent = {
  /** Stable within one clip, e.g. person-1 */
  id: string;
  /** Display label — never a hallucinated legal name. */
  label: string;
  role: PersonRole;
  /** Clothing / build / PPE when identity unknown. */
  appearance: string | null;
  /** Only set when safely matched to org roster / visible name tag. */
  matchedOrgUserId?: string | null;
  matchedName?: string | null;
  matchConfidence?: number | null;
  firstSeenSec?: number | null;
  lastSeenSec?: number | null;
  appearMoments: PersonAppearMoment[];
  /** Tied to conversation turns when speech exists. */
  speakerLabel?: string | null;
};

export type SpeakerIndex = {
  speakerLabel: string;
  personId: string | null;
  turnCount: number;
};

export type PeoplePresent = {
  count: number;
  people: PersonPresent[];
  speakers: SpeakerIndex[];
  source: 'llm' | 'deterministic' | 'merged' | 'empty';
  model?: string | null;
};

/** Persisted under `ai_findings.people`. */
export type StoredPeoplePresent = {
  version: number;
  source: PeoplePresent['source'];
  model?: string | null;
  count: number;
  people: PersonPresent[];
  speakers: SpeakerIndex[];
};

export type OrgMemberHint = {
  userId: string;
  fullName: string;
  email?: string | null;
};

function emptyPeople(): PeoplePresent {
  return { count: 0, people: [], speakers: [], source: 'empty', model: null };
}

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function clampConfidence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function normalizeRole(raw: unknown): PersonRole {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (/^(crew|tech|technician|contractor|worker|sub|employee)$/.test(s)) return 'crew';
  if (/^(homeowner|owner|homeownerlike|resident|customer)$/.test(s)) return 'homeowner';
  if (/^adjuster$/.test(s)) return 'adjuster';
  if (/^inspector$/.test(s)) return 'inspector';
  if (/^(other|bystander|visitor)$/.test(s)) return 'other';
  return 'unknown';
}

function roleFromSpeaker(label: string): PersonRole {
  const s = label.trim().toLowerCase();
  if (/home\s*owner|^owner$/.test(s)) return 'homeowner';
  if (/crew|tech|contractor|worker/.test(s)) return 'crew';
  if (/adjuster/.test(s)) return 'adjuster';
  if (/inspector/.test(s)) return 'inspector';
  return 'unknown';
}

function defaultLabel(index: number, role: PersonRole, appearance: string | null): string {
  const n = index + 1;
  if (role === 'homeowner') return appearance ? `Person ${n} (homeowner-like)` : `Person ${n} (homeowner)`;
  if (role === 'crew') return appearance ? `Person ${n} (crew-like)` : `Person ${n} (crew)`;
  if (role === 'adjuster') return `Person ${n} (adjuster)`;
  if (role === 'inspector') return `Person ${n} (inspector)`;
  if (appearance) return `Person ${n} (${appearance.slice(0, 40)})`;
  return `Person ${n}`;
}

function looksLikeLegalName(raw: string): boolean {
  const s = raw.trim();
  // Reject obvious role / placeholder labels.
  if (/^(person|speaker|crew|homeowner|owner|tech|contractor|worker|adjuster|inspector)\b/i.test(s)) {
    return false;
  }
  // Two+ capitalized tokens looks like a proper name — we never accept these
  // from vision alone without an org match.
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+$/.test(s);
}

/** Strip hallucinated legal names from model output unless org-matched. */
export function sanitizePersonLabel(raw: string, role: PersonRole, appearance: string | null, index: number): string {
  const s = String(raw || '').trim().slice(0, 80);
  if (!s) return defaultLabel(index, role, appearance);
  if (looksLikeLegalName(s)) return defaultLabel(index, role, appearance);
  // Allow role-style and Person N labels.
  if (/^person\s*\d+/i.test(s) || /crew-like|homeowner-like|speaker\s*[a-d]/i.test(s)) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 64);
  }
  if (/^(homeowner|crew|adjuster|inspector|speaker\s*[a-d])$/i.test(s)) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Soft descriptors are fine.
  if (s.length <= 48 && !/\d{3,}/.test(s)) return s;
  return defaultLabel(index, role, appearance);
}

function asAppearMoments(value: unknown): PersonAppearMoment[] {
  if (!Array.isArray(value)) return [];
  const out: PersonAppearMoment[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) {
      out.push({ tSec: roundTime(item), note: null });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const tRaw = (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    if (!Number.isFinite(tSec) || tSec < 0) continue;
    const noteRaw = (item as { note?: unknown; text?: unknown }).note ?? (item as { text?: unknown }).text;
    out.push({
      tSec: roundTime(tSec),
      note: typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 160) : null,
    });
  }
  return out.slice(0, 40);
}

function asPersonList(value: unknown): PersonPresent[] {
  if (!Array.isArray(value)) return [];
  const out: PersonPresent[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!item || typeof item !== 'object') continue;
    const role = normalizeRole((item as { role?: unknown }).role);
    const appearanceRaw = (item as { appearance?: unknown }).appearance;
    const appearance =
      typeof appearanceRaw === 'string' && appearanceRaw.trim()
        ? appearanceRaw.trim().slice(0, 160)
        : null;
    const idRaw = (item as { id?: unknown }).id;
    const id =
      typeof idRaw === 'string' && idRaw.trim()
        ? idRaw.trim().slice(0, 32)
        : `person-${out.length + 1}`;
    const labelRaw = String((item as { label?: unknown }).label ?? '').trim();
    const matchedNameRaw = (item as { matchedName?: unknown }).matchedName;
    const matchedOrgUserIdRaw = (item as { matchedOrgUserId?: unknown }).matchedOrgUserId;
    const matchedName =
      typeof matchedNameRaw === 'string' && matchedNameRaw.trim()
        ? matchedNameRaw.trim().slice(0, 80)
        : null;
    const matchedOrgUserId =
      typeof matchedOrgUserIdRaw === 'string' && matchedOrgUserIdRaw.trim()
        ? matchedOrgUserIdRaw.trim().slice(0, 64)
        : null;
    // Legal names only survive when org-matched.
    const label =
      matchedName && matchedOrgUserId
        ? matchedName
        : sanitizePersonLabel(labelRaw, role, appearance, out.length);
    const speakerRaw = (item as { speakerLabel?: unknown }).speakerLabel;
    const first = Number((item as { firstSeenSec?: unknown }).firstSeenSec);
    const last = Number((item as { lastSeenSec?: unknown }).lastSeenSec);
    const moments = asAppearMoments((item as { appearMoments?: unknown }).appearMoments);
    out.push({
      id,
      label,
      role,
      appearance,
      matchedOrgUserId,
      matchedName: matchedOrgUserId ? matchedName : null,
      matchConfidence: matchedOrgUserId
        ? clampConfidence((item as { matchConfidence?: unknown }).matchConfidence)
        : null,
      firstSeenSec: Number.isFinite(first) && first >= 0 ? roundTime(first) : moments[0]?.tSec ?? null,
      lastSeenSec:
        Number.isFinite(last) && last >= 0
          ? roundTime(last)
          : moments.length
            ? moments[moments.length - 1]!.tSec
            : null,
      appearMoments: moments,
      speakerLabel:
        typeof speakerRaw === 'string' && speakerRaw.trim() ? speakerRaw.trim().slice(0, 24) : null,
    });
    if (out.length >= 24) break;
  }
  return out;
}

function speakersFromPeople(people: PersonPresent[], turns: ConversationTurn[]): SpeakerIndex[] {
  const counts = new Map<string, { personId: string | null; turnCount: number }>();
  for (const turn of turns) {
    const label = turn.speakerLabel?.trim();
    if (!label) continue;
    const prev = counts.get(label) ?? { personId: null, turnCount: 0 };
    prev.turnCount += 1;
    counts.set(label, prev);
  }
  for (const person of people) {
    if (!person.speakerLabel) continue;
    const prev = counts.get(person.speakerLabel) ?? { personId: person.id, turnCount: 0 };
    prev.personId = person.id;
    counts.set(person.speakerLabel, prev);
  }
  return [...counts.entries()]
    .map(([speakerLabel, v]) => ({
      speakerLabel,
      personId: v.personId,
      turnCount: v.turnCount,
    }))
    .sort((a, b) => b.turnCount - a.turnCount)
    .slice(0, 16);
}

/** Regex / turn-based people when no model people array is present. */
export function extractPeoplePresent(input: {
  narrationText?: string | null;
  summary?: string | null;
  transcript?: string | null;
  conversation?: ConversationDetails | null;
  visionPeople?: unknown;
  actions?: Array<{ atSeconds?: number; description?: string; room?: string | null }>;
}): PeoplePresent {
  const fromVision = asPersonList(input.visionPeople);
  const turns = input.conversation?.turns ?? [];
  const people: PersonPresent[] = [...fromVision];
  const usedSpeakers = new Set(
    people.map((p) => p.speakerLabel?.toLowerCase()).filter(Boolean) as string[],
  );

  for (const turn of turns) {
    const label = turn.speakerLabel?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (usedSpeakers.has(key)) {
      const existing = people.find((p) => p.speakerLabel?.toLowerCase() === key);
      if (existing && turn.tSec != null && Number.isFinite(turn.tSec)) {
        const t = roundTime(turn.tSec);
        if (!existing.appearMoments.some((m) => Math.abs(m.tSec - t) < 1)) {
          existing.appearMoments.push({ tSec: t, note: turn.text.slice(0, 80) });
          existing.appearMoments = existing.appearMoments.slice(0, 40);
          existing.firstSeenSec =
            existing.firstSeenSec == null ? t : Math.min(existing.firstSeenSec, t);
          existing.lastSeenSec =
            existing.lastSeenSec == null ? t : Math.max(existing.lastSeenSec, t);
        }
      }
      continue;
    }
    usedSpeakers.add(key);
    const role = roleFromSpeaker(label);
    const tSec = turn.tSec != null && Number.isFinite(turn.tSec) ? roundTime(turn.tSec) : null;
    people.push({
      id: `person-${people.length + 1}`,
      label: sanitizePersonLabel(label, role, null, people.length),
      role,
      appearance: null,
      matchedOrgUserId: null,
      matchedName: null,
      matchConfidence: null,
      firstSeenSec: tSec,
      lastSeenSec: tSec,
      appearMoments: tSec != null ? [{ tSec, note: turn.text.slice(0, 80) }] : [],
      speakerLabel: label.slice(0, 24),
    });
  }

  // Narration cues for visible people without speech.
  const visionBlob = [input.narrationText, input.summary]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
  if (visionBlob && people.length === 0) {
    const cues: Array<{ role: PersonRole; re: RegExp; appearance?: string }> = [
      { role: 'crew', re: /\b(crew|technician|tech|worker|contractor|sub(?:contractor)?)\b/i },
      { role: 'homeowner', re: /\b(homeowner|home owner|resident|property owner)\b/i },
      { role: 'adjuster', re: /\badjuster\b/i },
      { role: 'other', re: /\b(person|man|woman|people)\b/i },
    ];
    for (const cue of cues) {
      if (!cue.re.test(visionBlob)) continue;
      if (people.some((p) => p.role === cue.role)) continue;
      people.push({
        id: `person-${people.length + 1}`,
        label: defaultLabel(people.length, cue.role, null),
        role: cue.role === 'other' ? 'unknown' : cue.role,
        appearance: null,
        matchedOrgUserId: null,
        matchedName: null,
        matchConfidence: null,
        firstSeenSec: null,
        lastSeenSec: null,
        appearMoments: [],
        speakerLabel: null,
      });
      if (people.length >= 4) break;
    }
  }

  // Action descriptions sometimes name a person at a seek time.
  for (const action of input.actions ?? []) {
    const desc = String(action.description || '');
    if (!/\b(person|worker|crew|homeowner|technician)\b/i.test(desc)) continue;
    const t =
      action.atSeconds != null && Number.isFinite(action.atSeconds)
        ? roundTime(Number(action.atSeconds))
        : null;
    if (t == null) continue;
    const target =
      people.find((p) => p.role === 'crew') ||
      people.find((p) => p.role === 'unknown') ||
      people[0];
    if (!target) continue;
    if (!target.appearMoments.some((m) => Math.abs(m.tSec - t) < 1.5)) {
      target.appearMoments.push({ tSec: t, note: desc.slice(0, 120) });
      target.firstSeenSec = target.firstSeenSec == null ? t : Math.min(target.firstSeenSec, t);
      target.lastSeenSec = target.lastSeenSec == null ? t : Math.max(target.lastSeenSec, t);
    }
  }

  if (!people.length) return emptyPeople();

  const speakers = speakersFromPeople(people, turns);
  return {
    count: people.length,
    people: people.slice(0, 24),
    speakers,
    source: fromVision.length ? 'merged' : 'deterministic',
    model: null,
  };
}

/**
 * Match people to org roster only when a visible name / tag text equals a
 * known member. Never face-match. Never invent.
 */
export function matchPeopleToOrgMembers(
  people: PeoplePresent,
  members: OrgMemberHint[],
  visibleTextHints: string[] = [],
): PeoplePresent {
  if (!people.people.length || !members.length) return people;
  const hay = visibleTextHints
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);
  if (!hay.length) return people;

  const next = people.people.map((person) => {
    if (person.matchedOrgUserId && person.matchedName) return person;
    for (const member of members) {
      const name = member.fullName.trim();
      if (name.length < 3) continue;
      const lower = name.toLowerCase();
      const hit = hay.some((h) => h.includes(lower) || lower.split(/\s+/).every((part) => part.length > 2 && h.includes(part)));
      if (!hit) continue;
      return {
        ...person,
        matchedOrgUserId: member.userId,
        matchedName: name.slice(0, 80),
        matchConfidence: 0.85,
        label: name.slice(0, 80),
      };
    }
    return person;
  });

  return { ...people, people: next, count: next.length };
}

/** Parse model JSON people array (from dictation or a dedicated pass). */
export function parsePeopleModelJson(raw: unknown, fallback: PeoplePresent): PeoplePresent | null {
  if (raw == null) return null;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fence?.[1] ?? trimmed).trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) {
      // Bare array?
      const a0 = body.indexOf('[');
      const a1 = body.lastIndexOf(']');
      if (a0 >= 0 && a1 > a0) {
        try {
          data = { people: JSON.parse(body.slice(a0, a1 + 1)) };
        } catch {
          return null;
        }
      } else return null;
    } else {
      try {
        data = JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const list = asPersonList(row.people ?? row.persons ?? data);
  if (!list.length) return null;
  const speakers = Array.isArray(row.speakers)
    ? (row.speakers as unknown[])
        .filter((s) => s && typeof s === 'object')
        .map((s) => {
          const o = s as Record<string, unknown>;
          return {
            speakerLabel: String(o.speakerLabel ?? 'Speaker').trim().slice(0, 24) || 'Speaker',
            personId: typeof o.personId === 'string' ? o.personId : null,
            turnCount: Number.isFinite(Number(o.turnCount)) ? Math.max(0, Math.floor(Number(o.turnCount))) : 0,
          };
        })
        .slice(0, 16)
    : speakersFromPeople(list, fallback.speakers.length ? [] : []);
  return {
    count: list.length,
    people: list,
    speakers: speakers.length ? speakers : speakersFromPeople(list, []),
    source: 'llm',
    model: typeof row.model === 'string' ? row.model : null,
  };
}

export function hasPeople(people: PeoplePresent | null | undefined): boolean {
  return Boolean(people && people.people.length > 0);
}

export function toStoredPeople(people: PeoplePresent): StoredPeoplePresent {
  return {
    version: PEOPLE_FINDINGS_VERSION,
    source: people.source,
    model: people.model ?? null,
    count: people.count,
    people: people.people,
    speakers: people.speakers,
  };
}

export function peopleFromStored(stored: unknown, fallbackInput?: Parameters<typeof extractPeoplePresent>[0]): PeoplePresent {
  const fallback = fallbackInput ? extractPeoplePresent(fallbackInput) : emptyPeople();
  if (!stored || typeof stored !== 'object') return fallback;
  const row = stored as StoredPeoplePresent & Record<string, unknown>;
  const list = asPersonList(row.people);
  if (!list.length) return fallback;
  const speakers = Array.isArray(row.speakers)
    ? (row.speakers as SpeakerIndex[]).slice(0, 16)
    : speakersFromPeople(list, []);
  const source =
    row.source === 'llm' || row.source === 'deterministic' || row.source === 'merged' || row.source === 'empty'
      ? row.source
      : 'deterministic';
  return {
    count: typeof row.count === 'number' ? row.count : list.length,
    people: list,
    speakers,
    source,
    model: typeof row.model === 'string' ? row.model : null,
  };
}

export function publicPeopleFields(people: PeoplePresent) {
  return {
    peoplePresent: people.people,
    peopleCount: people.count,
    peopleSpeakers: people.speakers,
    peopleSource: people.source,
    peopleModel: people.model ?? null,
  };
}

/** One-line Ask answer for "who is in this video". */
export function formatPeopleAnswer(people: PeoplePresent): string | null {
  if (!hasPeople(people)) return null;
  const parts = people.people.map((p) => {
    const when =
      p.firstSeenSec != null && Number.isFinite(p.firstSeenSec)
        ? ` (first seen ~${formatClock(p.firstSeenSec)})`
        : '';
    const appearance = p.appearance ? ` — ${p.appearance}` : '';
    const role =
      p.role !== 'unknown' && !p.label.toLowerCase().includes(p.role) ? ` [${p.role}]` : '';
    return `${p.label}${role}${appearance}${when}`;
  });
  const talkers = people.speakers.filter((s) => s.turnCount > 0);
  const talkLine = talkers.length
    ? ` Speaking: ${talkers.map((s) => `${s.speakerLabel} (${s.turnCount} turn${s.turnCount === 1 ? '' : 's'})`).join(', ')}.`
    : '';
  return `People in this video (${people.count}): ${parts.join('; ')}.${talkLine}`;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Rebuild people from stored findings + transcript for library / Ask. */
export function resolvePeoplePresent(input: {
  stored?: unknown;
  transcript?: string | null;
  conversationStored?: unknown;
  narrationText?: string | null;
  summary?: string | null;
  visionPeople?: unknown;
  actions?: Array<{ atSeconds?: number; description?: string; room?: string | null }>;
}): PeoplePresent {
  const conversation = conversationFromStored(input.transcript, input.conversationStored);
  const fallbackInput = {
    narrationText: input.narrationText,
    summary: input.summary,
    transcript: input.transcript,
    conversation,
    visionPeople: input.visionPeople,
    actions: input.actions,
  };
  const fromStored = peopleFromStored(input.stored, fallbackInput);
  if (fromStored.people.length) return fromStored;
  return extractPeoplePresent(fallbackInput);
}
