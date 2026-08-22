import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type {
  LegalHold,
  LegalHoldKind,
  LegalProductionPackage,
  LegalSubjectType,
  UserActivityEvent,
} from '../lib/types';
import { dateTime } from '../lib/format';
import { EmptyState, SectionHeading, StatTile, StatusPill } from '../components/ui';

const KINDS: LegalHoldKind[] = ['subpoena', 'lawsuit', 'preservation', 'investigation', 'other'];
const SUBJECTS: LegalSubjectType[] = ['org', 'user', 'job', 'proof', 'media'];

export function LegalPage() {
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [counts, setCounts] = useState({ open: 0, released: 0 });
  const [events, setEvents] = useState<UserActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [production, setProduction] = useState<LegalProductionPackage | null>(null);

  const [caseNumber, setCaseNumber] = useState('');
  const [kind, setKind] = useState<LegalHoldKind>('subpoena');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [subjectType, setSubjectType] = useState<LegalSubjectType>('org');
  const [subjectId, setSubjectId] = useState('');

  async function refresh() {
    const [holdPayload, activityPayload] = await Promise.all([
      api.legalHolds(),
      api.legalActivity(query ? { q: query } : undefined),
    ]);
    setHolds(holdPayload.holds);
    setCounts(holdPayload.counts);
    setEvents(activityPayload.events);
  }

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load legal desk');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.createLegalHold({
        caseNumber,
        kind,
        title,
        reason,
        subjects: [{ subjectType, subjectId }],
      });
      setCaseNumber('');
      setTitle('');
      setReason('');
      setSubjectId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open hold');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Legal</h1>
      <p className="mt-1 text-sm text-ink-500">
        Subpoena, lawsuit, and preservation holds. Customer delete hides a clip from their
        library; the vault still has the file.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Open holds" value={String(counts.open)} />
        <StatTile label="Released" value={String(counts.released)} />
        <StatTile label="Recent actions" value={String(events.length)} />
      </div>

      <SectionHeading title="Open a hold" hint="Staff only. Needs at least one subject." />
      <form onSubmit={(event: FormEvent) => void onCreate(event)} className="grid gap-3 rounded-xl border border-line bg-paper-0 p-5 sm:grid-cols-2">
        <label className="text-sm">
          Case number
          <input
            required
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LegalHoldKind)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2"
          >
            {KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          Reason
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2"
            rows={3}
          />
        </label>
        <label className="text-sm">
          Subject
          <select
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value as LegalSubjectType)}
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2"
          >
            {SUBJECTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Subject id
          <input
            required
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            placeholder="uuid"
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Open hold
          </button>
        </div>
      </form>

      <SectionHeading title="Holds" />
      {holds.length === 0 ? (
        <EmptyState title="No holds" body="Open one when counsel asks for video or a preservation letter arrives." />
      ) : (
        <ul className="grid gap-3">
          {holds.map((hold) => (
            <li key={hold.id} className="rounded-xl border border-line bg-paper-0 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">{hold.title}</h3>
                <StatusPill status={hold.status} />
                <span className="text-xs uppercase tracking-wide text-ink-500">{hold.kind}</span>
                <span className="font-mono text-xs text-ink-500">{hold.caseNumber}</span>
              </div>
              <p className="mt-2 text-sm text-ink-600">{hold.reason}</p>
              <p className="mt-1 text-xs text-ink-500">
                {hold.subjects.map((s) => `${s.subjectType} ${s.subjectId}`).join(' · ')}
              </p>
              {hold.status === 'open' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-paper-200"
                    onClick={() =>
                      void api
                        .produceLegalHold(hold.id, 'Staff production')
                        .then(setProduction)
                        .catch((err: unknown) =>
                          setError(err instanceof ApiError ? err.message : 'Produce failed'),
                        )
                    }
                  >
                    Produce videos
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-paper-200"
                    onClick={() => {
                      const why = window.prompt('Why is this hold being released?');
                      if (!why) return;
                      void api
                        .releaseLegalHold(hold.id, why)
                        .then(() => refresh())
                        .catch((err: unknown) =>
                          setError(err instanceof ApiError ? err.message : 'Release failed'),
                        );
                    }}
                  >
                    Release
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {production && (
        <>
          <SectionHeading
            title="Last production"
            hint={`${production.production.itemCount} videos · ${production.production.activityCount} actions`}
          />
          <ul className="grid gap-2">
            {production.videos.map((video) => (
              <li key={video.id} className="rounded-lg border border-line bg-paper-0 px-4 py-3 text-sm">
                <span className="font-mono text-xs">{video.id}</span>
                {video.userDeleted && (
                  <span className="ml-2 text-xs text-danger-600">customer deleted — still available</span>
                )}
                {video.downloadUrl && (
                  <a href={video.downloadUrl} className="ml-3 text-brand-600 hover:underline">
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionHeading title="User actions" hint="Every signed-in API call, secrets redacted." />
      <input
        type="search"
        placeholder="Search email, action, path…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void api
              .legalActivity({ q: query })
              .then((payload) => setEvents(payload.events))
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.message : 'Activity failed'),
              );
          }
        }}
        className="mb-4 w-full max-w-sm rounded-lg border border-line-strong bg-paper-0 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      {events.length === 0 ? (
        <EmptyState title="No actions yet" body="The monitor writes a row after each signed-in request." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-paper-0">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Resource</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 80).map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-4 py-2 text-ink-500">{dateTime(row.occurredAt)}</td>
                  <td className="px-4 py-2">{row.actorEmail ?? row.actorLabel ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-500">
                    {row.resourceType ?? '—'} {row.resourceId ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
