import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, ROLE_LABELS, type MemberRole, type OrgInvite, type PlatformSeatCounts } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useT } from '../../lib/i18n';
import { isGlobalAdmin } from '../../domain/productRoles';
import { SpinnerIcon } from '../icons';
import { planRequiredMessage, UpgradePrompt, useProductActionsLocked } from '../billing/ProductActionLock';
import { APP_SHELL_SEATS_NOTE, isInAppShell } from '../../lib/appShell';
import { usePhoneAuthEnabled } from '../../hooks/usePhoneAuthEnabled';
import { formatPhone, formatPhoneInput, normalizePhoneE164 } from '../../lib/phone';

/**
 * Adding somebody to the team.
 *
 * Org invites create Employee (Field Capture) seats, or a Platform
 * seat ($75/mo): Global Admin access on the Platform, no Field Capture, no
 * Billing and Usage. Invited workers on one job are invited from the job file
 * via a job-share token — not here.
 */

export const PLATFORM_SEAT_PRICE_LABEL = '$75/mo';

/**
 * One control for who the person is. The workspace has one Global Admin, the
 * account owner who pays; nobody else can be invited as one.
 *   field_capture -> role employee (uses a Field Capture seat)
 *   platform      -> role global_admin + seatType platform ($75/mo; the
 *                    database role behind a Platform seat, not a Global Admin)
 */
export type InviteKind = 'field_capture' | 'platform';
export const INVITE_KINDS: InviteKind[] = ['field_capture', 'platform'];
export const INVITE_KIND_LABELS: Record<InviteKind, string> = {
  field_capture: 'Field Capture',
  platform: 'Platform',
};

/** The one helper line under the row. No prices inside the phone app (App Store 3.1.1). */
export function inviteKindHelp(
  kind: InviteKind,
  opts: {
    inApp: boolean;
    fieldCaptureSeats?: { used: number; allowed: number } | null;
    platformSeats?: PlatformSeatCounts | null;
  },
): string {
  const { inApp, fieldCaptureSeats, platformSeats } = opts;
  if (kind === 'field_capture') {
    const base = 'Films jobs in Field Capture and uses the Platform.';
    return fieldCaptureSeats
      ? `${base} ${fieldCaptureSeats.used} of ${fieldCaptureSeats.allowed} Field Capture seats used.`
      : base;
  }
  let line = 'Full Platform access except Billing and Usage, no Field Capture.';
  if (!inApp) line += ` ${PLATFORM_SEAT_PRICE_LABEL} each.`;
  // Only once some are bought: never "0 of 0".
  if (platformSeats && platformSeats.allowed > 0) {
    line += ` ${platformSeats.used} of ${platformSeats.allowed} in use.`;
  }
  return line;
}

const SEGMENT_GROUP =
  'flex items-center gap-1 rounded-lg bg-ink-900/5 p-1 ring-1 ring-inset ring-ink-900/10';
const segmentClass = (on: boolean) =>
  `h-[30px] flex-1 whitespace-nowrap rounded-md px-3 text-sm transition outline-hidden focus-visible:ring-2 focus-visible:ring-brand-300 sm:flex-none ${
    on ? 'bg-ink-900/10 font-medium text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800'
  }`;

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

export function InvitePanel({ onInvited }: { onInvited?: () => void } = {}) {
  const t = useT();
  const { membership } = useAuth();
  const actionsLocked = useProductActionsLocked();
  const admin = isGlobalAdmin(membership?.role);

  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<InviteKind>('field_capture');
  const platformSeat = kind === 'platform';
  const role: MemberRole = platformSeat ? 'global_admin' : 'employee';
  const [platformSeats, setPlatformSeats] = useState<PlatformSeatCounts | null>(null);
  const phoneEnabled = usePhoneAuthEnabled();
  const [byPhone, setByPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const phoneE164 = normalizePhoneE164(phone);
  const usingPhone = phoneEnabled && byPhone;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState<{ used: number; allowed: number } | null>(null);
  // iPhone/Android app: an invite past the seats would add a paid seat or open
  // Stripe. The app never does either (App Store 3.1.1), so it stops here.
  const inApp = isInAppShell();
  const seatsFull = Boolean(seats && seats.used >= seats.allowed);

  async function load() {
    try {
      const res = await api.orgInvites();
      setInvites(res.invites);
    } catch {
      // The form still works without the history; an empty list would read as
      // "nobody was ever invited", which may be false, so stay null and quiet.
      setInvites((prev) => prev ?? []);
    }
    try {
      // Seat counts come with the onboarding status every member can read;
      // the full billing workspace is the account owner's alone.
      const workspace = await api.getBillingOnboarding();
      if (workspace.fieldCaptureSeats) {
        setSeats({
          used: workspace.fieldCaptureSeats.used,
          allowed: workspace.fieldCaptureSeats.allowed,
        });
      }
      if (workspace.platformSeats) setPlatformSeats(workspace.platformSeats);
    } catch {
      /* billing is optional on this screen */
    }
  }

  useEffect(() => {
    if (!admin) return;
    void load();
  }, [admin]);

  if (!admin) {
    return (
      <section className="mb-6 rounded-xl glass-card p-5">
        <h2 className="text-base font-semibold text-ink-900">{t('settings.invites.title')}</h2>
        <p className="mt-1 text-xs text-ink-500">{t('settings.invites.adminOnly')}</p>
      </section>
    );
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (actionsLocked) {
      setError(planRequiredMessage());
      return;
    }
    if (inApp && platformSeat && platformSeats && platformSeats.remaining <= 0) {
      setOutcome(null);
      setError(`Every Platform seat on this team is in use. ${APP_SHELL_SEATS_NOTE}`);
      return;
    }
    if (inApp && seatsFull && !platformSeat) {
      setOutcome(null);
      setError(`Every Field Capture seat on this team is in use. ${APP_SHELL_SEATS_NOTE}`);
      return;
    }
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await api.createOrgInvite({
        ...(usingPhone ? { phone: phoneE164 ?? phone } : { email }),
        role,
        ...(platformSeat ? { seatType: 'platform' as const } : {}),
      });
      setOutcome(
        usingPhone
          ? res.texted
            ? `Invited. We texted ${formatPhone(phoneE164)} a link to app.atmosphereteam.com. They sign in with that number and a 6-digit code.`
            : `Invited, but we couldn't text ${formatPhone(phoneE164)} ${res.textStatus === 'not_configured' ? '(team texting isn\'t set up yet)' : 'just now'}. Send them app.atmosphereteam.com and have them sign in with that number.`
          : res.emailed
            ? `Invited — Atmosphere emailed ${email}.`
            : `Invited. Atmosphere could not email them, so let them know to check with you.`,
      );
      setEmail('');
      setPhone('');
      onInvited?.();
      await load();
    } catch (err) {
      if (!inApp && err instanceof ApiError && err.checkoutUrl) {
        window.location.href = err.checkoutUrl;
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not record that invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function textAgain(inv: OrgInvite) {
    setError(null);
    setOutcome(null);
    try {
      const res = await api.textOrgInvite(inv.id);
      if (res.texted) setOutcome(`Texted ${formatPhone(inv.phone)} the invite link again.`);
      else
        setError(
          res.textStatus === 'not_configured'
            ? `Couldn't text ${formatPhone(inv.phone)}: team texting isn't set up yet.`
            : `Couldn't text ${formatPhone(inv.phone)} just now. Try again in a minute.`,
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not text that invitation.');
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

  const pending = (invites ?? []).filter((i) => i.status === 'pending');

  return (
    <section className="mb-6 rounded-xl glass-card p-5">
      <h2 className="text-base font-semibold text-ink-900">{t('settings.invites.title')}</h2>
      <p className="mt-1 text-xs text-ink-500">{t('settings.invites.description')}</p>
      {actionsLocked ? (
        <div className="mt-3">
          <UpgradePrompt />
        </div>
      ) : null}

      <form onSubmit={invite} className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="invite-row">
        <div className="flex min-w-0 flex-col gap-2 sm:min-w-[18rem] sm:flex-1 sm:flex-row">
          {phoneEnabled ? (
            <div role="radiogroup" aria-label="Invite by" data-testid="invite-via" className={`${SEGMENT_GROUP} shrink-0`}>
              {(['email', 'phone'] as const).map((key) => {
                const on = key === 'phone' ? byPhone : !byPhone;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`invite-via-${key}`}
                    onClick={() => {
                      setByPhone(key === 'phone');
                      setError(null);
                    }}
                    className={segmentClass(on)}
                  >
                    {key === 'email' ? 'Email' : 'Phone'}
                  </button>
                );
              })}
            </div>
          ) : null}
          {usingPhone ? (
            <input
              type="tel"
              inputMode="tel"
              required
              aria-label="Mobile number"
              data-testid="invite-phone"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(555) 123-4567"
              className="w-full min-w-0 flex-1 rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-hidden placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          ) : (
            <input
              type="email"
              required
              aria-label="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their@email.com"
              className="w-full min-w-0 flex-1 rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-hidden placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div role="radiogroup" aria-label="Access" data-testid="invite-seat-type" className={`${SEGMENT_GROUP} shrink-0`}>
            {INVITE_KINDS.map((key) => {
              const on = kind === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`invite-seat-${key}`}
                  onClick={() => {
                    setKind(key);
                    setError(null);
                  }}
                  className={segmentClass(on)}
                >
                  {INVITE_KIND_LABELS[key]}
                </button>
              );
            })}
          </div>
          <button
            type="submit"
            disabled={busy || (usingPhone ? !phoneE164 : !email.trim())}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition outline-hidden hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 sm:w-auto"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            {t('settings.invites.button')}
          </button>
        </div>
      </form>
      <p className="mt-1.5 text-xs text-ink-500" data-testid="invite-help">
        {inviteKindHelp(kind, { inApp, fieldCaptureSeats: seats, platformSeats })}
        {platformSeat && platformSeats && platformSeats.available === false && platformSeats.remaining <= 0 ? (
          <span data-testid="platform-seat-unavailable"> Platform seats aren&apos;t available yet.</span>
        ) : null}
        {inApp && seatsFull && kind === 'field_capture' ? (
          <span data-testid="app-shell-seats-note"> {APP_SHELL_SEATS_NOTE}</span>
        ) : null}
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
                <span className="block truncate text-xs font-medium text-ink-800">{inv.email || formatPhone(inv.phone)}</span>
                <span className="block text-[11px] text-ink-500">
                  {inv.seatType === 'platform' ? 'Platform' : (ROLE_LABELS[inv.role as MemberRole] ?? inv.role)}{inv.serviceRole ? ` · ${inv.serviceRole === 'other' && inv.serviceRoleCustom ? inv.serviceRoleCustom : inv.serviceRole}` : ''} · asked {ago(inv.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[inv.status]}`}
                >
                  {inv.status}
                </span>
                {inv.status === 'pending' && inv.phone && !inv.email && (
                  <button
                    onClick={() => void textAgain(inv)}
                    data-testid="invite-text-again"
                    className="text-[11px] text-ink-500 hover:text-brand-700"
                  >
                    text again
                  </button>
                )}
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
          Withdrawing an invitation is bookkeeping — it does not remove someone who already joined.
        </p>
      )}
    </section>
  );
}
