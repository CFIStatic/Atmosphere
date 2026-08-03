import { useEffect, useState, type FormEvent } from 'react';
import { api, humanize, type MemberRole, type OrgInvite } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { SpinnerIcon } from '../icons';

/**
 * Adding somebody to the team.
 *
 * Joining has always worked by code, and that stays — it works on a job site.
 * What this adds is the record around it: who was asked, whether they have
 * turned up, and a way to withdraw an ask that went to the wrong address.
 *
 * The email is best-effort and the panel is built to make that unremarkable.
 * On day one nobody has connected a mailbox, so "we could not email it" is the
 * common case, not an error — the code appears right there for sending over
 * text, which is how job-site invitations actually travel anyway.
 */

const ROLES: MemberRole[] = [
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
  'sales',
];

const STATUS_STYLE: Record<OrgInvite['status'], string> = {
  pending: 'bg-caution-50 text-caution-600',
  joined: 'bg-success-50 text-success-600',
  revoked: 'bg-paper-200/60 text-ink-500',
};

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
};

export function InvitePanel() {
  const { membership } = useAuth();
  const joinCode = membership?.org?.joinCode ?? null;

  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('field_technician');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.orgInvites();
      setInvites(res.invites);
    } catch {
      // The form still works without the history; an empty list would read as
      // "nobody was ever invited", which may be false, so stay null and quiet.
      setInvites((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await api.createOrgInvite({ email, role });
      setOutcome(
        res.emailed
          ? `Invited — the code went to ${email}.`
          : `Invited. No mailbox is connected, so send them the code yourself — it is below.`,
      );
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeOrgInvite(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw that.');
    }
  }

  async function copyCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Join code', joinCode);
    }
  }

  const pending = (invites ?? []).filter((i) => i.status === 'pending');

  return (
    <section className="mb-6 rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Add a team member</h2>
        {joinCode && (
          <button
            onClick={() => void copyCode()}
            className="rounded-full glass-card px-3 py-1 text-xs font-medium text-ink-600 hover:text-ink-900"
          >
            {copied ? 'Copied' : `Join code: ${joinCode}`}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        They sign up with their email and enter the code. The invitation keeps the record of who
        was asked — and shows you who has not turned up.
      </p>

      <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email.com"
          className="min-w-[14rem] flex-1 rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
          className="rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {humanize(r)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          Invite
        </button>
      </form>
      {/* The role is a suggestion, and saying so heads off the argument when
          the joiner picks differently at onboarding. */}
      <p className="mt-1.5 text-[11px] text-ink-400">
        The role is what you have in mind — they confirm their own when they join.
      </p>

      {outcome && <p className="mt-2 text-xs text-success-600">{outcome}</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-600">
          {error}
        </p>
      )}

      {invites !== null && invites.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {invites.slice(0, 12).map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-ink-800">{inv.email}</span>
                <span className="block text-[11px] text-ink-500">
                  {humanize(inv.role)} · asked {ago(inv.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[inv.status]}`}
                >
                  {inv.status}
                </span>
                {inv.status === 'pending' && (
                  <button
                    onClick={() => void revoke(inv.id)}
                    className="text-[11px] text-ink-500 hover:text-danger-600"
                  >
                    withdraw
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-400">
          Withdrawing an invitation is bookkeeping — the join code itself keeps working for
          everyone else.
        </p>
      )}
    </section>
  );
}
