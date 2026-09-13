import { eventClock } from '../../lib/downloadJson';
import type { ProofPeoplePresent, PersonPresent } from '../../lib/api';

function hasPeople(people: ProofPeoplePresent | null | undefined): boolean {
  return Boolean(people?.peoplePresent?.length);
}

function roleWord(role: string): string {
  if (role === 'crew') return 'Crew';
  if (role === 'homeowner') return 'Homeowner';
  if (role === 'adjuster') return 'Adjuster';
  if (role === 'inspector') return 'Inspector';
  if (role === 'other') return 'Other';
  return 'Unknown';
}

function PersonRow({
  person,
  onSeek,
}: {
  person: PersonPresent;
  onSeek?: (seconds: number) => void;
}) {
  const moments = person.appearMoments ?? [];
  const seekable = moments.filter((m) => Number.isFinite(m.tSec) && m.tSec >= 0);
  return (
    <li className="rounded-md bg-paper-100/70 px-2 py-1.5" data-testid="person-present-row">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-900">{person.label}</span>
        <span className="rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
          {roleWord(person.role)}
        </span>
        {person.speakerLabel ? (
          <span className="text-[10.5px] text-ink-500">Speaks as {person.speakerLabel}</span>
        ) : null}
      </div>
      {person.appearance ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-600">{person.appearance}</p>
      ) : null}
      {seekable.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {seekable.slice(0, 8).map((m) => (
            <li key={`${person.id}|${m.tSec}|${m.note ?? ''}`}>
              <button
                type="button"
                data-at={m.tSec}
                onClick={() => onSeek?.(m.tSec)}
                className="flex w-full items-start gap-2 rounded px-0.5 py-0.5 text-left hover:bg-paper-50"
              >
                <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                  {eventClock(m.tSec)}
                </span>
                <span className="text-[11.5px] leading-snug text-ink-700">
                  {m.note?.trim() || 'Visible'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : person.firstSeenSec != null && Number.isFinite(person.firstSeenSec) ? (
        <button
          type="button"
          data-at={person.firstSeenSec}
          onClick={() => onSeek?.(person.firstSeenSec!)}
          className="mt-1 font-mono text-[11px] tabular-nums text-ink-500 hover:text-ink-800"
        >
          First seen {eventClock(person.firstSeenSec)}
        </button>
      ) : null}
    </li>
  );
}

/**
 * Office Analysis “People present” — who is in frame / talking, with seekable
 * appearance moments. Never shows invented legal names.
 */
export function PeoplePresentPanel({
  people,
  onSeek,
}: {
  people?: ProofPeoplePresent | null;
  onSeek?: (seconds: number) => void;
}) {
  if (!hasPeople(people)) return null;
  const list = people!.peoplePresent ?? [];
  const speakers = people!.peopleSpeakers ?? [];

  return (
    <div
      className="mt-3 rounded-lg border border-line/80 bg-paper-50/50 px-3 py-3"
      data-testid="people-present-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          People present
        </p>
        <p className="text-[10px] tabular-nums text-ink-400">
          {people!.peopleCount ?? list.length}{' '}
          {(people!.peopleCount ?? list.length) === 1 ? 'person' : 'people'}
          {people!.peopleSource === 'llm' ? ' · model' : ''}
        </p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {list.map((person) => (
          <PersonRow key={person.id} person={person} onSeek={onSeek} />
        ))}
      </ul>
      {speakers.some((s) => s.turnCount > 0) ? (
        <p className="mt-2 text-[11px] text-ink-500" data-testid="people-speakers">
          Speaking:{' '}
          {speakers
            .filter((s) => s.turnCount > 0)
            .map((s) => `${s.speakerLabel} (${s.turnCount})`)
            .join(', ')}
        </p>
      ) : null}
    </div>
  );
}
