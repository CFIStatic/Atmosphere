import { useState, type FormEvent } from 'react';
import { api, ApiError, ROLE_LABELS, type MemberRole, type OrgInvite } from '../../lib/api';
import { SetupStepCard } from './SetupWizardShell';
import { CheckIcon, SpinnerIcon } from '../icons';

const ROLES: MemberRole[] = [
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
  'sales',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SetupInviteStep({
  orgName,
  onComplete,
  locked = false,
}: {
  orgName?: string | null;
  onComplete: () => void;
  locked?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('field_technician');
  const [sent, setSent] = useState<OrgInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    if (!emailValid || busy || locked) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.createOrgInvite({ email: email.trim(), role });
      setSent((prev) => [res.invite, ...prev.filter((row) => row.id !== res.invite.id)]);
      setNotice(
        res.emailed
          ? `Invite sent to ${res.invite.email}.`
          : `Invite recorded for ${res.invite.email}, but email could not be sent. Try again from Settings.`,
      );
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetupStepCard
      step={4}
      title="Invite teammates"
      subtitle={
        orgName
          ? `Email people on ${orgName}. They get a link to create an account and join.`
          : 'Email teammates a link to create an account and join this workspace.'
      }
    >
      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-6 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-600"
        >
          <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={(event) => void sendInvite(event)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium text-ink-700">
            Work email
          </label>
          <input
            id="invite-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1.5 block text-sm font-medium text-ink-700">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          >
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!emailValid || busy || locked}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-3 font-semibold text-ink-800 transition hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[180px]"
        >
          {busy && <SpinnerIcon className="animate-spin" width={18} height={18} />}
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      {sent.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {sent.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-800">{invite.email}</span>
                <span className="block text-xs text-ink-500">{ROLE_LABELS[invite.role]}</span>
              </span>
              <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10.5px] font-semibold text-success-600">
                invited
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-500">You can invite more people later from Settings.</span>
        <button
          type="button"
          onClick={onComplete}
          className="flex min-w-[200px] items-center justify-center rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          {sent.length > 0 ? 'Enter Atmosphere' : 'Skip for now'}
        </button>
      </div>
    </SetupStepCard>
  );
}
