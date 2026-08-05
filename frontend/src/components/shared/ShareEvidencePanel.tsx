import { useEffect, useState, type FormEvent } from 'react';
import { api, type CreateEvidenceShareResult, type EvidenceShare } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Handing the record to somebody outside.
 *
 * The form asks for two things about a person, because a share is issued to a
 * person: who they are (the label that will appear in the chain of custody)
 * and the email their Atmosphere account answers to. The link opens for that
 * account and no other — which the panel says before the button is pressed,
 * because the alternative is the sharer finding out from the adjuster's
 * annoyed phone call.
 *
 * After creating, the panel reports the two facts the sharer is actually
 * standing there wondering: did the email go out (their mailbox, so no is a
 * real possibility and gets the copy-the-link fallback shown immediately, not
 * hunted for), and does the recipient already have an account or are they
 * about to be walked through making one.
 *
 * The list underneath is the outstanding-links audit: who holds a live way
 * into this job's evidence, have they used it, and the revoke that ends it.
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

export function ShareEvidencePanel({ jobId }: { jobId: string }) {
  const [shares, setShares] = useState<EvidenceShare[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CreateEvidenceShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.evidenceShares(jobId);
      setShares(res.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the outstanding links.');
      setShares([]);
    }
  }

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
      const res = await api.createEvidenceShare({
        jobId,
        label,
        recipientEmail: email,
        expiresInDays: days,
      });
      setMade(res);
      setLabel('');
      setEmail('');
      setCreating(false);
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

  async function copy(share: { path: string; label: string }) {
    const full = `${window.location.origin}${share.path}`;
    await navigator.clipboard?.writeText(full).catch(() => {
      window.prompt(`Link for ${share.label}`, full);
    });
  }

  const live = (shares ?? []).filter((s) => s.state === 'live');

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Share with a reviewer</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            An adjuster, examiner or attorney gets this job's evidence in the Verifier — viewing
            free, every view on the record under their name.
          </p>
        </div>
        <button
          onClick={() => {
            setCreating((v) => !v);
            setMade(null);
          }}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          {creating ? 'Cancel' : 'Share this job'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {creating && (
        <form onSubmit={create} className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Who — e.g. R. Calloway — Alliance Mutual"
              className="min-w-[14rem] flex-1 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Their email"
              className="min-w-[12rem] flex-1 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            >
              <option value={7}>Expires in 7 days</option>
              <option value={30}>Expires in 30 days</option>
              <option value={90}>Expires in 90 days</option>
              <option value={0}>No expiry — until revoked</option>
            </select>
          </div>
          {/* The pin, stated before the button: it changes what "share" means. */}
          <p className="text-[11px] text-ink-500">
            The link is emailed to them and opens only for an Atmosphere account signed in with
            that address — forwarded, it refuses. Watching is free; keeping a copy settles your
            download fee first.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            Email them the link
          </button>
        </form>
      )}

      {made && (
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs font-semibold text-brand-700">
            {made.emailed
              ? `Emailed. ${
                  made.recipientHasAccount
                    ? 'They already have an Atmosphere account — the link opens as soon as they sign in.'
                    : 'No Atmosphere account under that address yet — the email walks them through creating one with it.'
                }`
              : 'Share created, but the email did not go out — no mailbox is connected, or it refused. Send the link yourself:'}
          </p>
          {!made.emailed && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="break-all text-[11px] text-ink-700">{made.share.path}</code>
              <button
                onClick={() => void copy({ path: made.share.path, label: made.share.label })}
                className="rounded-full glass-card px-2 py-0.5 text-[10.5px] font-medium text-ink-600 hover:text-ink-900"
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      )}

      {shares === null ? (
        <p className="mt-3 text-xs text-ink-500">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          Nobody outside has a link to this job's evidence.
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
                  {share.recipientEmail ?? 'any account'}
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
                  <>
                    <button
                      onClick={() => void copy(share)}
                      className="rounded-full glass-card px-2 py-0.5 text-[10.5px] font-medium text-ink-600 hover:text-ink-900"
                    >
                      Copy link
                    </button>
                    <button
                      onClick={() => void revoke(share)}
                      className="rounded-full glass-card px-2 py-0.5 text-[10.5px] font-medium text-danger-600 hover:text-danger-700"
                    >
                      Revoke
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {live.length > 0 && (
        <p className="mt-2 text-[10.5px] text-ink-400">
          {live.length} live link{live.length === 1 ? '' : 's'}. Revoking is immediate and goes in
          the chain of custody, like the share did.
        </p>
      )}
    </section>
  );
}
