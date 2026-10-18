import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, ROLE_LABELS, type MemberRole, type OrgInvite, type PlatformSeatCounts, type SeatType } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useT } from '../../lib/i18n';
import { isGlobalAdmin, PRODUCT_ROLE_BLURBS, type OrgProductRole } from '../../domain/productRoles';
import { SpinnerIcon } from '../icons';
import { planRequiredMessage, UpgradePrompt, useProductActionsLocked } from '../billing/ProductActionLock';
import { APP_SHELL_SEATS_NOTE, isInAppShell } from '../../lib/appShell';
import { usePhoneAuthEnabled } from '../../hooks/usePhoneAuthEnabled';
import { formatPhone, formatPhoneInput, normalizePhoneE164 } from '../../lib/phone';

/**
 * Adding somebody to the team.
 *
 * Org invites create Employee (or Global Admin) seats, or a Platform
 * seat ($75/mo): Global Admin access on the Platform, no Field Capture, no
 * Billing and Usage. Invited workers on one job are invited from the job file
 * via a job-share token — not here.
 */

export const PLATFORM_SEAT_PRICE_LABEL = '$75/mo';
export const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  field_capture: 'Field Capture',
  platform: 'Platform',
};
/** iPhone/Android app: no prices (App Store 3.1.1). */
const SEAT_TYPE_LABELS_IN_APP: Record<SeatType, string> = {
  field_capture: 'Field Capture',
  platform: 'Platform',
};
export const FIELD_CAPTURE_SEAT_BLURB =
  'Films jobs in Field Capture and works on the Platform. Uses a Field Capture seat.';
export const PLATFORM_SEAT_BLURB =
  'Sees everything on the Platform like a Global Admin, except Billing and Usage. No Field Capture.';
/** Explanation under the invite row; the price only outside the phone app (App Store 3.1.1). */
export function platformSeatExplanation(inApp: boolean): string {
  return inApp
    ? `Platform: ${PLATFORM_SEAT_BLURB}`
    : `Platform: ${PLATFORM_SEAT_PRICE_LABEL}. ${PLATFORM_SEAT_BLURB}`;
}

const ROLES: OrgProductRole[] = ['employee', 'global_admin'];

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
  const roles: OrgProductRole[] = ROLES;

  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [email, setEmail] = useState('');
  const [seatType, setSeatType] = useState<SeatType>('field_capture');
  const platformSeat = seatType === 'platform';
  const [platformSeats, setPlatformSeats] = useState<PlatformSeatCounts | null>(null);
  const phoneEnabled = usePhoneAuthEnabled();
  const [byPhone, setByPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const phoneE164 = normalizePhoneE164(phone);
  const usingPhone = phoneEnabled && byPhone && seatType !== 'platform';
  const [role, setRole] = useState<MemberRole>('employee');
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
    if (inApp && seatsFull && !platformSeat && role !== 'global_admin') {
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
        role: platformSeat ? 'global_admin' : role,
        ...(platformSeat ? { seatType: 'platform' as const } : {}),
      });
      setOutcome(
        usingPhone
          ? res.texted
            ? `Invited. Atmosphere texted ${formatPhone(phoneE164)} a sign-in link.`
            : `Invited. Tell them to open app.atmosphereteam.com, tap "Text me a code instead", and enter ${formatPhone(phoneE164)}. We'll text them a sign-in code.`
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

      <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
        {phoneEnabled && !platformSeat ? (
          <div
            role="radiogroup"
            aria-label="Invite by"
            data-testid="invite-via"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-ink-900/5 p-1 ring-1 ring-inset ring-ink-900/10"
          >
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
                  className={`h-7 rounded-md px-3 text-xs font-medium transition ${
                    on ? 'bg-ink-900/10 text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800'
                  }`}
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
            className="w-full min-w-40 flex-1 rounded-lg glass-field px-3 py-2 sm:w-auto text-sm text-ink-900 outline-hidden placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
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
            className="w-full min-w-40 flex-1 rounded-lg glass-field px-3 py-2 sm:w-auto text-sm text-ink-900 outline-hidden placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
          />
        )}
        <div
          role="radiogroup"
          aria-label="Seat type"
          data-testid="invite-seat-type"
          className="flex w-full shrink-0 items-stretch gap-0.5 rounded-lg glass-field p-0.5 sm:w-auto"
        >
          <span className="hidden self-center pl-2 pr-1 text-xs text-ink-500 sm:inline" aria-hidden="true">
            Seat
          </span>
          {(['field_capture', 'platform'] as const).map((key) => {
            const on = seatType === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`invite-seat-${key}`}
                title={key === 'platform' ? platformSeatExplanation(inApp) : FIELD_CAPTURE_SEAT_BLURB}
                onClick={() => {
                  setSeatType(key);
                  setError(null);
                }}
                className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition sm:flex-none ${
                  on ? 'bg-ink-900/10 font-medium text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {(inApp ? SEAT_TYPE_LABELS_IN_APP : SEAT_TYPE_LABELS)[key]}
              </button>
            );
          })}
        </div>
        {platformSeat ? null : (
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
          className="rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-hidden focus:ring-2 focus:ring-brand-200"
          title={PRODUCT_ROLE_BLURBS[role as OrgProductRole] ?? ''}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        )}
        <button
          type="submit"
          disabled={busy || (usingPhone ? !phoneE164 : !email.trim())}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          {t('settings.invites.button')}
        </button>
      </form>
      <p
        className="mt-1.5 text-[11px] text-ink-500"
        data-testid={platformSeat ? 'platform-seat-blurb' : 'field-capture-seat-blurb'}
      >
        {platformSeat ? platformSeatExplanation(inApp) : FIELD_CAPTURE_SEAT_BLURB}
      </p>
      <p className="mt-1.5 text-[11px] text-ink-400">
        {t('settings.invites.rolesHint')}
        {seats
          ? ` Field Capture accounts: ${seats.used} of ${seats.allowed} in use.`
          : ' Work Verification includes 3 Field Capture accounts.'}
        <span data-testid="platform-seat-count">
          {platformSeats
            ? ` Platform seats: ${platformSeats.used} of ${platformSeats.allowed} in use.`
            : inApp
              ? ''
              : ` Platform seats: ${PLATFORM_SEAT_PRICE_LABEL} each.`}
        </span>
        {platformSeat && platformSeats && platformSeats.available === false && platformSeats.remaining <= 0 ? (
          <span data-testid="platform-seat-unavailable"> Platform seats aren't available yet.</span>
        ) : null}
        {inApp && seatsFull ? (
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
