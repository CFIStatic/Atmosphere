import type { ProofPeoplePresent } from './api';

/**
 * Resolve a diarization label (Speaker A) to a confident displayName when
 * people/speakers carry an identity. Never invents — falls back to the label.
 */
export function speakerDisplayName(
  speakerLabel: string | null | undefined,
  people?: ProofPeoplePresent | null,
): string {
  const label = String(speakerLabel || '').trim();
  if (!label) return '';
  if (!people) return label;

  const fromSpeaker = (people.peopleSpeakers ?? []).find(
    (s) => s.speakerLabel?.toLowerCase() === label.toLowerCase() && s.displayName?.trim(),
  );
  if (fromSpeaker?.displayName?.trim()) return fromSpeaker.displayName.trim();

  const fromPerson = (people.peoplePresent ?? []).find(
    (p) => p.speakerLabel?.toLowerCase() === label.toLowerCase() && p.displayName?.trim(),
  );
  if (fromPerson?.displayName?.trim()) return fromPerson.displayName.trim();

  // label itself may already be the display name after API overlay
  return label;
}

export function overlaySpeakerDisplayName<T extends { speakerLabel?: string | null }>(
  rows: T[],
  people?: ProofPeoplePresent | null,
): T[] {
  if (!people || !rows.length) return rows;
  return rows.map((row) => {
    const next = speakerDisplayName(row.speakerLabel, people);
    if (!next || next === row.speakerLabel) return row;
    return { ...row, speakerLabel: next };
  });
}
