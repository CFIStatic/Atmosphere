import { useState, type FormEvent } from 'react';
import { api, ApiError, type OrgInvite } from '../../lib/api';
import { SetupStepCard } from './SetupWizardShell';
import { SpinnerIcon } from '../icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SetupInviteStep({ onComplete }: { onComplete: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<OrgInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    if (!emailValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createOrgInvite({ email: email.trim() });
      setSent((prev) => [res.invite, ...prev.filter((row) => row.id !== res.invite.id)]);
      if (!res.emailed) {
        setError(`Could not email ${res.invite.email}. Try again from Settings.`);
      }
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetupStepCard title="Invite your team" subtitle="Optional — you can do this later.">
      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={(event) => void sendInvite(event)} className="mt-6 flex gap-2">
        <label htmlFor="invite-email" className="sr-only">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={!emailValid || busy}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2.5 font-semibold text-ink-800 transition hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          Send
        </button>
      </form>

      {sent.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {sent.map((invite) => (
            <li key={invite.id} className="text-sm text-ink-700">
              {invite.email}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onComplete}
          className="flex min-w-[160px] items-center justify-center rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          Continue
        </button>
      </div>
    </SetupStepCard>
  );
}
