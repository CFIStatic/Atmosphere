import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { signupHref } from '../../lib/authRedirect';
import { SpinnerIcon } from '../icons';

/**
 * "Keep this job."
 *
 * The general contractor requires their subs to use this, so a drywall crew
 * ends up holding invitations from several GCs across several jobs — every
 * one a link in a text message, and no way to find the right one while
 * standing in front of a house at 7am.
 *
 * The panel is deliberately at the BOTTOM of the sub's job page and
 * deliberately skippable. The token already works; a sub can read the scope,
 * film, and sign off having never seen this. That is not an oversight, it is
 * the reason the GC's rollout succeeds — a signup wall in front of the scope
 * is how a subcontractor decides this software is the GC's problem, not
 * theirs. What claiming buys is the list. When the invite arrived by email,
 * we still offer a free Atmosphere account for people who do not have one yet.
 */
export function ClaimInvitationPanel({
  token,
  company,
  onClaimed,
  initialContact = '',
  returnTo,
}: {
  token: string;
  company: string;
  onClaimed: (session: string) => void;
  /** Prefill from the invite email query string. */
  initialContact?: string;
  /** After creating an account, come back to this job — not the office list. */
  returnTo?: string;
}) {
  const seeded = initialContact.trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(seeded);
  const [stage, setStage] = useState<'offer' | 'contact' | 'code'>(
    seeded ? 'contact' : 'offer',
  );
  const [contact, setContact] = useState(seeded);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signupLink = signupHref({
    email: looksLikeEmail ? seeded.toLowerCase() : undefined,
    next: returnTo,
  });

  async function sendCode() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.fieldClaimStart({ token, contact });
      setSentTo(res.sentTo);
      // Said out loud rather than swallowed: a sub staring at a code field
      // deserves to know when the code is never coming.
      if (!res.delivered) setNote(res.deliveryNote);
      setStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.fieldClaimVerify({ token, contact, code });
      onClaimed(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5" data-claim-stage={stage}>
      <h2 className="text-base font-semibold text-ink-900">Keep your jobs in one place</h2>

      {stage === 'offer' && (
        <>
          <p className="mt-1 text-xs text-ink-600">
            You do not need an account to work this job — this link already works, and always
            will. But if you work for more than one general contractor, one code puts every job
            they have invited {company} to on a single screen, instead of scrolling back through
            text messages looking for the right link.
          </p>
          <button
            onClick={() => setStage('contact')}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900"
          >
            Put my jobs in one place
          </button>
          <p className="mt-3 text-xs text-ink-500">
            No Atmosphere account yet?{' '}
            <Link to={signupLink} className="font-medium text-brand-600 hover:text-brand-500">
              Create a free one
            </Link>
            , then come back to this link.
          </p>
        </>
      )}

      {stage === 'contact' && (
        <>
          <p className="mt-1 text-xs text-ink-600">
            Your phone number or email. We send a code to prove it is you — nothing else, and
            never to your general contractors.
          </p>
          {looksLikeEmail && (
            <p className="mt-2 text-xs text-ink-500">
              Invited as {seeded}. No account yet?{' '}
              <Link to={signupLink} className="font-medium text-brand-600 hover:text-brand-500">
                Create a free Atmosphere account
              </Link>{' '}
              with this address, then confirm below.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="(512) 555-0134 or you@example.com"
              aria-label="Your phone number or email"
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper-50 px-3 py-1.5 text-sm text-ink-800"
            />
            <button
              onClick={() => void sendCode()}
              disabled={busy || contact.trim().length < 3}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="animate-spin" width={12} height={12} />}
              Send me a code
            </button>
          </div>
        </>
      )}

      {stage === 'code' && (
        <>
          <p className="mt-1 text-xs text-ink-600">
            We sent a code to {sentTo}. It is good for ten minutes.
          </p>
          {note && (
            <p className="mt-2 rounded-lg border border-caution-200 bg-caution-50/60 px-3 py-2 text-xs text-caution-600">
              {note}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="The six-digit code"
              className="w-32 rounded-lg border border-line bg-paper-50 px-3 py-1.5 text-center font-mono text-sm tracking-[0.3em] text-ink-800"
            />
            <button
              onClick={() => void verify()}
              disabled={busy || code.length < 6}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="animate-spin" width={12} height={12} />}
              Confirm
            </button>
            <button
              onClick={() => void sendCode()}
              disabled={busy}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              Send another
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}
    </section>
  );
}
