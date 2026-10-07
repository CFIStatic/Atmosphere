import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type {
  LegalHold,
  LegalHoldKind,
  LegalProductionPackage,
  LegalSubjectType,
  UserActivityEvent,
} from '../lib/types';
import { count, dateTime } from '../lib/format';
import { EmptyState, StatusPill } from '../components/ui';
import { ErrorLine, KpiStrip, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';
import { activitySheet } from '../lib/exportSheets';

/** The most rows the activity endpoint returns in one request. */
const ACTIVITY_EXPORT_LIMIT = 1000;
const ACTIVITY_SHOWN = 80;

function holdsSheet(holds: LegalHold[]): ExportSheet {
  return {
    name: 'Legal holds',
    columns: [
      { header: 'Title' },
      { header: 'Case number' },
      { header: 'Kind' },
      { header: 'Status' },
      { header: 'Reason' },
      { header: 'Counsel' },
      { header: 'Subjects' },
      { header: 'Received', type: 'date' },
      { header: 'Due', type: 'date' },
      { header: 'Opened', type: 'datetime' },
      { header: 'Released', type: 'datetime' },
      { header: 'Release reason' },
      { header: 'Hold id' },
    ],
    rows: holds.map((h) => [
      h.title,
      h.caseNumber,
      h.kind,
      h.status,
      h.reason,
      h.counselName,
      h.subjects.map((s) => `${s.subjectType} ${s.subjectId}`).join('; '),
      h.receivedAt,
      h.dueAt,
      h.createdAt,
      h.releasedAt,
      h.releaseReason,
      h.id,
    ]),
  };
}

const KINDS: LegalHoldKind[] = ['subpoena', 'lawsuit', 'preservation', 'investigation', 'other'];
const SUBJECTS: LegalSubjectType[] = ['org', 'user', 'job', 'proof', 'media'];

export function LegalPage() {
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [counts, setCounts] = useState({ open: 0, released: 0 });
  const [events, setEvents] = useState<UserActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The search the table is showing; the export uses the same one. */
  const [appliedQuery, setAppliedQuery] = useState('');
  const [production, setProduction] = useState<LegalProductionPackage | null>(null);

  const navigate = useNavigate();
  const [jobPortalId, setJobPortalId] = useState('');
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
    setAppliedQuery(query);
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
      <PageHeader
        eyebrow="System & access"
        title="Legal holds"
        subtitle="Subpoena, lawsuit, and preservation holds. Customer delete hides a clip from their library; the vault still has the file."
      />
      {error && <ErrorLine message={error} />}

      <KpiStrip
        items={[
          { label: 'Open holds', unit: 'count', value: String(counts.open), raw: counts.open, rawType: 'integer' },
          { label: 'Released', unit: 'count', value: String(counts.released), raw: counts.released, rawType: 'integer' },
          { label: 'Recent actions', unit: 'loaded in the monitor', value: String(events.length), raw: events.length, rawType: 'integer' },
        ]}
      />

      <Section title="Job portal" note="Staff view, including customer-deleted clips.">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (jobPortalId.trim()) navigate(`/legal/jobs/${jobPortalId.trim()}`);
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={jobPortalId}
            onChange={(event) => setJobPortalId(event.target.value)}
            placeholder="Job uuid"
            aria-label="Job uuid"
            className="field max-w-md"
          />
          <button type="submit" className="btn-primary">
            Open job
          </button>
        </form>
      </Section>

      <Section title="Open a hold" note="Staff only. Needs at least one subject.">
        <form onSubmit={(event: FormEvent) => void onCreate(event)} className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-medium text-ink-700">
            Case number
            <input required value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className="field mt-1" />
          </label>
          <label className="text-[12px] font-medium text-ink-700">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as LegalHoldKind)} className="field mt-1">
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-medium text-ink-700 sm:col-span-2">
            Title
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="field mt-1" />
          </label>
          <label className="text-[12px] font-medium text-ink-700 sm:col-span-2">
            Reason
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)} className="field mt-1" rows={3} />
          </label>
          <label className="text-[12px] font-medium text-ink-700">
            Subject
            <select
              value={subjectType}
              onChange={(e) => setSubjectType(e.target.value as LegalSubjectType)}
              className="field mt-1"
            >
              {SUBJECTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-medium text-ink-700">
            Subject id
            <input
              required
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder="uuid"
              className="field mt-1"
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">
              Open hold
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Holds"
        note={`${count(holds.length)} holds`}
        actions={
          <DownloadButton table="legal-holds" label="legal holds" disabled={holds.length === 0} sheets={() => [holdsSheet(holds)]} />
        }
      >
        {holds.length === 0 ? (
          <EmptyState title="No holds" body="Open one when counsel asks for video or a preservation letter arrives." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {holds.map((hold) => (
              <li key={hold.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-[14px] font-semibold text-ink-900">{hold.title}</h3>
                  <StatusPill status={hold.status} />
                  <span className="text-[11px] uppercase tracking-[0.06em] text-ink-500">{hold.kind}</span>
                  <span className="text-[12px] text-ink-500">{hold.caseNumber}</span>
                </div>
                <p className="mt-1.5 text-[13px] text-ink-700">{hold.reason}</p>
                <p className="mt-1 text-[11.5px] text-ink-500">
                  {hold.subjects.map((s) => `${s.subjectType} ${s.subjectId}`).join(' · ')}
                </p>
                {hold.status === 'open' && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn"
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
                      className="btn"
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
      </Section>

      {production && (
        <Section
          title="Last production"
          note={`${production.production.itemCount} videos · ${production.production.activityCount} actions`}
          actions={
            <DownloadButton
              table="legal-production"
              label="last production"
              sheets={() => [
                {
                  name: 'Production videos',
                  columns: [
                    { header: 'Video id' },
                    { header: 'Source kind' },
                    { header: 'Source id' },
                    { header: 'Customer deleted' },
                    { header: 'Content hash' },
                  ],
                  rows: production.videos.map((v) => [v.id, v.sourceKind, v.sourceId, v.userDeleted, v.contentHash]),
                },
                activitySheet('Production activity', production.activity),
              ]}
            />
          }
        >
          <ul className="divide-y divide-line border-y border-line">
            {production.videos.map((video) => (
              <li key={video.id} className="py-2.5 text-[13px]">
                <span className="text-[12px] text-ink-800">{video.id}</span>
                {video.userDeleted && (
                  <span className="ml-2 text-[11.5px] text-danger-600">customer deleted — still available</span>
                )}
                {video.downloadUrl && (
                  <a href={video.downloadUrl} className="ml-3 text-brand-600 hover:underline">
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="User actions"
        note="Every signed-in API call, secrets redacted."
        actions={
          <DownloadButton
            table="user-actions"
            label="user actions"
            disabled={events.length === 0}
            sheets={async () => {
              const all = await api.legalActivity({
                ...(appliedQuery ? { q: appliedQuery } : {}),
                limit: ACTIVITY_EXPORT_LIMIT,
              });
              return [activitySheet('User actions', all.events)];
            }}
          />
        }
      >
        <input
          type="search"
          placeholder="Search email, action, path…"
          aria-label="Search user actions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const q = query;
              void api
                .legalActivity({ q })
                .then((payload) => {
                  setEvents(payload.events);
                  setAppliedQuery(q);
                })
                .catch((err: unknown) =>
                  setError(err instanceof ApiError ? err.message : 'Activity failed'),
                );
            }
          }}
          className="field mb-3 max-w-sm"
        />
        {events.length === 0 ? (
          <EmptyState title="No actions yet" body="The monitor writes a row after each signed-in request." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="report-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Resource</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, ACTIVITY_SHOWN).map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-ink-600">{dateTime(row.occurredAt)}</td>
                      <td>{row.actorEmail ?? row.actorLabel ?? '—'}</td>
                      <td className="text-[12px] text-ink-800">{row.action}</td>
                      <td className="text-[12px] text-ink-500">
                        {row.resourceType ?? '—'} {row.resourceId ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {events.length > ACTIVITY_SHOWN && (
              <p className="mt-2 text-[12px] text-ink-500">
                Showing the latest {ACTIVITY_SHOWN} of {count(events.length)}. Download includes up to{' '}
                {count(ACTIVITY_EXPORT_LIMIT)} matching actions.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
