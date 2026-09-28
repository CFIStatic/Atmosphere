import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  FileText,
  FolderOpen,
  History,
  Loader2,
  ScanSearch,
  Share2,
  Shield,
  UserRound,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type SharedJobRecord } from '../../lib/api';
import { cn } from '../../design/cn';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { PersonAvatar } from '../PersonAvatar';
import { JobFilePlayer } from './JobFilePlayer';
import { loadJobTimelineSource } from './jobTimelineLoad';
import {
  TIMELINE_FILTERS,
  buildJobTimeline,
  filterTimeline,
  formatCtTime,
  groupTimelineDays,
  orderTimeline,
  timelinePeople,
  timelineSeekTarget,
  type TimelineEvent,
  type TimelineFilter,
  type TimelineKind,
  type TimelineSource,
} from './jobTimeline';

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  job: FolderOpen,
  people: UserRound,
  clip: Video,
  analysis: ScanSearch,
  packet: FileText,
  share: Share2,
  custody: Shield,
  history: History,
};

/**
 * Chronological record of one job. Notes are not a source — that card was
 * removed from Happening Now and stays gone. Listing a thumbnail does not
 * open the video; playback is a click, and that is the only call that can
 * record a view.
 */
export function JobTimeline({
  jobId,
  record,
  office,
  events: preset,
}: {
  jobId: string;
  record: SharedJobRecord | null;
  office: boolean;
  /** When set, skip the network and render these rows (tests and screenshots). */
  events?: TimelineEvent[];
}) {
  const usingPreset = preset !== undefined;
  const loadKey = `${jobId}:${office ? 'office' : 'viewer'}`;
  const [source, setSource] = useState<TimelineSource | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [person, setPerson] = useState('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [player, setPlayer] = useState<{
    event: TimelineEvent;
    url: string;
  } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [scopedJobId, setScopedJobId] = useState(jobId);
  if (scopedJobId !== jobId) {
    setScopedJobId(jobId);
    setFilter('all');
    setPerson('all');
    setOldestFirst(false);
    setPlayer(null);
    setOpeningId(null);
    setOpenError(null);
    setSource(null);
    setLoadedKey(null);
  }
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const ready = usingPreset || (loadedKey === loadKey && source !== null);
  const rows = useMemo(() => {
    if (usingPreset) return preset;
    if (!ready || !source) return [];
    return buildJobTimeline({
      ...source,
      record: record?.job.id === jobId ? record : source.record,
    });
  }, [usingPreset, preset, ready, source, record, jobId]);

  useEffect(() => {
    if (usingPreset) return;
    let cancelled = false;
    const key = loadKey;
    void loadJobTimelineSource({
      jobId,
      record: recordRef.current,
      office,
    }).then((next) => {
      if (cancelled) return;
      setSource(next);
      setLoadedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, office, usingPreset, loadKey]);

  useVisiblePolling(
    () => {
      void (async () => {
        let proofs: TimelineSource['proofs'] = null;
        try {
          proofs = await api.jobProofs(jobId);
        } catch {
          proofs = null;
        }
        let liveSessions: TimelineSource['liveSessions'] | null = null;
        if (office) {
          try {
            const live = await api.jobLiveSessions(jobId);
            liveSessions = live.sessions ?? [];
          } catch {
            liveSessions = null;
          }
        }
        setSource((current) => {
          if (!current || current.jobId !== jobId) return current;
          return {
            ...current,
            proofs: proofs ?? current.proofs,
            liveSessions: liveSessions ?? current.liveSessions,
          };
        });
      })();
    },
    { enabled: !usingPreset && ready, intervalMs: 12_000 },
  );

  const people = useMemo(() => timelinePeople(rows), [rows]);
  const filtered = useMemo(() => filterTimeline(rows, filter, person), [rows, filter, person]);
  const ordered = useMemo(() => orderTimeline(filtered, oldestFirst), [filtered, oldestFirst]);
  const days = useMemo(() => groupTimelineDays(ordered.rest), [ordered.rest]);

  async function openClip(event: TimelineEvent) {
    if (!event.proofId) return;
    setOpenError(null);
    setOpeningId(event.id);
    try {
      const res = await api.proofVideoUrl(event.proofId);
      setPlayer({ event, url: res.url });
    } catch {
      setOpenError('Could not open that clip.');
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="job-timeline"
      aria-label="Timeline"
    >
      <div className="shrink-0 space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">Timeline</h2>
          <button
            type="button"
            aria-pressed={oldestFirst}
            data-testid="timeline-order"
            onClick={() => setOldestFirst((value) => !value)}
            className="rounded-full border border-line bg-paper-200/70 px-3 py-1 text-xs font-medium text-ink-700 hover:text-ink-900"
          >
            {oldestFirst ? 'Oldest first' : 'Newest first'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Event type">
          {TIMELINE_FILTERS.map((item) => {
            const selected = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(item.id)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  selected
                    ? 'bg-brand-500 text-white'
                    : 'bg-paper-200/80 text-ink-600 hover:text-ink-900',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Person
          <select
            aria-label="Person"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            className="rounded-lg border border-line bg-paper-200 px-2 py-1 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">Everyone</option>
            {people.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!ready ? (
        <div
          role="status"
          data-testid="job-timeline-loading"
          className="flex items-center gap-2 rounded-xl border border-line bg-paper-50 px-4 py-6 text-sm text-ink-500"
        >
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden />
          Loading the timeline…
        </div>
      ) : rows.length === 0 ? (
        <p
          role="status"
          data-testid="job-timeline-empty"
          className="rounded-xl border border-line bg-paper-50 px-4 py-6 text-sm text-ink-500"
        >
          Nothing on this job yet.
        </p>
      ) : filtered.length === 0 ? (
        <p role="status" className="rounded-xl border border-line bg-paper-50 px-4 py-6 text-sm text-ink-500">
          Nothing matches these filters.
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" data-testid="job-timeline-scroll">
          {ordered.live.length > 0 ? (
            <div className="rounded-xl border border-brand-500/50 bg-paper-50">
              <div className="sticky top-0 z-20 flex items-center gap-2 rounded-t-xl bg-paper-50/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-500 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden />
                Now
              </div>
              <ul className="divide-y divide-line">
                {ordered.live.map((event) => (
                  <TimelineRow
                    key={event.id}
                    event={event}
                    opening={openingId === event.id}
                    onOpen={() => void openClip(event)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {days.map((day) => (
            <section key={day.key}>
              <h3 className="sticky top-0 z-10 border-b border-line bg-paper-100/95 px-1 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 backdrop-blur">
                {day.label}
              </h3>
              <ul className="divide-y divide-line">
                {day.events.map((event) => (
                  <TimelineRow
                    key={event.id}
                    event={event}
                    opening={openingId === event.id}
                    onOpen={() => void openClip(event)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {openError ? (
        <p role="alert" className="mt-2 text-sm text-danger-600">
          {openError}
        </p>
      ) : null}

      {player ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="presentation"
          onClick={() => setPlayer(null)}
        >
          <div
            role="dialog"
            aria-label="Clip"
            data-testid="timeline-player"
            className="w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-paper-100 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <p className="min-w-0 truncate text-sm text-ink-800">{player.event.sentence}</p>
              <button
                type="button"
                onClick={() => setPlayer(null)}
                className="shrink-0 text-xs font-medium text-ink-500 hover:text-ink-900"
              >
                Close
              </button>
            </div>
            <JobFilePlayer
              src={player.url}
              poster={player.event.posterUrl}
              knownDurationSeconds={player.event.durationSeconds}
              seekTo={timelineSeekTarget(player.event)}
              privacyRedactions={player.event.privacyRedactions?.ranges ?? null}
              childPrivacyRedactions={player.event.childPrivacyRedactions?.ranges ?? null}
              className="aspect-video w-full bg-black"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TimelineRow({
  event,
  opening,
  onOpen,
}: {
  event: TimelineEvent;
  opening: boolean;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[event.kind];
  const when = formatCtTime(event.at);
  return (
    <li className="flex items-start gap-3 px-3 py-3" data-testid={`timeline-event-${event.id}`}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper-200 text-brand-500">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-900">{event.sentence}</p>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-500">
          {event.live ? 'In progress' : event.kind}
        </p>
      </div>
      {event.proofId ? (
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          data-testid={`timeline-thumb-${event.id}`}
          aria-label={`Open clip: ${event.sentence}`}
          className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border border-line bg-paper-200 text-ink-500 hover:border-brand-500"
        >
          {event.posterUrl ? (
            <img src={event.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center">
              <Clapperboard className="h-4 w-4" aria-hidden />
            </span>
          )}
        </button>
      ) : null}
      {event.actorName ? (
        <PersonAvatar fullName={event.actorName} email={event.actorEmail} avatarUrl={event.avatarUrl} size="sm" />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-200 text-ink-500" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      )}
      {when ? <time className="w-24 shrink-0 pt-1 text-right text-xs tabular-nums text-ink-500">{when}</time> : null}
    </li>
  );
}
