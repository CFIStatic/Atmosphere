import { useEffect, useRef, useState } from 'react';
import { api, type EvidenceItem, type CustodyEntry } from '../../lib/api';
import { SpinnerIcon } from '../icons';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';

/**
 * The evidence locker.
 *
 * Modelled on how police forces handle body-camera footage, because the problem
 * is the same one. A general contractor and a subcontractor end up in front of
 * a mediator arguing about what happened on a Tuesday in August, and video of
 * that Tuesday is worth nothing on its own. What makes it worth something is
 * being able to say: this file has not changed since it arrived, here is
 * everyone who has ever opened it, here is when, and here is why it still
 * exists.
 *
 * So the shape is a records system, not a gallery:
 *
 *   A list first. Every file on the job in one table — filed by, date,
 *   category, length, and how many times it has been opened. The view count is
 *   there because "you never showed me that video" is answered by a number.
 *
 *   A player with its papers. Selecting a file gives the footage and, beside
 *   it, everything the record knows: the digest, where and when it was filmed,
 *   what the checks found, and the retention position.
 *
 *   A chain of custody underneath. Every access, including views, in the order
 *   they happened. Append-only in the database rather than by convention — a
 *   custody record the custodian can edit is not a custody record.
 */

const CATEGORY_STYLE: Record<string, string> = {
  before: 'bg-paper-200/60 text-ink-700',
  after: 'bg-brand-50 text-brand-700',
  condition: 'bg-caution-50 text-caution-600',
  issue: 'bg-danger-50 text-danger-600',
  completion: 'bg-success-50 text-success-600',
  other: 'bg-paper-200/60 text-ink-600',
};

const ACTION_WORD: Record<string, string> = {
  uploaded: 'Filed',
  viewed: 'Opened',
  downloaded: 'Downloaded',
  analysed: 'Read by the assistant',
  accepted: 'Day accepted',
  rejected: 'Day rejected',
  held: 'Placed on hold',
  released: 'Hold lifted',
  shared: 'Link shared',
  deleted: 'Removed from library',
};

const ACTION_DOT: Record<string, string> = {
  uploaded: 'bg-brand-600',
  viewed: 'bg-ink-400',
  downloaded: 'bg-ink-400',
  analysed: 'bg-ink-400',
  accepted: 'bg-success-600',
  rejected: 'bg-danger-600',
  held: 'bg-caution-600',
  released: 'bg-caution-600',
  shared: 'bg-brand-600',
  deleted: 'bg-ink-400',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const length = (seconds: number | null) => {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const size = (bytes: number | null) =>
  bytes === null ? '—' : `${(bytes / 1_048_576).toFixed(1)} MB`;

export function EvidenceLocker({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [counts, setCounts] = useState({ items: 0, onHold: 0, neverViewed: 0 });
  const [selected, setSelected] = useState<EvidenceItem | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const knownItemCount = useRef<number | null>(null);
  const [freshNotice, setFreshNotice] = useState<string | null>(null);

  async function load(keepSelection = true, opts?: { silent?: boolean }) {
    try {
      const res = await api.jobEvidence(jobId);
      const nextCount = res.counts?.items ?? res.items.length;
      if (
        opts?.silent &&
        knownItemCount.current != null &&
        nextCount > knownItemCount.current
      ) {
        const added = nextCount - knownItemCount.current;
        setFreshNotice(added === 1 ? 'New file filed on this job.' : `${added} new files filed on this job.`);
      }
      knownItemCount.current = nextCount;
      setItems(res.items);
      setCounts(res.counts);
      setError(null);
      if (keepSelection) {
        setSelected((current) =>
          current ? res.items.find((i) => i.id === current.id) ?? null : current,
        );
      }
    } catch (err) {
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Could not open the evidence locker.');
        setItems([]);
      }
    }
  }

  useEffect(() => {
    setItems(null);
    setSelected(null);
    setFreshNotice(null);
    knownItemCount.current = null;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useVisiblePolling(() => void load(true, { silent: true }), {
    enabled: Boolean(jobId),
    intervalMs: 12_000,
  });

  const query = filter.trim().toLowerCase();
  const listed = (items ?? []).filter(
    (item) =>
      !query ||
      [item.title, item.company ?? '', item.category ?? '', item.workDate, ...(item.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(query),
  );

  return (
    <section className="rounded-xl glass-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Evidence</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Every file on this job, who filed it, and everyone who has opened it since.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
          <span className="text-ink-600">
            <span className="font-semibold text-ink-900">{counts.items}</span> files
          </span>
          {/* The number worth watching. A file nobody has opened is one the
              other side has never been shown. */}
          {counts.neverViewed > 0 && (
            <span className="text-ink-500">
              <span className="font-semibold">{counts.neverViewed}</span> never opened
            </span>
          )}
        </div>
      </header>

      {freshNotice && (
        <p role="status" className="px-5 py-3 text-sm text-success-700 bg-success-50">
          {freshNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="px-5 py-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="px-5 py-8 text-sm text-ink-600">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-sm text-ink-600">
          Nothing filed yet. Crews upload from their job link — a video before they start and one
          when they finish, each day they are on site.
        </p>
      ) : (
        <>
          <div className="border-b border-line px-5 py-2.5">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by company, date, category or tag"
              className="w-full rounded-lg glass-field px-3 py-1.5 text-xs text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          </div>

          {/* A table, because that is what an evidence list is. Scrollable on a
              narrow screen rather than reflowed into cards — a records view
              that hides columns hides the column somebody came for. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-semibold">File</th>
                  <th className="px-3 py-2 font-semibold">Filed by</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Filmed</th>
                  <th className="px-3 py-2 font-semibold">Length</th>
                  <th className="px-3 py-2 font-semibold">Opened</th>
                  <th className="px-5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((item) => {
                  const failed = (item.checks ?? []).filter((c) => c.verdict === 'fail').length;
                  const on = selected?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelected(on ? null : item)}
                      className={`cursor-pointer border-b border-line/60 transition last:border-b-0 ${
                        on ? 'bg-brand-600/10' : 'hover:bg-paper-200/40'
                      }`}
                    >
                      <td className="px-5 py-2.5">
                        <span className={`font-medium ${on ? 'text-brand-600' : 'text-ink-900'}`}>
                          {item.title}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-ink-600">
                        {item.company ?? '—'}
                        {item.trade && <span className="text-ink-400"> · {item.trade}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            CATEGORY_STYLE[item.category ?? 'other']
                          }`}
                        >
                          {item.category ?? 'other'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink-600">
                        {when(item.capturedAt)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink-600">
                        {length(item.durationSeconds)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {item.viewCount === 0 ? (
                          <span className="text-ink-400">never</span>
                        ) : (
                          <span className="text-ink-700">
                            {item.viewCount}× · {when(item.lastViewedAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {failed > 0 ? (
                          <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-semibold text-danger-600">
                            {failed} failed
                          </span>
                        ) : (
                          <span className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                            {item.state}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <EvidenceDetail
              jobId={jobId}
              item={selected}
              onChanged={() => void load()}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * One file, with its papers.
 *
 * The player and the metadata sit together because neither is worth much alone.
 * Footage with no provenance proves nothing, and a metadata panel with no
 * footage is a spreadsheet row.
 */
function EvidenceDetail({
  jobId,
  item,
  onChanged,
  onClose,
}: {
  jobId: string;
  item: EvidenceItem;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [custody, setCustody] = useState<CustodyEntry[] | null>(null);

  useEffect(() => {
    setUrl(null);
    setCustody(null);
    api
      .evidenceCustody(jobId, item.id)
      .then((res) => setCustody(res.entries))
      .catch(() => setCustody([]));
  }, [jobId, item.id]);

  async function play() {
    setLoadingVideo(true);
    try {
      const res = await api.proofVideoUrl(item.id);
      setUrl(res.url);
      // The view has just been written server-side; pulling the log again is
      // what makes that visible rather than something the user has to trust.
      const fresh = await api.evidenceCustody(jobId, item.id).catch(() => null);
      if (fresh) setCustody(fresh.entries);
      onChanged();
    } finally {
      setLoadingVideo(false);
    }
  }

  const failed = (item.checks ?? []).filter((c) => c.verdict === 'fail');
  const unknown = (item.checks ?? []).filter((c) => c.verdict === 'unknown');

  return (
    <div className="border-t border-line bg-paper-50/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">{item.title}</h3>
        <button onClick={onClose} className="text-xs text-ink-500 hover:text-ink-800">
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          {url ? (
            <video src={url} controls playsInline className="w-full rounded-lg bg-black" />
          ) : (
            <button
              onClick={() => void play()}
              disabled={loadingVideo}
              className="flex h-56 w-full items-center justify-center gap-2 rounded-lg border border-line bg-paper-100 text-xs text-ink-600 hover:text-ink-900 disabled:opacity-60"
            >
              {loadingVideo && <SpinnerIcon className="animate-spin" width={14} height={14} />}
              {loadingVideo ? 'Opening…' : 'Play — this is recorded in the chain of custody'}
            </button>
          )}

          {item.aiSummary && (
            <div className="mt-3 rounded-lg border border-line bg-paper-0/60 p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
                What the footage shows
              </p>
              <p className="mt-1 text-xs text-ink-800">{item.aiSummary}</p>
            </div>
          )}
        </div>

        {/* The papers. Digest first: it is the claim that the file has not been
            altered, and everything else is only worth reading if it holds. */}
        <dl className="space-y-1.5 text-[11px]">
          <Row label="Digest (SHA-256)">
            {item.contentHash ? (
              <code className="break-all text-[10px] text-ink-700">{item.contentHash}</code>
            ) : (
              <span className="text-caution-600">none — cannot prove it is unaltered</span>
            )}
          </Row>
          <Row label="Filmed">{when(item.capturedAt)}</Row>
          <Row label="Received">{when(item.receivedAt)}</Row>
          <Row label="Location">
            {item.hasLocation ? 'on file' : <span className="text-caution-600">none recorded</span>}
          </Row>
          <Row label="Length">{length(item.durationSeconds)}</Row>
          <Row label="Size">{size(item.byteSize)}</Row>
          <Row label="Filed by">{item.company ?? '—'}</Row>
          <Row label="Retention">
            {item.retentionUntil ? (
              new Date(item.retentionUntil).toLocaleDateString()
            ) : (
              <span className="text-ink-400">not set</span>
            )}
          </Row>

          {(failed.length > 0 || unknown.length > 0) && (
            <div className="!mt-3 rounded-lg border border-line p-2">
              {failed.map((c) => (
                <p key={c.key} className="text-[11px] text-danger-600">
                  {c.detail}
                </p>
              ))}
              {unknown.map((c) => (
                <p key={c.key} className="text-[11px] text-caution-600">
                  {c.detail}
                </p>
              ))}
            </div>
          )}

        </dl>
      </div>

      {/* The chain itself. Views included — that is the whole point. */}
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
          Chain of custody
        </p>
        {custody === null ? (
          <p className="mt-2 text-xs text-ink-500">Loading…</p>
        ) : custody.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">Nothing recorded yet.</p>
        ) : (
          <ol className="mt-2 space-y-1.5">
            {custody.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    ACTION_DOT[entry.action] ?? 'bg-ink-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-ink-800">
                    {ACTION_WORD[entry.action] ?? entry.action}
                    <span className="text-ink-500"> by {entry.actor_label}</span>
                  </span>
                  {entry.detail && (
                    <span className="block text-[11px] text-ink-500">{entry.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-400">
                  {when(entry.occurred_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[10.5px] text-ink-400">
          Append-only. Nothing in this list can be edited or removed, including by whoever owns the
          job — a custody record the custodian can change is not a custody record.
        </p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right text-ink-800">{children}</dd>
    </div>
  );
}
