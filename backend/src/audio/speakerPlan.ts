/**
 * Turn one clip's transcript into name candidates, role guesses, and
 * identity rows. Voice matching is applied separately once audio is in hand.
 * Confirmed names and high-confidence voice matches are the only identities
 * written onto people.displayName.
 */

import { completeAskText } from '../lib/askModel.js';
import type { PeoplePresent } from './peoplePresent.js';
import { linesFromTranscript, pickupSpeakerNames, type TranscriptLine } from './speakerNamePickup.js';
import { guessSpeakerRoles } from './speakerRoleGuess.js';
import {
  confirmedNameFor,
  planIdentities,
  roleGuessRows,
  type RoleGuessRow,
  type SpeakerIdentityRow,
} from './speakerVerification.js';
import type { VoiceMatch } from './speakerMatch.js';

export type ClipSpeakerPlan = {
  lines: TranscriptLine[];
  identities: SpeakerIdentityRow[];
  roleGuesses: RoleGuessRow[];
};

export async function planClipSpeakers(input: {
  jobId: string;
  proofId: string;
  clipTitle: string;
  transcript: string | null | undefined;
  existing?: SpeakerIdentityRow[];
  complete?: ((input: { system: string; user: string }) => Promise<{ text: string } | null>) | null;
}): Promise<ClipSpeakerPlan> {
  const lines = linesFromTranscript(input.transcript);
  const names = pickupSpeakerNames(lines);
  const identified = new Set(
    (input.existing ?? [])
      .filter((row) => row.status === 'confirmed' || row.method === 'voice_high')
      .map((row) => row.speakerLabel.toLowerCase()),
  );
  const complete =
    input.complete === undefined
      ? async (prompt: { system: string; user: string }) =>
          completeAskText({ ...prompt, maxTokens: 500, mode: 'analysis', signal: AbortSignal.timeout(8000) })
      : input.complete;
  const guesses = await guessSpeakerRoles(lines, identified, complete);
  const identities = planIdentities({
    jobId: input.jobId,
    proofId: input.proofId,
    clipTitle: input.clipTitle,
    names,
    matches: [],
    existing: input.existing,
  });
  return {
    lines,
    identities,
    roleGuesses: roleGuessRows(guesses, input.proofId, input.clipTitle),
  };
}

/** Voice matches replace a pending name on the same speaker. Confirmed rows stay. */
export function addVoiceMatches(input: {
  jobId: string;
  proofId: string;
  clipTitle: string;
  identities: SpeakerIdentityRow[];
  matches: Array<VoiceMatch & { speakerLabel: string; tSec: number | null; quote: string | null }>;
}): SpeakerIdentityRow[] {
  const voiceRows = planIdentities({
    jobId: input.jobId,
    proofId: input.proofId,
    clipTitle: input.clipTitle,
    names: [],
    matches: input.matches,
    existing: input.identities,
  });
  const voiced = new Set(voiceRows.map((row) => row.speakerLabel.toLowerCase()));
  const kept = input.identities.filter((row) => !voiced.has(row.speakerLabel.toLowerCase()) || row.status === 'confirmed');
  return [...kept, ...voiceRows];
}

/** High-confidence and confirmed names become displayName. Guesses do not. */
export function applyConfirmedNames(people: PeoplePresent, identities: SpeakerIdentityRow[]): PeoplePresent {
  const nameFor = (label: string) => {
    const rows = identities.filter(
      (row) =>
        row.speakerLabel.toLowerCase() === label.toLowerCase() &&
        (row.status === 'confirmed' || row.method === 'voice_high') &&
        row.displayName?.trim(),
    );
    return rows[0] ?? null;
  };
  return {
    ...people,
    people: people.people.map((person) => {
      const hit = person.speakerLabel ? nameFor(person.speakerLabel) : null;
      if (!hit?.displayName) return person;
      return {
        ...person,
        displayName: hit.displayName,
        identityConfidence: hit.confidence,
        identityMethod: hit.method.startsWith('voice') ? 'voice' as const : 'roster' as const,
        identitySource: hit.sourceQuote,
      };
    }),
    speakers: people.speakers.map((speaker) => {
      const hit = nameFor(speaker.speakerLabel);
      if (!hit?.displayName) return speaker;
      return {
        ...speaker,
        displayName: hit.displayName,
        identityConfidence: hit.confidence,
        identityMethod: hit.method.startsWith('voice') ? 'voice' as const : 'roster' as const,
        identitySource: hit.sourceQuote,
      };
    }),
  };
}

export function nameIsConfirmed(identities: SpeakerIdentityRow[], proofId: string, speakerLabel: string): string | null {
  return confirmedNameFor(identities, proofId, speakerLabel);
}
