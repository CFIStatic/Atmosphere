import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type JobLegalHoldKind,
  type JobLegalHoldPortal as Portal,
} from '../../lib/api';
import { SpinnerIcon } from '../icons';

const KINDS: JobLegalHoldKind[] = ['subpoena', 'lawsuit', 'preservation', 'investigation', 'other'];

const KIND_WORD: Record<JobLegalHoldKind, string> = {
  subpoena: 'Subpoena',
  lawsuit: 'Lawsuit',
  preservation: 'Preservation',
  investigation: 'Investigation',
  other: 'Other',
};

/**
 * Legal hold for one job file.
 *
 * A clip hold lives on a single video. This portal freezes the job: every
 * clip on it, and every clip that arrives while the hold is open. Customer
 * delete still hides a file from the locker; the vault keeps it for counsel.
 */
export function JobLegalHoldPortal({ jobId, jobTitle }: { jobId: string; jobTitle?: string | null }) {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<JobLegalHoldKind>('preservation');
  const [caseNumber, setCaseNumber] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    try {
      setPortal(await api.jobLegalHold(jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the legal hold portal.');
    }
  }

  useEffect(() => {
    setPortal(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function openHold(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.openJobLegalHold(jobId, {
        kind,
        reason,
        caseNumber: caseNumber.trim() || undefined,
        title: jobTitle ?? undefined,
      });
      setReason('');
      setCaseNumber('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place the job on hold.');
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    const why = window.prompt('Why is this hold being released?');
    if (!why?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.releaseJobLegalHold(jobId, why.trim());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not release the hold.');
    } finally {
      setBusy(false);
    }
  }

  const onHold = Boolean(portal?.counts.jobOnHold);
  const hold = portal?.hold;

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Legal hold</h2>
        {portal && (
          <p className="text-xs text-ink-500">
            {portal.counts.onHold} of {portal.counts.clips} clips frozen
            {onHold ? ' · job on hold' : ''}
          </p>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Freeze this job file for a subpoena, a lawsuit, or a preservation letter. A clip
        deleted after the hold still exists for counsel.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {!portal ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
          <SpinnerIcon className="animate-spin" width={14} height={14} />
          Opening the portal…
        </p>
      ) : onHold && hold ? (
        <div className="mt-4 rounded-lg border border-caution-200 bg-caution-50/70 px-4 py-3">
          <p className="text-sm font-semibold text-caution-700">
            {KIND_WORD[hold.kind]} hold is open
          </p>
          <p className="mt-1 text-sm text-ink-800">{hold.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{hold.caseNumber}</p>
          <button
            type="button"
            onClick={() => void releaseHold()}
            disabled={busy}
            className="mt-3 rounded-lg border border-line-strong bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:text-ink-900 disabled:opacity-50"
          >
            {busy ? 'Releasing…' : 'Release the hold'}
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void openHold(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-ink-700">
            Kind
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as JobLegalHoldKind)}
              className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
            >
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {KIND_WORD[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            Case number <span className="font-normal text-ink-400">(optional)</span>
            <input
              value={caseNumber}
              onChange={(event) => setCaseNumber(event.target.value)}
              placeholder="SDNY-2026-0412"
              className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
            />
          </label>
          <label className="text-xs font-medium text-ink-700 sm:col-span-2">
            Why it is on hold
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Subpoena duces tecum — produce all field video for this job."
              className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy || !reason.trim()}
              className="rounded-lg border border-caution-200 bg-caution-50 px-4 py-2 text-sm font-semibold text-caution-700 hover:bg-caution-100 disabled:opacity-50"
            >
              {busy ? 'Placing hold…' : 'Place this job on legal hold'}
            </button>
          </div>
        </form>
      )}

    </section>
  );
}
