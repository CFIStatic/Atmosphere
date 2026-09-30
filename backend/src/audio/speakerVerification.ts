/**
 * Pending checks and confirmed identities.
 *
 * A high-confidence voice match is already an identity. A medium voice match,
 * or a name heard in the transcript, stays pending until someone answers.
 * A confirmed name is stored for that speaker and copied onto the job's other
 * clips when they share the voiceprint or the same name-pickup candidate.
 * Role guesses are never copied into the identity.
 */

import type { NameCandidate } from './speakerNamePickup.js';
import type { VoiceMatch } from './speakerMatch.js';
import type { RoleGuess, SpeakerRole } from './speakerRoleGuess.js';

export type IdentityMethod = 'name_pickup' | 'voice_high' | 'voice_medium' | 'user';
export type IdentityStatus = 'pending' | 'confirmed' | 'rejected';

export type SpeakerIdentityRow = {
  id: string;
  jobId: string;
  proofId: string;
  speakerLabel: string;
  displayName: string | null;
  status: IdentityStatus;
  method: IdentityMethod;
  confidence: number | null;
  voiceprintId: string | null;
  subjectUserId: string | null;
  sourceProofId: string | null;
  sourceTSec: number | null;
  sourceQuote: string | null;
  clipTitle: string | null;
};

export type RoleGuessRow = {
  id: string;
  proofId: string;
  speakerLabel: string;
  role: SpeakerRole;
  confidence: number;
  tSec: number | null;
  quote: string;
  clipTitle: string | null;
  status: 'tentative' | 'confirmed' | 'corrected' | 'dismissed';
};

export function speakerClock(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const n = Math.floor(seconds);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function verificationQuestion(input: {
  speakerLabel: string;
  clipTitle: string;
  tSec: number | null;
  candidateName?: string | null;
  role?: SpeakerRole | null;
}): string {
  const who = input.speakerLabel.trim() || 'Unidentified speaker';
  const clip = input.clipTitle.trim() || 'this clip';
  const at = speakerClock(input.tSec);
  const where = at ? `in ${clip} at ${at}` : `in ${clip}`;
  if (input.candidateName?.trim()) return `Is ${who} ${where} ${input.candidateName.trim()}?`;
  if (input.role) return `Is ${who} ${where} the ${input.role}?`;
  return `Who is ${who} ${where}?`;
}

const ROLE_LABEL: Record<SpeakerRole, string> = {
  homeowner: 'homeowner',
  subcontractor: 'subcontractor',
  crew: 'crew',
  adjuster: 'adjuster',
  other: 'other',
};

/** UI label. Names only when confirmed or a high-confidence voice match. */
export function uiSpeakerLabel(input: {
  speakerLabel: string | null | undefined;
  confirmedName?: string | null;
  role?: SpeakerRole | null;
  roleStatus?: RoleGuessRow['status'] | null;
  unidentified?: string;
}): string {
  const name = input.confirmedName?.trim();
  if (name) return name;
  const base = (input.speakerLabel ?? '').replace(/\s+/g, ' ').trim() || input.unidentified || 'Unidentified speaker';
  const role = input.role ? ROLE_LABEL[input.role] : null;
  if (!role || !input.roleStatus || input.roleStatus === 'dismissed') return base;
  const inner = input.roleStatus === 'tentative' ? `likely ${role}` : role;
  return `${base} (${inner})`;
}

/** Fact label for evidence, verbatim attribution, and exports. Guesses never appear. */
export function factSpeakerLabel(input: {
  speakerLabel: string | null | undefined;
  confirmedName?: string | null;
  unidentified?: string;
}): string {
  const name = input.confirmedName?.trim();
  if (name) return name;
  const base = (input.speakerLabel ?? '').replace(/\s+/g, ' ').trim();
  return base || input.unidentified || 'Unidentified speaker';
}

function newId(): string {
  return `spk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function planIdentities(input: {
  jobId: string;
  proofId: string;
  clipTitle: string;
  names: NameCandidate[];
  matches: Array<VoiceMatch & { speakerLabel: string; tSec: number | null; quote: string | null }>;
  existing?: SpeakerIdentityRow[];
}): SpeakerIdentityRow[] {
  const rows: SpeakerIdentityRow[] = [];
  const taken = new Set(
    (input.existing ?? [])
      .filter((row) => row.status !== 'pending')
      .map((row) => `${row.proofId}|${row.speakerLabel.toLowerCase()}`),
  );
  for (const match of input.matches) {
    const key = `${input.proofId}|${match.speakerLabel.toLowerCase()}`;
    if (taken.has(key)) continue;
    const high = match.band === 'high';
    rows.push({
      id: newId(),
      jobId: input.jobId,
      proofId: input.proofId,
      speakerLabel: match.speakerLabel,
      displayName: match.displayName,
      status: high ? 'confirmed' : 'pending',
      method: high ? 'voice_high' : 'voice_medium',
      confidence: match.score,
      voiceprintId: match.voiceprintId,
      subjectUserId: match.userId,
      sourceProofId: input.proofId,
      sourceTSec: match.tSec,
      sourceQuote: match.quote,
      clipTitle: input.clipTitle,
    });
    if (high) taken.add(key);
  }
  for (const name of input.names) {
    const key = `${input.proofId}|${name.speakerLabel.toLowerCase()}`;
    if (taken.has(key)) continue;
    if (rows.some((row) => row.proofId === input.proofId && row.speakerLabel.toLowerCase() === name.speakerLabel.toLowerCase() && row.method.startsWith('voice'))) {
      continue;
    }
    rows.push({
      id: newId(),
      jobId: input.jobId,
      proofId: input.proofId,
      speakerLabel: name.speakerLabel,
      displayName: name.name,
      status: 'pending',
      method: 'name_pickup',
      confidence: null,
      voiceprintId: null,
      subjectUserId: null,
      sourceProofId: input.proofId,
      sourceTSec: name.tSec,
      sourceQuote: name.quote,
      clipTitle: input.clipTitle,
    });
    taken.add(key);
  }
  return rows;
}

function sameCluster(anchor: SpeakerIdentityRow, row: SpeakerIdentityRow, name: string): boolean {
  if (row.proofId === anchor.proofId && row.speakerLabel.toLowerCase() === anchor.speakerLabel.toLowerCase()) return true;
  if (anchor.voiceprintId && row.voiceprintId === anchor.voiceprintId) return true;
  if (
    anchor.method === 'name_pickup' &&
    row.method === 'name_pickup' &&
    row.displayName?.toLowerCase() === name.toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function resolveSpeakerAnswer(
  identities: SpeakerIdentityRow[],
  input: {
    id: string;
    answer: 'yes' | 'no' | 'other';
    displayName?: string | null;
    now?: string;
  },
): SpeakerIdentityRow[] {
  const anchor = identities.find((row) => row.id === input.id);
  if (!anchor || anchor.status !== 'pending') return identities;
  if (input.answer === 'no') {
    return identities.map((row) => {
      if (row.id === anchor.id) return { ...row, status: 'rejected' };
      if (anchor.voiceprintId && row.voiceprintId === anchor.voiceprintId && row.status === 'pending') {
        return { ...row, status: 'rejected' };
      }
      return row;
    });
  }
  const name = (input.answer === 'other' ? input.displayName : anchor.displayName)?.trim() || '';
  if (!name) return identities;
  return identities.map((row) => {
    if (row.status === 'rejected') return row;
    if (input.answer === 'yes') {
      // A high-confidence voice match is already an identity. Yes confirms the
      // pending question; it does not replace that name. Someone else does.
      if (row.method === 'voice_high') return row;
      if (!sameCluster(anchor, row, name)) return row;
      return {
        ...row,
        displayName: name,
        status: 'confirmed',
        method: row.method === 'name_pickup' ? 'user' : row.method,
        confidence: row.confidence != null && row.confidence >= 0.7 ? row.confidence : 1,
      };
    }
    const sameSpeaker =
      row.proofId === anchor.proofId && row.speakerLabel.toLowerCase() === anchor.speakerLabel.toLowerCase();
    const sameVoice = Boolean(anchor.voiceprintId && row.voiceprintId === anchor.voiceprintId);
    if (row.id !== anchor.id && !sameVoice && !sameSpeaker) return row;
    return { ...row, displayName: name, status: 'confirmed', method: 'user', confidence: 1 };
  });
}

export function resolveRoleAnswer(
  guesses: RoleGuessRow[],
  input: { speakerLabel: string; proofId: string; answer: 'yes' | 'no' | 'other'; role?: SpeakerRole | null },
): RoleGuessRow[] {
  return guesses.map((guess) => {
    if (guess.proofId !== input.proofId || guess.speakerLabel.toLowerCase() !== input.speakerLabel.toLowerCase()) {
      return guess;
    }
    if (input.answer === 'no') return { ...guess, status: 'dismissed' };
    if (input.answer === 'yes') return { ...guess, status: 'confirmed' };
    if (input.answer === 'other' && input.role) return { ...guess, role: input.role, status: 'corrected' };
    return guess;
  });
}

export function confirmedNameFor(
  identities: SpeakerIdentityRow[],
  proofId: string,
  speakerLabel: string,
): string | null {
  const rows = identities.filter(
    (row) =>
      row.proofId === proofId &&
      row.speakerLabel.toLowerCase() === speakerLabel.toLowerCase() &&
      (row.status === 'confirmed' || row.method === 'voice_high') &&
      row.displayName?.trim(),
  );
  return rows[0]?.displayName?.trim() || null;
}

export function pendingQuestions(identities: SpeakerIdentityRow[], guesses: RoleGuessRow[] = []): Array<{
  id: string;
  speakerLabel: string;
  clipTitle: string;
  tSec: number | null;
  candidateName: string | null;
  role: SpeakerRole | null;
  quote: string | null;
  question: string;
}> {
  const settled = new Set(
    identities
      .filter((row) => row.status === 'confirmed' || row.method === 'voice_high')
      .map((row) => `${row.proofId}|${row.speakerLabel.toLowerCase()}`),
  );
  const questions = identities
    .filter((row) => row.status === 'pending' && row.displayName?.trim())
    .filter((row) => !settled.has(`${row.proofId}|${row.speakerLabel.toLowerCase()}`))
    .map((row) => ({
      id: row.id,
      speakerLabel: row.speakerLabel,
      clipTitle: row.clipTitle || 'this clip',
      tSec: row.sourceTSec,
      candidateName: row.displayName,
      role: null as SpeakerRole | null,
      quote: row.sourceQuote,
      question: verificationQuestion({
        speakerLabel: row.speakerLabel,
        clipTitle: row.clipTitle || 'this clip',
        tSec: row.sourceTSec,
        candidateName: row.displayName,
      }),
    }));
  for (const guess of guesses) {
    if (guess.status !== 'tentative') continue;
    if (confirmedNameFor(identities, guess.proofId, guess.speakerLabel)) continue;
    questions.push({
      id: guess.id,
      speakerLabel: guess.speakerLabel,
      clipTitle: guess.clipTitle || 'this clip',
      tSec: guess.tSec,
      candidateName: null,
      role: guess.role,
      quote: guess.quote,
      question: verificationQuestion({
        speakerLabel: guess.speakerLabel,
        clipTitle: guess.clipTitle || 'this clip',
        tSec: guess.tSec,
        role: guess.role,
      }),
    });
  }
  return questions;
}

export function roleGuessRows(guesses: RoleGuess[], proofId: string, clipTitle: string | null = null): RoleGuessRow[] {
  return guesses.map((guess) => ({
    id: newId(),
    proofId,
    speakerLabel: guess.speakerLabel,
    role: guess.role,
    confidence: guess.confidence,
    tSec: guess.tSec,
    quote: guess.quote,
    clipTitle,
    status: 'tentative' as const,
  }));
}
