import { useEffect, useState, type FormEvent } from 'react';
import { api, type CreateEvidenceShareResult, type EvidenceShare } from '../../lib/api';
import { ChevronRightIcon, SpinnerIcon } from '../icons';
import { GlassModal } from './GlassModal';
import {
  planRequiredMessage,
  UpgradePrompt,
  useProductActionsLocked,
} from '../billing/ProductActionLock';

/**
 * Invite someone to the job file by email.
 *
 * One field: their address. Atmosphere emails the link. They see the job file
 * and every recording — no account, no copy-paste, no expiry picker.
 */

const STATE_STYLE: Record<EvidenceShare['state'], string> = {
  live: 'bg-success-50 text-success-600',
  expired: 'bg-paper-200/60 text-ink-500',
  revoked: 'bg-danger-50 text-danger-600',
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

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
  const actionsLocked = useProductActionsLocked();
  const [shares, setShares] = useState<EvidenceShare[] | null>(null);
  const [creatingInternal, setCreatingInternal] = useState(false);
  const creating = creatingProp ?? creatingInternal;

  function setCreating(open: boolean) {
    if (onCreatingChange) onCreatingChange(open);
    else setCreatingInternal(open);
  }
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CreateEvidenceShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  async function load() {
    try {
      const res = await api.evidenceShares(jobId, 'progress');
      setShares(res.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invites.');
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
    if (actionsLocked) {
      setError(planRequiredMessage());
      return;
    }
    const to = email.trim().toLowerCase();
    if (!to) {
      setError('Enter an email to send the invite.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProgressShare({
        jobId,
        label: to,
        recipientEmail: to,
      });
      setMade(res);
      setEmail('');
      if (!modal) setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: EvidenceShare) {
    await api.revokeEvidenceShare(share.id);
    await load();
  }

  const live = (shares ?? []).filter((s) => s.state === 'live');
  const past = (shares ?? []).filter((s) => s.state !== 'live');
  const pastLabel = past.every((s) => s.state === 'revoked') ? 'Revoked' : 'Past invites';

  const intro = (
    <>
      Email a job-progress link. They can create a quick email + password login — no payment, no
      Field Capture seat. Not a film invite.
    </>
  );

  const row = (share: EvidenceShare) => (
    <li
      key={share.id}
      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ${
        modal ? 'glass-row' : 'border border-line'
      }`}
    >
      <div className="min-w-0">
        <p
          className={`truncate text-sm font-medium ${share.state === 'live' ? 'text-ink-900' : 'text-ink-600'}`}
        >
          {share.recipientEmail ?? share.label}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {share.openCount > 0
            ? `Opened ${share.openCount}×${when(share.lastOpenedAt) ? `, last ${when(share.lastOpenedAt)}` : ''}`
            : 'Not opened yet'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATE_STYLE[share.state]}`}
        >
          {share.state === 'live' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-success-600" aria-hidden />
          ) : null}
          {share.state}
        </span>
        {share.state === 'live' && (
          <button
            type="button"
            onClick={() => void revoke(share)}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-500 transition hover:bg-danger-50 hover:text-danger-600"
          >
            Revoke
          </button>
        )}
      </div>
    </li>
  );

  const body = (
    <>
      {actionsLocked ? (
        <div className={modal ? 'mb-4' : 'mt-3'}>
          <UpgradePrompt />
        </div>
      ) : null}

      {error && (
        <p role="alert" className={`text-xs text-danger-600 ${modal ? 'mb-3' : 'mt-3'}`}>
          {error}
        </p>
      )}

      {creating && (
        <form onSubmit={create} className={`space-y-3 ${modal ? '' : 'mt-4'}`}>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Homeowner email</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="homeowner@example.com"
              className="mt-1.5 h-10 w-full rounded-lg glass-field px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500/25"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-sm transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            Send homeowner invite
          </button>
        </form>
      )}

      {made && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            made.emailed ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'
          }`}
        >
          {made.emailed
            ? `Invite sent to ${made.share.label}.`
            : `Invite created for ${made.share.label}, but the email did not send. Try again.`}
        </p>
      )}

      {shares === null ? (
        <p className="mt-4 text-xs text-ink-500">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="mt-4 text-xs text-ink-500">Nobody has been invited yet.</p>
      ) : (
        <div className={modal ? 'mt-6' : 'mt-3'}>
          {modal ? (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Invites
            </p>
          ) : null}
          {live.length > 0 ? (
            <ul className="space-y-2">{live.map(row)}</ul>
          ) : (
            <p className="text-xs text-ink-500">No live invites.</p>
          )}
          {past.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowPast(!showPast)}
                aria-expanded={showPast}
                className="inline-flex items-center gap-1 rounded-md py-1 text-xs font-medium text-ink-500 transition hover:text-ink-800"
              >
                <ChevronRightIcon
                  width={14}
                  height={14}
                  className={`transition-transform ${showPast ? 'rotate-90' : ''}`}
                  aria-hidden
                />
                {pastLabel} ({past.length})
              </button>
              {showPast ? <ul className="mt-2 space-y-2">{past.map(row)}</ul> : null}
            </div>
          ) : null}
        </div>
      )}

      {live.length > 0 && !creating && (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {live.length} invite{live.length === 1 ? '' : 's'} out right now.
        </p>
      )}
    </>
  );

  if (modal) {
    return (
      <GlassModal title="Share with homeowner" description={intro} onClose={() => onClose?.()}>
        {body}
      </GlassModal>
    );
  }

  return (
    <section id="share-job-progress" className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Share with homeowner</h2>
          <p className="mt-0.5 text-xs text-ink-500">{intro}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(!creating);
            setMade(null);
          }}
          className="text-xs font-medium text-ink-600 hover:text-ink-900"
        >
          {creating ? 'Cancel' : 'Invite'}
        </button>
      </div>
      {body}
    </section>
  );
}
