import { useEffect, useState, type FormEvent } from 'react';
import { api, type CreateEvidenceShareResult, type EvidenceShare } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Share the job progress dashboard with third parties — homeowners, attorneys,
 * banks, insurance adjusters — via a read-only link that opens without login.
 */

const STATE_STYLE: Record<EvidenceShare['state'], string> = {
  live: 'bg-success-50 text-success-600',
  expired: 'bg-paper-200/60 text-ink-500',
  revoked: 'bg-danger-50 text-danger-600',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

export function ShareJobProgressPanel({
  jobId,
  creating: creatingProp,
  onCreatingChange,
  modal = false,
  onClose,
}: {
  jobId: string;
  creating?: boolean;
  onCreatingChange?: (open: boolean) => void;
  modal?: boolean;
  onClose?: () => void;
}) {
  const [shares, setShares] = useState<EvidenceShare[] | null>(null);
  const [creatingInternal, setCreatingInternal] = useState(false);
  const creating = creatingProp ?? creatingInternal;

  function setCreating(open: boolean) {
    if (onCreatingChange) onCreatingChange(open);
    else setCreatingInternal(open);
  }
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CreateEvidenceShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.evidenceShares(jobId, 'progress');
      setShares(res.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the outstanding links.');
      setShares([]);
    }
  }

  useEffect(() => {
    if (modal) setCreating(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, jobId]);

  useEffect(() => {
    setShares(null);
    setMade(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProgressShare({
        jobId,
        label,
        recipientEmail: email.trim() || undefined,
        expiresInDays: days,
      });
      setMade(res);
      setLabel('');
      setEmail('');
      if (!modal) setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the share.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: EvidenceShare) {
    if (!window.confirm(`Revoke ${share.label}'s link? It stops opening immediately.`)) return;
    await api.revokeEvidenceShare(share.id);
    await load();
  }

  const live = (shares ?? []).filter((s) => s.state === 'live');

  const panel = (
    <section
      id={modal ? undefined : 'share-job-progress'}
      className={`rounded-xl glass-card p-5 ${modal ? 'shadow-xl' : ''}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="share-job-title" className="text-base font-semibold text-ink-900">
            Share this job
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Send a read-only link — no account needed. Homeowners, attorneys, banks and insurers
            can see progress and daily site updates.
          </p>
        </div>
        {modal ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            Close
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(!creating);
              setMade(null);
            }}
            className="text-xs font-medium text-ink-600 hover:text-ink-900"
          >
            {creating ? 'Cancel' : 'Share'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {creating && (
        <form onSubmit={create} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Who is this for?</span>
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Cedar Ridge HOA — homeowner"
              className="mt-1 w-full rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Email them (optional)</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="We'll email them the link"
              className="mt-1 w-full rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Link expires</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 w-full rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            >
              <option value={7}>In 7 days</option>
              <option value={30}>In 30 days</option>
              <option value={90}>In 90 days</option>
              <option value={0}>Never — until you revoke it</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-paper-0 transition hover:bg-ink-800 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            {email.trim() ? 'Email the link' : 'Create share'}
          </button>
        </form>
      )}

      {made && (
        <p className="mt-3 rounded-lg border border-line px-3 py-2 text-xs text-ink-700">
          {made.emailed
            ? 'Emailed. They can open the link directly — no account needed.'
            : 'Share created. It is listed below.'}
        </p>
      )}

      {shares === null ? (
        <p className="mt-3 text-xs text-ink-500">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          Nobody outside has a progress link for this job yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shares.map((share) => (
            <li
              key={share.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800">{share.label}</p>
                <p className="text-[11px] text-ink-500">
                  {share.recipientEmail ?? 'link only'}
                  {share.openCount > 0
                    ? ` · opened ${share.openCount}×${when(share.lastOpenedAt) ? `, last ${when(share.lastOpenedAt)}` : ''}`
                    : ' · never opened'}
                  {share.state === 'live' &&
                    (share.expiresAt ? ` · expires ${when(share.expiresAt)}` : ' · no expiry')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATE_STYLE[share.state]}`}
                >
                  {share.state}
                </span>
                {share.state === 'live' && (
                  <button
                    onClick={() => void revoke(share)}
                    className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-medium text-danger-600 hover:text-danger-700"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {live.length > 0 && !creating && (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {live.length} active link{live.length === 1 ? '' : 's'} out right now.
        </p>
      )}
    </section>
  );

  if (modal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/50 p-4 pt-[10vh] backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-job-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div className="w-full max-w-md">{panel}</div>
      </div>
    );
  }

  return panel;
}
