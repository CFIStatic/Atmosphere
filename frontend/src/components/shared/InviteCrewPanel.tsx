import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type JobParty } from '../../lib/api';
import { SpinnerIcon } from '../icons';
import {
  planRequiredMessage,
  UpgradePrompt,
  useProductActionsLocked,
} from '../billing/ProductActionLock';
import { InviteList } from './InviteList';

/**
 * Invite a trade or crew to film the job. A name and an email; Atmosphere
 * emails them a Field Capture link. No trade or role picker: everyone invited
 * here joins as a subcontractor, and homeowners use the Homeowner tab.
 */

/** What the crew tab says it does. Shown under the popup title. */
export const CREW_INVITE_INTRO = 'Email a Field Capture link so a trade or crew can film this job.';

type Made =
  { emailed: true; email: string } | { emailed: false; email: string; link: string | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

function partyMeta(party: JobParty): string {
  const parts = [party.email];
  if (party.last_seen_at) parts.push(`Opened ${when(party.last_seen_at)}`);
  else parts.push('Not opened yet');
  return parts.filter(Boolean).join(' · ');
}

function absolute(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${window.location.origin}${path}`;
}

export function InviteCrewPanel({ jobId }: { jobId: string }) {
  const actionsLocked = useProductActionsLocked();
  const [parties, setParties] = useState<JobParty[] | null>(null);
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.sharedJob(jobId).then(
        (record) =>
          setParties(
            (record.parties ?? []).filter((p) => p.role !== 'owner' && p.role !== 'adjuster'),
          ),
        (err: unknown) => {
          setError(err instanceof Error ? err.message : 'Could not load invites.');
          setParties([]);
        },
      ),
    [jobId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (actionsLocked) {
      setError(planRequiredMessage());
      return;
    }
    const name = company.trim();
    const to = email.trim().toLowerCase();
    if (!name || !to) {
      setError('Enter a name and an email to send the invite.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.addJobParty(jobId, {
        company: name,
        email: to,
        role: 'subcontractor',
      });
      setMade(
        res.emailed
          ? { emailed: true, email: to }
          : { emailed: false, email: to, link: absolute(res.fieldCapturePath ?? res.sharePath) },
      );
      setCompany('');
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await api.revokeJobParty(jobId, id);
    await load();
  }

  const field =
    'mt-1.5 h-10 w-full rounded-lg glass-field px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500/25';

  return (
    <>
      {actionsLocked ? (
        <div className="mb-4">
          <UpgradePrompt />
        </div>
      ) : null}

      {error && (
        <p role="alert" className="mb-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      <form onSubmit={invite} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Company or name</span>
          <input
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Delgado Roofing"
            autoComplete="organization"
            maxLength={160}
            className={field}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Crew email</span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="crew@example.com"
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !company.trim() || !email.trim()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-sm transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          Send crew invite
        </button>
      </form>

      {made && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            made.emailed ? 'bg-success-50 text-success-600' : 'bg-caution-50 text-caution-600'
          }`}
        >
          {made.emailed ? (
            `Invite sent to ${made.email}. The link opens on the web and in Field Capture.`
          ) : (
            <>
              <p>
                Added to the job, but the email to {made.email} did not send. Copy the link to send
                it yourself.
              </p>
              {made.link ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-paper-0/40 px-2 py-1 text-[11px] text-ink-700">
                    {made.link}
                  </code>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(made.link ?? '')}
                    className="shrink-0 rounded-md px-2 py-1 font-medium text-ink-700 transition hover:bg-ink-900/10"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      <InviteList
        onRevoke={(id) => void revoke(id)}
        emptyText="No crews invited yet."
        items={
          parties === null
            ? null
            : parties.map((party) => ({
                id: party.id,
                title: party.company,
                meta: partyMeta(party),
                state: party.revoked_at ? 'revoked' : 'live',
              }))
        }
      />
    </>
  );
}
