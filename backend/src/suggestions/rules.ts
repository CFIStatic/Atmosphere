/**
 * Suggested work: the product judgement, with no database and no model.
 *
 * Atmosphere offers a piece of work only when the job is ready for it. Each
 * rule reads the job's state (rooms on video, moisture readings, cause of
 * loss, whether an estimate exists, milestones, events in the footage) and
 * either proposes a suggestion with a fingerprint of the state it relied on,
 * or stays quiet. The same kind is never suggested twice for the same
 * fingerprint, so routine progress footage that changes nothing the rule
 * reads produces nothing.
 */
import { createHash } from 'node:crypto';

export const SUGGESTION_KINDS = [
  'capture_missing',
  'build_estimate',
  'supplement_packet',
  'crm_update',
  'homeowner_update',
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type JobEventKind = 'adjuster_visit' | 'homeowner_decision';

export interface JobEvent {
  kind: JobEventKind;
  proofId: string;
  /** The words in the footage that suggest it. */
  quote: string;
}

export type Milestone = 'drying_complete' | 'demo_complete';

export interface JobState {
  jobId: string;
  orgId: string;
  title: string;
  status: string | null;
  lossType: string | null;
  /** Clips on the job that finished analysis. */
  analyzedClipCount: number;
  /** Room names seen on video (display form, de-duplicated by key). */
  roomsOnVideo: string[];
  /** Rooms where the footage shows damage. */
  affectedRooms: string[];
  /** Rooms the job's documents (loss notes, sketches) name; each should be on video before an estimate. */
  expectedRooms: string[];
  moistureReadings: boolean;
  causeOfLoss: string | null;
  estimate: null | {
    /** Stable id of what counts as "the estimate" (document id, or 'scope'). */
    ref: string;
    at: string | null;
    scopeTitles: string[];
  };
  /** Rooms with damage first seen on footage after the estimate. */
  newDamageRoomsSinceEstimate: string[];
  /** Work the footage shows after the estimate that no approved scope line covers. */
  workNotInEstimate: string[];
  milestones: Milestone[];
  events: JobEvent[];
}

/** What the last suggestion of a kind saw, for "has anything meaningful changed?". */
export interface PriorSnapshot {
  status?: string | null;
  rooms?: string[];
  eventKeys?: string[];
  milestones?: string[];
}

export interface PriorSuggestion {
  kind: SuggestionKind;
  status: 'open' | 'approved' | 'dismissed' | 'superseded';
  stateFingerprint: string;
  evidence: { snapshot?: PriorSnapshot } & Record<string, unknown>;
  createdAt: string;
}

export interface SuggestionCandidate {
  kind: SuggestionKind;
  title: string;
  detail: string;
  /** Why now, in a sentence the office reads. */
  reason: string;
  /** What Approve hands to Chat (which starts Computer when the work is on a website or Xactimate). */
  prompt: string;
  handoff: 'chat';
  stateFingerprint: string;
  /** True when the rule rests on words in the footage that the model should confirm. */
  needsModelCheck: boolean;
  evidence: { snapshot: PriorSnapshot } & Record<string, unknown>;
}

const CLOSED_STATUSES = new Set(['completed', 'invoiced', 'paid', 'cancelled']);
/** Loss types where an estimate needs moisture readings first. */
const MOISTURE_LOSS_TYPES = new Set(['water', 'mold', 'storm']);

export function roomKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqRooms(rooms: string[]): string[] {
  const seen = new Map<string, string>();
  for (const room of rooms) {
    const key = roomKey(room);
    if (key && !seen.has(key)) seen.set(key, room.trim());
  }
  return [...seen.values()];
}

function sortedKeys(rooms: string[]): string[] {
  return [...new Set(rooms.map(roomKey).filter(Boolean))].sort();
}

export function fingerprint(kind: SuggestionKind, parts: unknown): string {
  return createHash('sha256').update(`${kind}:${JSON.stringify(parts)}`).digest('hex').slice(0, 32);
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function eventKey(event: JobEvent): string {
  return `${event.kind}:${event.proofId}`;
}

/** What is still missing before an estimate can be built from the file. */
export function inspectionGaps(state: JobState): string[] {
  const gaps: string[] = [];
  if (!state.affectedRooms.length) gaps.push('footage of the affected rooms showing the damage');
  const onVideo = new Set(state.roomsOnVideo.map(roomKey));
  const missing = uniqRooms(state.expectedRooms).filter((r) => !onVideo.has(roomKey(r)));
  for (const room of missing) gaps.push(`the ${room} on video`);
  const needsMoisture = !state.lossType || MOISTURE_LOSS_TYPES.has(state.lossType);
  if (needsMoisture && !state.moistureReadings) gaps.push('moisture readings');
  if (!state.causeOfLoss) gaps.push('the cause of loss');
  return gaps;
}

/**
 * The last suggestion of a kind someone acted on (approved or dismissed).
 * An open one is about to be replaced, so changes are counted from the last
 * decision, not from it.
 */
function latestDecided(prior: PriorSuggestion[], kind: SuggestionKind): PriorSuggestion | null {
  return (
    prior
      .filter((p) => p.kind === kind && (p.status === 'approved' || p.status === 'dismissed'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0] ?? null
  );
}

/**
 * Every suggestion the job's state supports right now, before dedupe and
 * before the model's check. Pure.
 */
export function candidateSuggestions(state: JobState, prior: PriorSuggestion[] = []): SuggestionCandidate[] {
  if (state.status && CLOSED_STATUSES.has(state.status)) return [];
  if (state.analyzedClipCount === 0) return [];
  const out: SuggestionCandidate[] = [];
  const rooms = uniqRooms(state.roomsOnVideo);
  const affected = uniqRooms(state.affectedRooms);

  // Estimate, or what is missing before one.
  if (!state.estimate) {
    const gaps = inspectionGaps(state);
    if (gaps.length) {
      out.push({
        kind: 'capture_missing',
        title: 'Capture what the estimate still needs',
        detail: `Before an estimate, the file still needs ${list(gaps)}.`,
        reason: 'The inspection is not fully documented yet, so an estimate would be guesswork.',
        prompt: `Make a short shot list for the crew of what this job file still needs before we can build the estimate: ${list(gaps)}. Name the rooms and what to film in each.`,
        handoff: 'chat',
        stateFingerprint: fingerprint('capture_missing', { gaps: [...gaps].sort() }),
        needsModelCheck: false,
        evidence: { snapshot: { rooms: sortedKeys(rooms) }, gaps },
      });
    } else {
      out.push({
        kind: 'build_estimate',
        title: 'Build the estimate in Xactimate',
        detail: `${list(affected)} ${affected.length === 1 ? 'is' : 'are'} on video with moisture readings and the cause of loss (${state.causeOfLoss}).`,
        reason: 'The inspection is documented and there is no estimate on this job yet.',
        prompt: `Use Computer to build the estimate for this job in Xactimate from the job file: the affected rooms (${list(affected)}), the damage and moisture readings on video, and the cause of loss (${state.causeOfLoss}). Stop for my approval before anything is saved or submitted.`,
        handoff: 'chat',
        stateFingerprint: fingerprint('build_estimate', {
          affected: sortedKeys(affected),
          moisture: state.moistureReadings,
          cause: state.causeOfLoss,
        }),
        needsModelCheck: false,
        evidence: { snapshot: { rooms: sortedKeys(rooms) }, affectedRooms: affected },
      });
    }
  } else {
    // Supplement: new damage, or work on video the approved estimate does not cover.
    const newRooms = uniqRooms(state.newDamageRoomsSinceEstimate);
    const extraWork = [...new Set(state.workNotInEstimate.map((w) => w.trim()).filter(Boolean))].slice(0, 8);
    if (newRooms.length || extraWork.length) {
      const what = [
        newRooms.length ? `new damage in ${list(newRooms)}` : '',
        extraWork.length ? `work not in the approved estimate (${list(extraWork.slice(0, 3))})` : '',
      ]
        .filter(Boolean)
        .join(' and ');
      out.push({
        kind: 'supplement_packet',
        title: 'Draft a supplement packet',
        detail: `The footage shows ${what}.`,
        reason: 'The scope changed after the estimate was written.',
        prompt: `Draft a supplement packet for this job: ${what}. Cite the clips that show it and list the line items to add. Do not send it to anyone.`,
        handoff: 'chat',
        stateFingerprint: fingerprint('supplement_packet', {
          estimate: state.estimate.ref,
          rooms: sortedKeys(newRooms),
          work: extraWork.map((w) => w.toLowerCase()).sort(),
        }),
        needsModelCheck: extraWork.length > 0 && newRooms.length === 0,
        evidence: { snapshot: { rooms: sortedKeys(rooms) }, newRooms, extraWork },
      });
    }
  }

  // CRM / dashboard update: only on a meaningful change since the last one.
  const lastCrm = latestDecided(prior, 'crm_update')?.evidence.snapshot ?? null;
  const roomKeys = sortedKeys(rooms);
  const eventKeys = state.events.map(eventKey).sort();
  const changes: string[] = [];
  if (!lastCrm) {
    if (roomKeys.length) changes.push(`the walkthrough (${list(rooms)})`);
  } else {
    if ((lastCrm.status ?? null) !== (state.status ?? null) && state.status) changes.push(`status is now ${state.status.replace(/_/g, ' ')}`);
    const before = new Set(lastCrm.rooms ?? []);
    const added = rooms.filter((r) => !before.has(roomKey(r)));
    if (added.length) changes.push(`new ${added.length === 1 ? 'room' : 'rooms'}: ${list(added)}`);
  }
  const hardChanges = changes.length;
  const seenEvents = new Set(lastCrm?.eventKeys ?? []);
  for (const event of state.events) {
    if (seenEvents.has(eventKey(event))) continue;
    changes.push(event.kind === 'adjuster_visit' ? 'the adjuster visited' : 'the homeowner made a decision');
  }
  const uniqueChanges = [...new Set(changes)];
  if (uniqueChanges.length) {
    out.push({
      kind: 'crm_update',
      title: 'Update the job in your CRM',
      detail: `Since the last update: ${list(uniqueChanges)}.`,
      reason: 'Something on this job changed that the CRM should reflect.',
      prompt: `Use Computer to update this job in our CRM with what changed: ${list(uniqueChanges)}. Use the job file for the details. Stop for my approval before saving.`,
      handoff: 'chat',
      stateFingerprint: fingerprint('crm_update', { status: state.status, rooms: roomKeys, events: eventKeys }),
      needsModelCheck: hardChanges === 0,
      evidence: {
        snapshot: { status: state.status, rooms: roomKeys, eventKeys },
        changes: uniqueChanges,
        events: state.events.filter((e) => !seenEvents.has(eventKey(e))),
      },
    });
  }

  // Homeowner update at milestones.
  const lastHo = latestDecided(prior, 'homeowner_update')?.evidence.snapshot ?? null;
  const reached = [...new Set(state.milestones)].sort();
  const newMilestones = reached.filter((m) => !(lastHo?.milestones ?? []).includes(m));
  if (newMilestones.length) {
    const words = newMilestones.map((m) => (m === 'drying_complete' ? 'drying is complete' : 'demo is complete'));
    out.push({
      kind: 'homeowner_update',
      title: 'Send the homeowner an update',
      detail: `On video: ${list(words)}.`,
      reason: 'The job reached a milestone the homeowner will want to hear about.',
      prompt: `Draft a short, plain update for the homeowner: ${list(words)}. Say what happens next. Show it to me; do not send it.`,
      handoff: 'chat',
      stateFingerprint: fingerprint('homeowner_update', { milestones: reached }),
      needsModelCheck: true,
      evidence: { snapshot: { milestones: reached }, milestones: newMilestones },
    });
  }

  return out;
}

/**
 * Drop candidates already made for this state (open, dismissed, approved —
 * any status) and kinds that already have an open suggestion for an older
 * state, which the newer one replaces.
 */
export function dedupeCandidates(
  candidates: SuggestionCandidate[],
  prior: PriorSuggestion[],
): { create: SuggestionCandidate[]; supersede: SuggestionKind[] } {
  const create: SuggestionCandidate[] = [];
  const supersede: SuggestionKind[] = [];
  for (const c of candidates) {
    const same = prior.filter((p) => p.kind === c.kind);
    if (same.some((p) => p.stateFingerprint === c.stateFingerprint)) continue;
    if (same.some((p) => p.status === 'open')) supersede.push(c.kind);
    create.push(c);
  }
  return { create, supersede };
}

/** Kinds whose open suggestion no longer applies because the state moved on (e.g. an estimate arrived). */
export function staleOpenKinds(candidates: SuggestionCandidate[], prior: PriorSuggestion[]): SuggestionKind[] {
  const live = new Set(candidates.map((c) => c.kind));
  const retire: SuggestionKind[] = [];
  for (const p of prior) {
    if (p.status !== 'open') continue;
    // Snapshot-based kinds stay until someone acts on them; gating kinds retire when the gate flips.
    if ((p.kind === 'capture_missing' || p.kind === 'build_estimate') && !live.has(p.kind)) retire.push(p.kind);
  }
  return [...new Set(retire)];
}

/* ------------------------------------------------------------ text signals -- */

const NEGATION = /\b(not|n't|never|no longer|incomplete|still|yet)\b/i;

const MOISTURE_RE =
  /\bmoisture (?:reading|readings|meter|map|mapping|content|levels?)\b|\b\d{1,2}(?:\.\d)?\s?%\s?(?:mc|wme|moisture)\b|\bpin meter\b|\bpsychrometric|\bgrains per pound\b|\bgpp\b/i;

const CAUSE_RE =
  /\b(?:cause of (?:the )?loss|caused by|source of (?:the )?(?:leak|water|damage))\b[^.]{0,80}|\b(?:burst|broken|leaking|failed|cracked|frozen) (?:pipe|supply line|line|valve|water heater|toilet|dishwasher|washer hose|ice maker line)\b|\broof leak\b|\bsewer back-?up\b|\b(?:tub|toilet|sink) overflow\b/i;

const DRYING_DONE_RE =
  /\b(?:drying|dry-?out|dehus?|dehumidifiers?|air movers?|equipment)\b[^.]{0,40}\b(?:complete|completed|done|finished|pulled|removed|picked up)\b|\b(?:materials?|walls?|subfloor|everything) (?:is|are) (?:now )?dry\b|\b(?:reached|met|hit) (?:the )?dry (?:standard|goal)\b/i;

const DEMO_DONE_RE =
  /\b(?:demo|demolition|tear-?out|mitigation demo)\b[^.]{0,40}\b(?:complete|completed|done|finished)\b/i;

const ADJUSTER_RE =
  /\badjusters?\b[^.]{0,60}\b(?:here|on ?site|visit(?:ed)?|came (?:out|by)|walked|inspect(?:ed|ion)?|met (?:us|with)|looked at)\b/i;

const HOMEOWNER_DECISION_RE =
  /\b(?:homeowners?|owners?|customer|client|insured)\b[^.]{0,60}\b(?:decided|approved|agreed|signed|declined|chose|picked|wants? to (?:go ahead|proceed|move forward)|authori[sz]ed|said (?:yes|no) to)\b/i;

function sentenceMatch(text: string, re: RegExp, allowNegation = false): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const m = sentence.match(re);
    if (!m) continue;
    if (!allowNegation && NEGATION.test(sentence)) continue;
    return sentence.trim().slice(0, 240);
  }
  return null;
}

export function mentionsMoistureReadings(text: string): boolean {
  return Boolean(sentenceMatch(text, MOISTURE_RE, true));
}

export function causeOfLossFrom(text: string): string | null {
  const m = text.match(CAUSE_RE);
  return m ? m[0].trim().replace(/\s+/g, ' ').slice(0, 120) : null;
}

export function milestonesFrom(text: string): Milestone[] {
  const out: Milestone[] = [];
  if (sentenceMatch(text, DRYING_DONE_RE)) out.push('drying_complete');
  if (sentenceMatch(text, DEMO_DONE_RE)) out.push('demo_complete');
  return out;
}

export function eventsFrom(proofId: string, text: string): JobEvent[] {
  const out: JobEvent[] = [];
  const adjuster = sentenceMatch(text, ADJUSTER_RE);
  if (adjuster) out.push({ kind: 'adjuster_visit', proofId, quote: adjuster });
  const decision = sentenceMatch(text, HOMEOWNER_DECISION_RE, true);
  if (decision) out.push({ kind: 'homeowner_decision', proofId, quote: decision });
  return out;
}

const STOP = new Set(['the', 'and', 'with', 'from', 'into', 'room', 'area', 'work', 'were', 'was', 'this', 'that', 'for', 'all']);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(?:ing|ed|es|s)$/, ''));
}

/** Work lines no approved scope title shares a meaningful word with. */
export function workOutsideScope(work: string[], scopeTitles: string[]): string[] {
  const scopeWords = new Set(scopeTitles.flatMap(words));
  return work.filter((line) => {
    const w = words(line);
    return w.length > 0 && !w.some((x) => scopeWords.has(x));
  });
}
