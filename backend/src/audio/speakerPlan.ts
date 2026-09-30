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

/** Ask stores a null score. Evidence only replaces Speaker N at confidence >= 0.7. */
export function confirmedIdentityConfidence(confidence: number | null | undefined): number {
  return confidence != null && confidence >= 0.7 ? confidence : 1;
}

function confirmedIdentityFields(hit: SpeakerIdentityRow) {
  return {
    displayName: hit.displayName,
    identityConfidence: confirmedIdentityConfidence(hit.confidence),
    identityMethod: hit.method.startsWith('voice') ? ('voice' as const) : ('roster' as const),
    identitySource: hit.sourceQuote,
  };
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
  const nextPeople = people.people.map((person) => {
    const hit = person.speakerLabel ? nameFor(person.speakerLabel) : null;
    if (!hit?.displayName) return person;
    return { ...person, ...confirmedIdentityFields(hit) };
  });
  const nextSpeakers = people.speakers.map((speaker) => {
    const hit = nameFor(speaker.speakerLabel);
    if (!hit?.displayName) return speaker;
    return { ...speaker, ...confirmedIdentityFields(hit) };
  });
  const seen = new Set<string>();
  for (const person of nextPeople) {
    if (person.speakerLabel) seen.add(person.speakerLabel.toLowerCase());
  }
  for (const speaker of nextSpeakers) {
    if (speaker.speakerLabel) seen.add(speaker.speakerLabel.toLowerCase());
  }
  const peopleOut = [...nextPeople];
  const speakersOut = [...nextSpeakers];
  for (const row of identities) {
    const name = row.displayName?.trim();
    if (!(row.status === 'confirmed' || row.method === 'voice_high') || !name) continue;
    const key = row.speakerLabel.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fields = confirmedIdentityFields({ ...row, displayName: name });
    speakersOut.push({
      speakerLabel: row.speakerLabel,
      personId: null,
      turnCount: 0,
      serviceTitle: null,
      ...fields,
    });
    peopleOut.push({
      id: `person-${peopleOut.length + 1}`,
      label: name,
      role: 'unknown',
      appearance: null,
      appearMoments: [],
      speakerLabel: row.speakerLabel,
      serviceTitle: null,
      ...fields,
    });
  }
  return { ...people, people: peopleOut, speakers: speakersOut, count: peopleOut.length };
}

export function nameIsConfirmed(identities: SpeakerIdentityRow[], proofId: string, speakerLabel: string): string | null {
  return confirmedNameFor(identities, proofId, speakerLabel);
}
