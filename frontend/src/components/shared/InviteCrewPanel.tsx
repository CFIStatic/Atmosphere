import { formatPhone, formatPhoneInput, normalizePhoneE164 } from '../../lib/phone';
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
  | { emailed: true; email: string }
  | { emailed: false; email: string; link: string | null }
  | { texted: boolean; phone: string; link: string | null };

/** Intro for the Crew tab on the Access tab's Invite popup. */
export const CREW_PHONE_INVITE_INTRO =
  'Invite crew by email or mobile number. A number signs in with a texted 6-digit code.';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

function partyMeta(party: JobParty): string {
  const parts = [party.email || party.phone];
  if (party.last_seen_at) parts.push(`Opened ${when(party.last_seen_at)}`);
  else parts.push('Not opened yet');
  return parts.filter(Boolean).join(' · ');
}

function absolute(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${window.location.origin}${path}`;
}

export function InviteCrewPanel({
  jobId,
  mode,
  onInvited,
}: {
  jobId: string;
  /** crew: email or mobile number (SMS code sign-in). subcontractor: email. Unset: the header Share popup's crew tab. */
  mode?: 'crew' | 'subcontractor';
  /** Called after a successful invite, e.g. to refresh "Who has access". */
  onInvited?: () => void;
}) {
  const actionsLocked = useProductActionsLocked();
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [via, setVia] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const byPhone = mode === 'crew' && phoneEnabled && via === 'phone';

  useEffect(() => {
    if (mode !== 'crew') return;
    let cancelled = false;
    api.phoneAuthConfig().then(
      (res) => {
        if (!cancelled) setPhoneEnabled(Boolean(res.enabled));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
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
    const number = normalizePhoneE164(phone) ?? phone.trim();
    if (!name || (byPhone ? !number : !to)) {
      setError(
        byPhone
          ? 'Enter a name and a mobile number to send the invite.'
          : 'Enter a name and an email to send the invite.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.addJobParty(jobId, {
        company: name,
        ...(byPhone ? { phone: number, smsConsent } : { email: to }),
        role: 'subcontractor',
        ...(mode === 'crew' ? { serviceRole: 'crew' } : {}),
      });
      const link = absolute(res.fieldCapturePath ?? res.sharePath);
      setMade(
        byPhone
          ? { texted: Boolean(res.texted), phone: number, link }
          : res.emailed
            ? { emailed: true, email: to }
            : { emailed: false, email: to, link },
      );
      setCompany('');
      setSmsConsent(false);
      setEmail('');
      setPhone('');
      await load();
      onInvited?.();
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
    'mt-1.5 h-10 w-full rounded-lg glass-field px-3 text-sm text-ink-900 outline-hidden placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500/25';

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
{mode === 'crew' && phoneEnabled ? (
          <div
            role="radiogroup"
            aria-label="Invite by"
            className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900/5 p-1 ring-1 ring-inset ring-ink-900/10"
          >
            {(['email', 'phone'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={via === key}
                onClick={() => setVia(key)}
                className={`h-7 rounded-md text-xs font-medium transition ${
                  via === key ? 'bg-ink-900/10 text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {key === 'email' ? 'Email' : 'Phone'}
              </button>
            ))}
          </div>
        ) : null}
        {byPhone ? (
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Mobile number</span>
            <input
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(555) 123-4567"
              className={field}
            />
          </label>
        ) : (
                  <label className="block">
            <span className="text-xs font-medium text-ink-700">{mode === 'subcontractor' ? 'Email' : 'Crew email'}</span>
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
        )}
        {byPhone ? (
          <label className="flex items-start gap-2 text-xs text-ink-600" data-testid="crew-sms-consent">
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(e) => setSmsConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              This person agreed to get a text from Atmosphere with their invite. Msg &amp; data rates may apply. Reply
              STOP to opt out.
            </span>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={busy || !company.trim() || !(byPhone ? phone.trim() && smsConsent : email.trim())}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-xs transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          {byPhone ? 'Text crew invite' : mode === 'subcontractor' ? 'Send invite' : 'Send crew invite'}
        </button>
      </form>

      {made && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            ('emailed' in made && made.emailed) || ('texted' in made && made.texted)
              ? 'bg-success-50 text-success-600'
              : 'bg-caution-50 text-caution-600'
          }`}
        >
          {'phone' in made ? (
            made.texted ? (
              `Invite texted to ${formatPhone(made.phone)}. They sign in with that number and a 6-digit code.`
            ) : (
              `Added to the job. No invite text was sent, so tell ${formatPhone(made.phone)} to open the Atmosphere sign-in page and tap "Text me a code".`
            )
          ) : made.emailed ? (
            `Invite sent to ${made.email}. The link opens on the web and in Field Capture.`
          ) : (
            <>
              <p>
                Added to the job, but the email to {'email' in made ? made.email : ''} did not send. Copy the link to send
                it yourself.
              </p>
              {'link' in made && made.link ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-sm bg-paper-0/40 px-2 py-1 text-[11px] text-ink-700">
                    {'link' in made ? made.link : ''}
                  </code>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(('link' in made && made.link) || '')}
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
