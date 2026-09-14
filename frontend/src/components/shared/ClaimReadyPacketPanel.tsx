import { useCallback, useEffect, useState } from 'react';
import { api, type ClaimReadyPacket } from '../../lib/api';
import { downloadJson, eventClock } from '../../lib/downloadJson';

/**
 * Platform section: carrier-ish claim packet from evidenced job fields.
 * JSON API export alongside reports — not a proof-pack PDF.
 */

function GapList({ gaps }: { gaps: string[] }) {
  if (!gaps.length) {
    return (
      <p className="text-xs text-ink-600">
        Core carrier fields have supporting evidence on this file.
      </p>
    );
  }
  return (
    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-600">
      {gaps.map((gap) => (
        <li key={gap}>{gap}</li>
      ))}
    </ul>
  );
}

export function ClaimReadyPacketPanel({ jobId }: { jobId: string }) {
  const [packet, setPacket] = useState<ClaimReadyPacket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.jobClaimReadyPacket(jobId);
      setPacket(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build claim-ready packet.');
      setPacket(null);
    } finally {
      setBusy(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportJson() {
    if (!packet) return;
    const slug = packet.job.claimNumber || packet.job.number || packet.job.id;
    downloadJson(`claim-ready-${slug}.json`, packet);
  }

  return (
    <section className="rounded-xl glass-card p-5" data-testid="claim-ready-packet">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Claim-ready packet</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Carrier-ish fields from filed evidence only — dates on site, parties, damage,
            cause when evidenced, frames, and who said what with times. Never invented.
            Privacy redactions respected. Separate from proof-pack PDF.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
          >
            {busy ? 'Building…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={!packet || busy}
            className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
            data-testid="claim-ready-export"
          >
            Export JSON
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {packet && (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] text-ink-500">{packet.disclaimer}</p>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Claim / job
              </dt>
              <dd className="mt-1 text-sm text-ink-800">
                {packet.job.claimNumber ? `Claim ${packet.job.claimNumber}` : 'Claim # not on file'}
                {packet.job.name ? ` · ${packet.job.name}` : ''}
                {packet.job.siteAddress ? (
                  <span className="mt-0.5 block text-xs text-ink-600">{packet.job.siteAddress}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Dates on site
              </dt>
              <dd className="mt-1 text-sm text-ink-800">
                {packet.datesOnSite.length ? packet.datesOnSite.join(', ') : 'None evidenced'}
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Parties
            </h3>
            {packet.parties.length ? (
              <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
                {packet.parties.map((p) => (
                  <li key={p.id} className="px-3 py-2 text-sm text-ink-800">
                    {p.company || 'Company'}
                    {p.contactName ? ` · ${p.contactName}` : ''}
                    {p.trade ? (
                      <span className="ml-1.5 text-xs text-ink-500">{p.trade}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink-600">No parties on file.</p>
            )}
          </div>

          <div>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Damage / observations
            </h3>
            {packet.damageObservations.length ? (
              <ul className="mt-1.5 space-y-1.5">
                {packet.damageObservations.slice(0, 12).map((o, i) => (
                  <li
                    key={`${o.kind}-${i}-${o.text.slice(0, 24)}`}
                    className="rounded-lg border border-line/80 bg-surface-50/40 px-3 py-2 text-sm text-ink-800"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                      {o.kind}
                    </span>
                    <p className="mt-0.5">{o.text}</p>
                    {(o.workDate || o.atSeconds != null) && (
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        {o.workDate ?? ''}
                        {o.atSeconds != null ? ` · ${eventClock(o.atSeconds)}` : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink-600">None evidenced yet.</p>
            )}
          </div>

          <div>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Cause (if evidenced)
            </h3>
            {packet.cause ? (
              <p className="mt-1.5 rounded-lg border border-line/80 px-3 py-2 text-sm text-ink-800">
                {packet.cause.text}
                {packet.cause.quote ? (
                  <span className="mt-1 block text-xs italic text-ink-600">
                    “{packet.cause.quote}”
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-600">Not evidenced — left blank on purpose.</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Frames
              </h3>
              <p className="mt-1 text-sm text-ink-800">{packet.photosFrames.length}</p>
            </div>
            <div>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Statements
              </h3>
              <p className="mt-1 text-sm text-ink-800">{packet.statements.length}</p>
            </div>
            <div>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Privacy
              </h3>
              <p className="mt-1 text-sm text-ink-800">
                {packet.privacy.redactionsApplied
                  ? `${packet.privacy.rangeCount} range(s) applied`
                  : 'None on file'}
              </p>
            </div>
          </div>

          {packet.statements.length > 0 && (
            <div>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Who said what
              </h3>
              <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto text-xs text-ink-700">
                {packet.statements.slice(0, 40).map((s, i) => (
                  <li key={`${s.proofId}-${s.atSeconds}-${i}`}>
                    <span className="font-medium text-ink-500">
                      {s.atSeconds != null ? eventClock(s.atSeconds) : '—'}
                    </span>
                    {s.speakerLabel ? (
                      <span className="ml-1.5 font-medium">{s.speakerLabel}:</span>
                    ) : null}{' '}
                    {s.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Gaps
            </h3>
            <GapList gaps={packet.gaps} />
          </div>
        </div>
      )}
    </section>
  );
}
