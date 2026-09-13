/**
 * People present in a filed video — seen and/or heard.
 *
 * LLM analysis (via conversation brief) is the primary source. Deterministic
 * fallback builds people from speaker turns + light vision cue matching.
 * Never invent names; roles are best-effort office labels.
 */

export type ConversationPerson = {
  label: string;
  /** homeowner | crew | adjuster | inspector | other */
  role: string | null;
  firstSeenSec: number | null;
  lastSeenSec: number | null;
  talking: boolean;
  /** Short office note: what they are doing / saying. */
  evidence: string;
  quote?: string | null;
  confidence?: number | null;
};

type TurnLike = {
  tSec?: number | null;
  speakerLabel?: string | null;
  text?: string | null;
};

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function clampConfidence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export function normalizePersonRole(raw: string | null | undefined): string | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!s) return null;
  if (/home\s*owner|^owner$/.test(s)) return 'homeowner';
  if (/contractor|crew|tech|technician|worker/.test(s)) return 'crew';
  if (/adjuster/.test(s)) return 'adjuster';
  if (/inspector/.test(s)) return 'inspector';
  return 'other';
}

/** Deterministic people from speaker turns + optional vision notes. */
export function peopleFromTurnsAndVision(
  turns: TurnLike[],
  visionContext?: string | null,
): ConversationPerson[] {
  const byLabel = new Map<string, ConversationPerson>();
  for (const turn of turns) {
    const label = String(turn.speakerLabel || '').trim() || 'Speaker';
    const tSec =
      turn.tSec != null && Number.isFinite(turn.tSec) ? roundTime(Number(turn.tSec)) : null;
    const text = String(turn.text || '').trim();
    const prev = byLabel.get(label);
    if (!prev) {
      byLabel.set(label, {
        label: label.slice(0, 48),
        role: normalizePersonRole(label),
        firstSeenSec: tSec,
        lastSeenSec: tSec,
        talking: true,
        evidence: text.slice(0, 240) || `${label} speaking on the mic.`,
        quote: text ? text.slice(0, 200) : null,
        confidence: 0.72,
      });
      continue;
    }
    if (tSec != null) {
      if (prev.firstSeenSec == null || tSec < prev.firstSeenSec) prev.firstSeenSec = tSec;
      if (prev.lastSeenSec == null || tSec > prev.lastSeenSec) prev.lastSeenSec = tSec;
    }
    prev.talking = true;
    if (text && text.length > (prev.evidence?.length || 0)) {
      prev.evidence = text.slice(0, 240);
      prev.quote = text.slice(0, 200);
    }
  }

  const vision = String(visionContext || '');
  const cues: Array<{ re: RegExp; label: string; role: string }> = [
    { re: /\bhome\s*owners?\b|\bhomeowner\b/i, label: 'Homeowner', role: 'homeowner' },
    { re: /\b(crew|technician|worker|contractor)s?\b/i, label: 'Crew', role: 'crew' },
    { re: /\badjusters?\b/i, label: 'Adjuster', role: 'adjuster' },
    { re: /\binspectors?\b/i, label: 'Inspector', role: 'inspector' },
  ];
  for (const cue of cues) {
    if (!cue.re.test(vision)) continue;
    if ([...byLabel.keys()].some((k) => k.toLowerCase() === cue.label.toLowerCase())) continue;
    // Only add vision-only people when we have no speakers yet, or cue is new.
    if (byLabel.size && cue.role === 'other') continue;
    if (!byLabel.has(cue.label)) {
      byLabel.set(cue.label, {
        label: cue.label,
        role: cue.role,
        firstSeenSec: null,
        lastSeenSec: null,
        talking: false,
        evidence: 'Seen in the vision reading of this clip.',
        quote: null,
        confidence: 0.55,
      });
    }
  }

  return [...byLabel.values()].slice(0, 24);
}

export function asPeopleList(value: unknown): ConversationPerson[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationPerson[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label ?? row.name ?? row.speakerLabel ?? '').trim();
    if (!label) continue;
    const first =
      row.firstSeenSec != null && Number.isFinite(Number(row.firstSeenSec))
        ? roundTime(Number(row.firstSeenSec))
        : row.tSec != null && Number.isFinite(Number(row.tSec))
          ? roundTime(Number(row.tSec))
          : null;
    const last =
      row.lastSeenSec != null && Number.isFinite(Number(row.lastSeenSec))
        ? roundTime(Number(row.lastSeenSec))
        : first;
    out.push({
      label: label.slice(0, 48),
      role: normalizePersonRole(String(row.role ?? label)),
      firstSeenSec: first,
      lastSeenSec: last,
      talking: Boolean(row.talking ?? row.spoke ?? true),
      evidence: String(row.evidence ?? row.note ?? row.text ?? '')
        .trim()
        .slice(0, 320) || label,
      quote: row.quote != null ? String(row.quote).slice(0, 240) : null,
      confidence: clampConfidence(row.confidence),
    });
    if (out.length >= 24) break;
  }
  return out;
}

export function mergePeopleLists(...lists: ConversationPerson[][]): ConversationPerson[] {
  const by = new Map<string, ConversationPerson>();
  for (const list of lists) {
    for (const person of list) {
      const key = person.label.toLowerCase();
      const prev = by.get(key);
      if (!prev) {
        by.set(key, { ...person });
        continue;
      }
      if (person.firstSeenSec != null) {
        if (prev.firstSeenSec == null || person.firstSeenSec < prev.firstSeenSec) {
          prev.firstSeenSec = person.firstSeenSec;
        }
      }
      if (person.lastSeenSec != null) {
        if (prev.lastSeenSec == null || person.lastSeenSec > prev.lastSeenSec) {
          prev.lastSeenSec = person.lastSeenSec;
        }
      }
      prev.talking = prev.talking || person.talking;
      if ((person.confidence ?? 0) > (prev.confidence ?? 0)) {
        prev.confidence = person.confidence;
        prev.evidence = person.evidence || prev.evidence;
        prev.quote = person.quote ?? prev.quote;
        prev.role = person.role || prev.role;
      }
    }
  }
  return [...by.values()].slice(0, 24);
}

export function preferPeople(
  primary: ConversationPerson[],
  fallback: ConversationPerson[],
): ConversationPerson[] {
  if (primary.length) return mergePeopleLists(primary, fallback);
  return fallback;
}

/** Ground quotes back into the transcript when possible. */
export function groundPeopleQuotes(
  people: ConversationPerson[],
  findQuote: (needle: string) => { quote: string; tSec: number | null } | null,
): ConversationPerson[] {
  return people.map((person) => {
    if (person.quote && person.firstSeenSec != null) return person;
    const hit = findQuote(person.quote || person.evidence);
    if (!hit) return person;
    return {
      ...person,
      quote: hit.quote,
      firstSeenSec: person.firstSeenSec ?? hit.tSec,
      lastSeenSec: person.lastSeenSec ?? hit.tSec,
    };
  });
}
