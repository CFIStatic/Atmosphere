import { useEffect, useState, type FormEvent } from 'react';
import { api, type CreateEvidenceShareResult, type EvidenceShare } from '../../lib/api';
import { SpinnerIcon } from '../icons';
import { InviteList } from './InviteList';
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

/** What the homeowner tab says it does. Shown under the popup title. */
export const HOMEOWNER_SHARE_INTRO =
  'Email a job-progress link. They sign in with a link sent to their email: no payment, no Field Capture seat. Not a film invite.';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

export function ShareJobProgressPanel({
  jobId,
  creating: creatingProp,
  onCreatingChange,
  modal = false,
}: {
  jobId: string;
  creating?: boolean;
  onCreatingChange?: (open: boolean) => void;
  /** Inside the Share popup: just the form and invite list, no card. */
  modal?: boolean;
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

  async function revoke(id: string) {
    await api.revokeEvidenceShare(id);
    await load();
  }

  const live = (shares ?? []).filter((s) => s.state === 'live');

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

      <InviteList
        glass={modal}
        heading={modal}
        onRevoke={(id) => void revoke(id)}
        items={
          shares === null
            ? null
            : shares.map((share) => ({
                id: share.id,
                title: share.recipientEmail ?? share.label,
                meta:
                  share.openCount > 0
                    ? `Opened ${share.openCount}×${when(share.lastOpenedAt) ? `, last ${when(share.lastOpenedAt)}` : ''}`
                    : 'Not opened yet',
                state: share.state,
              }))
        }
      />

      {live.length > 0 && !creating && (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {live.length} invite{live.length === 1 ? '' : 's'} out right now.
        </p>
      )}
    </>
  );

  if (modal) return body;

  return (
    <section id="share-job-progress" className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Share with homeowner</h2>
          <p className="mt-0.5 text-xs text-ink-500">{HOMEOWNER_SHARE_INTRO}</p>
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
