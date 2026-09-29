import type { ProofPeoplePresent } from './api';
import { displaySpeakerLabel, isFabricatedSpeakerLabel } from './speakerLabel';

function explicitSpeakerName(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  if (!text || isFabricatedSpeakerLabel(text)) return null;
  const shown = displaySpeakerLabel(text);
  if (shown === 'Unidentified speaker') return null;
  return shown;
}

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
  const fallback = displaySpeakerLabel(label);
  if (!people) return fallback;

  const fromSpeaker = (people.peopleSpeakers ?? []).find(
    (s) => s.speakerLabel?.toLowerCase() === label.toLowerCase() && s.displayName?.trim(),
  );
  const named = explicitSpeakerName(fromSpeaker?.displayName);
  if (named) return named;

  const fromPerson = (people.peoplePresent ?? []).find(
    (p) => p.speakerLabel?.toLowerCase() === label.toLowerCase() && p.displayName?.trim(),
  );
  const personName = explicitSpeakerName(fromPerson?.displayName);
  if (personName) return personName;

  return fallback;
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
