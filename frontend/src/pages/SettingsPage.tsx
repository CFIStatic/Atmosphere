import {
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  CONTRACTOR_TYPE_LABELS,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type ContractorType,
  type MailStatus,
  type Diagnosis,
  type Integration,
  type OrgMember,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { BillingSection } from '../components/settings/BillingSection';
import { InvitePanel } from '../components/team/InvitePanel';
import { displayName, initials, nameFromMetadata } from '../lib/display';
import { setPreference, usePreferences, type Preferences } from '../lib/preferences';
import { usePlatform } from '../lib/usePlatform';
import type { PlatformId } from '../lib/platforms';
import {
  BuildingIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LogOutIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  SpinnerIcon,
  UserIcon,
  CreditCardIcon,
} from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { WORK_VERIFICATION_TOUR, queueProductTour } from '../lib/productTour';

type SectionId =
  | 'profile'
  | 'security'
  | 'organization'
  | 'billing'
  | 'sending'
  | 'contactdata'
  | 'preferences';

interface SettingsSection {
  id: SectionId;
  label: string;
  blurb: string;
  icon: typeof UserIcon;
  /** When set, the section only appears inside that platform. */
  platform?: PlatformId;
}

const SECTIONS: SettingsSection[] = [
  { id: 'profile', label: 'Profile', blurb: 'Your name and account details', icon: UserIcon },
  { id: 'security', label: 'Security', blurb: 'Password and sign-out', icon: ShieldIcon },
  {
    id: 'organization',
    label: 'Organization',
    blurb: 'Your org and invite code',
    icon: BuildingIcon,
  },
  {
    // Sits with the org because that is what it is about — the company's plan,
    // its seats, its receipts. Manager-only: everyone else can see what the
    // company owns without being shown what it costs.
    id: 'billing',
    label: 'Billing',
    blurb: 'Seats, what Atmosphere costs, and past charges',
    icon: CreditCardIcon,
    platform: 'manager',
  },
  {
    // Connecting a mailbox is a Sales concern and an owner decision: it is the
    // company's own address that campaign mail goes out from.
    id: 'sending',
    label: 'Sending email',
    blurb: 'The mailbox campaigns send from',
    icon: SearchIcon,
    platform: 'sales',
  },
  {
    // Where prospecting gets its data is a Sales question. Showing it to
    // someone working in Field or Operations is clutter at best, and at worst
    // invites them to change how another team's tooling behaves.
    id: 'contactdata',
    label: 'Contact data',
    blurb: 'Where prospect emails and phones come from',
    icon: SearchIcon,
    platform: 'sales',
  },
  { id: 'preferences', label: 'Preferences', blurb: 'How this device behaves', icon: SlidersIcon },
];

function isSectionId(value: string | null): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

/** The sections this platform actually owns, plus the ones everybody has. */
function sectionsFor(platform: PlatformId): SettingsSection[] {
  return SECTIONS.filter((section) => !section.platform || section.platform === platform);
}

export function SettingsPage() {
  useFeatureTimer('settings');
  // The section lives in the URL so a settings link can point at one directly
  // and the browser's back button steps between them.
  const [params, setParams] = useSearchParams();
  const [platform] = usePlatform();
  const visible = sectionsFor(platform);
  const raw = params.get('section');
  // A section this platform does not own falls back to Profile rather than
  // rendering a panel with no way to navigate to or from it.
  const requested: SectionId = isSectionId(raw) ? raw : 'profile';
  const active: SectionId = visible.some((s) => s.id === requested) ? requested : 'profile';

  function select(section: SectionId) {
    setParams(section === 'profile' ? {} : { section }, { replace: false });
  }

  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/80">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">Settings</h1>
          <p className="mt-1.5 text-sm text-ink-600">
            Manage your account, organization, and how Atmosphere behaves on this device.
          </p>
        </header>

        <nav className="mt-8 border-b border-line" aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto pb-px">
            {visible.map((section) => {
              const isActive = section.id === active;
              return (
                <li key={section.id} className="shrink-0">
                  <button
                    onClick={() => select(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'border border-b-0 border-line bg-paper-0 text-brand-700'
                        : 'text-ink-600 hover:bg-paper-200/50 hover:text-ink-900'
                    }`}
                  >
                    <section.icon width={18} height={18} />
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-8 min-w-0 space-y-6">
          {active === 'profile' && <ProfileSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'organization' && (
            <>
              <OrganizationSection />
              <FieldCaptureAppSection />
              <InvitePanel />
              <LinkedAccountsCard />
            </>
          )}
          {active === 'billing' && <BillingSection />}
          {active === 'sending' && <SendingSection />}
          {active === 'contactdata' && <ContactDataSection />}
          {active === 'preferences' && <PreferencesSection />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Shared building blocks
 * -------------------------------------------------------------------------- */

function Card({
  title,
  description,
  children,
  tone = 'default',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <section
      className={`rounded-xl border p-5 sm:p-6 ${
        tone === 'danger' ? 'border-danger-200 bg-danger-50' : 'glass-card'
      }`}
    >
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-600">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg glass-card px-3.5 py-2.5 text-sm text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:opacity-60';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

function PrimaryButton({
  children,
  busy,
  ...props
}: { busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
      {children}
    </button>
  );
}

function Saved({ show, label = 'Saved' }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm text-success-600">
      <CheckIcon width={16} height={16} /> {label}
    </span>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger-600">
      {message}
    </p>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800">{label}</p>
        <p className="mt-0.5 text-sm text-ink-500">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-brand-600' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper-200/50 transition-all ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2.5 last:border-0">
      <span className="text-sm text-ink-500">{label}</span>
      <span className="text-sm text-ink-800">{value}</span>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/* -------------------------------------------------------------------------- *
 * Profile
 * -------------------------------------------------------------------------- */

function ProfileSection() {
  const { user, profile, setProfile } = useAuth();
  const resolvedName = profile?.fullName || nameFromMetadata(user?.metadata);
  const [name, setName] = useState(resolvedName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile arrives asynchronously; adopt it unless the user has already
  // started typing, which would otherwise be overwritten mid-edit.
  useEffect(() => {
    const incoming = profile?.fullName || nameFromMetadata(user?.metadata) || '';
    setName((current) => (current === '' ? incoming : current));
  }, [profile?.fullName, user?.metadata]);

  const storedName = profile?.fullName ?? '';
  const dirty = name.trim() !== storedName;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.updateProfile(name.trim() || null);
      setProfile(updated);
      setName(updated.fullName ?? '');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card
        title="Your profile"
        description="This is how teammates see you in the linked accounts list."
      >
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-500 text-lg font-semibold text-white">
            {initials(name || profile?.fullName, user?.email)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-900">
              {displayName(name || profile?.fullName, user?.email)}
            </p>
            <p className="truncate text-sm text-ink-500">{user?.email}</p>
          </div>
        </div>

        <div className="mt-6 max-w-md">
          <Field label="Display name" hint="Leave blank to fall back to your email address.">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="e.g. Jordan Rivera"
              className={`mt-2 ${INPUT_CLASS}`}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={save} busy={saving} disabled={!dirty}>
            Save changes
          </PrimaryButton>
          <Saved show={saved} />
          <ErrorText message={error} />
        </div>
      </Card>

      <Card title="Account" description="Details tied to your Atmosphere sign-in.">
        <ReadOnlyRow label="Email" value={user?.email ?? '—'} />
        <ReadOnlyRow
          label="Email confirmed"
          value={user?.emailConfirmed ? 'Yes' : 'Not yet confirmed'}
        />
        <ReadOnlyRow label="Member since" value={formatDate(user?.createdAt)} />
        <ReadOnlyRow label="Last sign-in" value={formatDate(user?.lastSignInAt)} />
        <p className="mt-4 text-xs text-ink-500">
          Your sign-in email can't be changed here — it identifies your account across the
          organization.
        </p>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Security
 * -------------------------------------------------------------------------- */

function SecuritySection() {
  return (
    <>
      <ChangePasswordCard />
      <SignOutCard />
    </>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not change your password. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Password"
      description="Changing your password signs you out everywhere else. This device stays signed in."
    >
      <form onSubmit={submit} className="max-w-md space-y-4">
        {/* Present for password managers: they need the account this credential
            belongs to in order to offer the right entry. */}
        <input type="text" name="username" autoComplete="username" className="hidden" readOnly />

        <Field label="Current password">
          <div className="relative mt-2">
            <input
              type={reveal ? 'text' : 'password'}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              className={`${INPUT_CLASS} pr-11`}
            />
            <button
              type="button"
              onClick={() => setReveal((value) => !value)}
              aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 transition hover:text-ink-800"
            >
              {reveal ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
            </button>
          </div>
        </Field>

        <Field label="New password" hint="At least 8 characters.">
          <input
            type={reveal ? 'text' : 'password'}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            className={`mt-2 ${INPUT_CLASS}`}
          />
        </Field>

        <Field label="Confirm new password">
          <input
            type={reveal ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            className={`mt-2 ${INPUT_CLASS}`}
          />
        </Field>

        {mismatch && <p className="text-sm text-caution-600">Those passwords don't match yet.</p>}
        <ErrorText message={error} />

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton type="submit" busy={saving} disabled={!canSubmit}>
            Update password
          </PrimaryButton>
          <Saved show={saved} label="Password updated" />
        </div>
      </form>
    </Card>
  );
}

function SignOutCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { confirmSignOut } = usePreferences();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (confirmSignOut && !window.confirm('Sign out of Atmosphere?')) return;
    setBusy(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Sign out"
      description="Ends the session on this device. Sign in again with your email and password to continue."
      tone="danger"
    >
      <button
        onClick={signOut}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-medium text-danger-700 transition hover:bg-danger-200/50 disabled:opacity-60"
      >
        {busy ? (
          <SpinnerIcon className="animate-spin" width={16} height={16} />
        ) : (
          <LogOutIcon width={16} height={16} />
        )}
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- *
 * Organization
 * -------------------------------------------------------------------------- */

const CONTRACTOR_ORDER: ContractorType[] = [
  'restoration',
  'roofing',
  'general_contractor',
  'other',
];

function OrganizationSection() {
  const { membership, refreshMembership } = useAuth();
  const [contractorType, setContractorType] = useState<ContractorType | null>(
    membership?.org?.contractorType ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setContractorType(membership?.org?.contractorType ?? null);
  }, [membership?.org?.contractorType]);

  const org = membership?.org;
  const dirty = contractorType !== (membership?.org?.contractorType ?? null);

  async function copyCode() {
    if (!org?.joinCode) return;
    try {
      await navigator.clipboard.writeText(org.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  async function save() {
    if (!contractorType || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateOrgProfile(contractorType);
      await refreshMembership();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save those changes. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Organization" description="The office account your login is linked to.">
      <ReadOnlyRow label="Name" value={org?.name ?? '—'} />
      <ReadOnlyRow
        label="Invite code"
        value={
          <span className="flex items-center gap-3">
            <code className="rounded-md border border-line bg-paper-100 px-2.5 py-1 font-mono tracking-widest text-brand-700">
              {org?.joinCode ?? '—'}
            </code>
            {org?.joinCode && (
              <button
                onClick={copyCode}
                className="flex items-center gap-1 text-sm text-ink-600 transition hover:text-ink-900"
              >
                {copied ? (
                  <>
                    <CheckIcon width={15} height={15} /> Copied
                  </>
                ) : (
                  'Copy'
                )}
              </button>
            )}
          </span>
        }
      />
      <div className="mt-5">
        <Field label="Company type">
          <select
            value={contractorType ?? ''}
            onChange={(event) =>
              setContractorType((event.target.value || null) as ContractorType | null)
            }
            className={`mt-2 ${INPUT_CLASS}`}
          >
            <option value="" className="bg-paper-200/50">
              Select a company type
            </option>
            {CONTRACTOR_ORDER.map((value) => (
              <option key={value} value={value} className="bg-paper-200/50">
                {CONTRACTOR_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={save} busy={saving} disabled={!dirty || !contractorType}>
          Save changes
        </PrimaryButton>
        <Saved show={saved} />
        <ErrorText message={error} />
      </div>
      <p className="mt-4 text-xs text-ink-500">
        Share the invite code so teammates can link their account to {org?.name ?? 'this office'}.
        Renaming an organization isn't available yet. Only the org creator can change the company
        type once it is set.
      </p>
    </Card>
  );
}

function LinkedAccountsCard() {
  const { user } = useAuth();
  const [members, setMembers] = useState<OrgMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMembers()
      .then(({ members: next }) => {
        if (!cancelled) setMembers(next);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card
      title="Linked accounts"
      description="Everyone whose login is linked to this office account can work in the same workspace."
    >
      {members === null ? (
        <div className="grid place-items-center py-8 text-brand-600">
          <SpinnerIcon className="animate-spin" width={22} height={22} />
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-ink-500">
          No linked accounts yet. Share the join code so teammates can link theirs.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {members.map((member) => {
            const isYou = member.userId === user?.id;
            const name = displayName(member.fullName, member.email);
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-4 bg-paper-0 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-semibold text-white">
                    {initials(member.fullName, member.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {name}
                      {isYou && <span className="ml-2 text-xs font-normal text-brand-600">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-ink-500">
                      {member.email ?? '—'}
                      {member.workType ? ` · ${WORK_TYPE_LABELS[member.workType]}` : ''}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-paper-50 px-3 py-1 text-xs font-medium text-ink-700">
                  {ROLE_LABELS[member.role] ?? member.role}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- *
 * Preferences
 * -------------------------------------------------------------------------- */

/** The on/off preferences. Theme is a choice, not a switch, and rides below. */
type BooleanPreference = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

const TOGGLES: { key: BooleanPreference; label: string; description: string }[] = [
  {
    key: 'reduceMotion',
    label: 'Reduce motion',
    description: 'Turn off entrance animations and transitions.',
  },
  {
    key: 'confirmSignOut',
    label: 'Confirm before signing out',
    description: 'Ask first — useful on a shared tablet in the field.',
  },
];

/**
 * How a Field Capture iPhone login attaches to this office account.
 * The join code is the same one teammates type on the website.
 */
function FieldCaptureAppSection() {
  const { membership } = useAuth();
  const joinCode = membership?.org?.joinCode ?? null;
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Office join code for Field Capture', joinCode);
    }
  }

  return (
    <Card
      title="Field Capture app"
      description="Crew open the app, type their name and this office code, and they show up on the team — ready to be put on jobs."
    >
      <div className="rounded-lg border border-line bg-paper-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Office join code</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <code className="rounded-md border border-line bg-paper-0 px-2.5 py-1 font-mono tracking-widest text-brand-700">
            {joinCode ?? '—'}
          </code>
          {joinCode && (
            <button
              type="button"
              onClick={() => void copyCode()}
              className="flex items-center gap-1 text-sm text-ink-600 transition hover:text-ink-900"
            >
              {copied ? (
                <>
                  <CheckIcon width={15} height={15} /> Copied
                </>
              ) : (
                'Copy code'
              )}
            </button>
          )}
        </div>
      </div>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-700">
        <li>Install Field Capture on the phone.</li>
        <li>
          They type their <strong className="font-semibold text-ink-900">first and last name</strong>{' '}
          (so the office can assign work to them) and this code
          {joinCode ? (
            <>
              {' '}
              (or open <code className="font-mono text-xs">atmosphere-field://join?code={joinCode}</code>)
            </>
          ) : null}
          .
        </li>
        <li>
          They appear under Team as a field technician. Put them on a job from the job’s Crew tab —
          that job then shows in the app.
        </li>
      </ol>
      <p className="mt-4 text-sm text-ink-600">
        After that, day films from the phone land in Verifier / evidence for{' '}
        {membership?.org?.name ?? 'this office'}. Disconnect only from the app’s Account menu if you
        hand the phone to someone else.
      </p>
    </Card>
  );
}

function PreferencesSection() {
  const preferences = usePreferences();
  const navigate = useNavigate();

  return (
    <Card
      title="This device"
      description="Saved in this browser only, so a phone in the field and an office desktop can differ."
    >
      <div className="divide-y divide-line">
        {TOGGLES.map((toggle) => (
          <Toggle
            key={toggle.key}
            checked={preferences[toggle.key]}
            onChange={(next) => setPreference(toggle.key, next)}
            label={toggle.label}
            description={toggle.description}
          />
        ))}

        <div className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Product walkthrough</p>
            <p className="mt-0.5 text-sm text-ink-600">
              Replay the guided tour with simulated previews of Field Capture and the Evidence
              Platform.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              queueProductTour(WORK_VERIFICATION_TOUR.id);
              navigate('/verifier-library?tour=1');
            }}
            className="rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
          >
            Replay tour
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Appearance</p>
            <p className="mt-0.5 text-sm text-ink-600">
              Light or dark — applies across every screen in this browser.
            </p>
          </div>
          <div className="flex rounded-lg glass-card p-1">
            {(
              [
                { mode: 'dark', label: 'Dark' },
                { mode: 'light', label: 'Light' },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreference('theme', mode)}
                aria-pressed={preferences.theme === mode}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  preferences.theme === mode
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Contact data — where prospect emails and phone numbers actually come from.
 *
 * This screen exists because the honest answer to "is this data real?" is
 * configuration, not marketing. A deployment with no vendor key returns
 * invented people; one with a vendor but no verifier returns addresses nobody
 * confirmed. Both are legitimate states to be in and neither should be a
 * surprise, so the panel names them rather than showing a green tick for
 * "connected" and leaving it there.
 *
 * The Test button makes real credential calls. A key can be present,
 * well-formed, and rejected — or valid with no credits left behind it — and
 * only asking the vendor tells you which.
 */
function ContactDataSection() {
  const [items, setItems] = useState<Integration[]>([]);
  const [mode, setMode] = useState<string>('');
  const [sellUnverified, setSellUnverified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (test: boolean) => {
    test ? setTesting(true) : setLoading(true);
    setError(null);
    try {
      const res = await api.prospectingIntegrations(test);
      setItems(res.items);
      setMode(res.mode);
      setSellUnverified(res.sellUnverified);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'insufficient_role'
          ? 'Only an owner or admin can see the contact-data configuration.'
          : err instanceof Error
            ? err.message
            : 'Could not load integrations.',
      );
    } finally {
      setTesting(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const sources = items.filter((i) => i.kind === 'source');
  const verifiers = items.filter((i) => i.kind === 'verifier');
  const liveSource = sources.some((s) => s.configured);
  const liveVerifier = verifiers.some((v) => v.configured);

  return (
    <div className="space-y-5">
      <Card
        title="What this is finding"
        description="Prospecting buys contact details from data vendors and confirms the addresses before you are charged. Both halves have to be configured for the results to be real."
      >
        {loading ? (
          <p className="text-sm text-ink-600">Checking…</p>
        ) : error ? (
          <ErrorText message={error} />
        ) : (
          <div className="space-y-4">
            <div
              className={`rounded-lg border p-4 text-sm ${
                liveSource && liveVerifier
                  ? 'border-success-200 bg-success-50 text-success-600'
                  : 'border-caution-200 bg-caution-50 text-caution-600'
              }`}
            >
              {!liveSource ? (
                <>
                  <strong>Sample data.</strong> No contact-data vendor is connected, so searches
                  return invented people and reveals are free. Nothing here reaches a real person.
                </>
              ) : !liveVerifier ? (
                <>
                  <strong>Unverified.</strong> A vendor is connected, but nothing is confirming
                  that the addresses it returns actually exist.{' '}
                  {sellUnverified
                    ? 'This deployment sells them anyway — every address is the vendor’s word alone.'
                    : 'Unconfirmed addresses are withheld rather than billed, so match rates will look low until a verifier is added.'}
                </>
              ) : (
                <>
                  <strong>Live.</strong> Real contact data, and every address is checked against
                  the receiving mail server before you are charged for it.
                </>
              )}
            </div>

            <ReadOnlyRow label="Mode" value={mode === 'live' ? 'Live' : 'Sandbox'} />

            <IntegrationList
              heading="Sources"
              blurb="Asked in order until one has the person. More sources, higher match rate."
              items={sources}
            />
            <IntegrationList
              heading="Verification"
              blurb="Confirms a mailbox exists. ZeroBounce and NeverBounce work over HTTPS; the built-in SMTP probe needs outbound port 25, which most hosts block."
              items={verifiers}
            />

            <div className="flex items-center gap-3 pt-1">
              <PrimaryButton onClick={() => void load(true)} disabled={testing}>
                {testing ? 'Testing…' : 'Test credentials'}
              </PrimaryButton>
              <span className="text-xs text-ink-500">
                Makes a real call to each connected vendor.
              </span>
            </div>
          </div>
        )}
      </Card>

      <TestLookupCard />

      <NetworkCard />

      <Card
        title="Connecting a vendor"
        description="Keys are set on the server, not here — they belong to Atmosphere rather than to one organization, and the per-reveal credit charge is what covers them."
      >
        <dl className="space-y-3 text-sm">
          {[
            ['PEOPLE_DATA_LABS_API_KEY', 'Person search and enrichment. The primary source.'],
            ['HUNTER_API_KEY', 'Domain crawler. Finds people at small companies no database holds.'],
            ['ZEROBOUNCE_API_KEY', 'Mailbox verification over HTTPS. Works on any host.'],
            ['NEVERBOUNCE_API_KEY', 'Alternative verifier, same job.'],
          ].map(([key, blurb]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <code className="font-mono text-xs text-ink-900">{key}</code>
              <span className="text-ink-600">{blurb}</span>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function IntegrationList({
  heading,
  blurb,
  items,
}: {
  heading: string;
  blurb: string;
  items: Integration[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink-900">{heading}</h3>
      <p className="mt-0.5 text-xs text-ink-500">{blurb}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-lg glass-card px-3.5 py-2.5"
          >
            <span className="text-sm text-ink-900">{item.name}</span>
            <IntegrationBadge item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Four states, deliberately distinct. "Configured but never tested" is not the
 * same claim as "we called it and it answered", and collapsing them is how a
 * settings screen ends up reassuring somebody about a key that does not work.
 */
function IntegrationBadge({ item }: { item: Integration }) {
  if (!item.configured) {
    return <span className="text-xs text-ink-500">Not connected</span>;
  }
  if (item.reachable === true) {
    return (
      <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-600">
        Working
      </span>
    );
  }
  if (item.reachable === false) {
    return (
      <span
        className="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-600"
        title={item.detail ?? undefined}
      >
        Failing
      </span>
    );
  }
  return (
    <span className="rounded-full bg-paper-200 px-2 py-0.5 text-xs font-medium text-ink-700">
      Connected · untested
    </span>
  );
}

/**
 * The shared contact network — the one setting on this page with someone
 * else's interests on the other side of it.
 *
 * Contributing means this organization's business contacts become findable by
 * every other customer. That is a genuinely good trade for the org — the pool
 * gets better for them too — but the people in those records never agreed to
 * anything, so the control says exactly what happens rather than describing it
 * as "improve your results". Off is the default, and turning it off again
 * withdraws what was already given rather than merely stopping new writes.
 */
function NetworkCard() {
  const [contributing, setContributing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .networkSettings()
      .then((res) => {
        setContributing(res.contributing);
        setEnabled(res.enabled);
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.setNetworkContribution(next);
      setContributing(res.contributing);
      setNote(
        next
          ? 'Contributing. Your business contacts are now findable by other organizations.'
          : `Withdrawn — ${res.withdrawn} ${res.withdrawn === 1 ? 'record' : 'records'} removed from the pool.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  async function contributeNow() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.contributeToNetwork();
      setNote(`Shared ${res.contributed} of ${res.considered} contacts.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not contribute.');
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <Card
      title="Shared contact network"
      description="Organizations that opt in pool the business contacts they already hold, and can find people the others have recorded. It is the single biggest lever on how often a search finds somebody."
    >
      {loading ? (
        <p className="text-sm text-ink-600">Checking…</p>
      ) : (
        <div className="space-y-4">
          <Toggle
            checked={contributing}
            onChange={(next) => void toggle(next)}
            label="Contribute our contacts"
            description="Your contacts' names, work emails and work phone numbers become findable by other Atmosphere organizations. Personal addresses and shared mailboxes are never shared. Turning this off removes everything you have contributed."
          />

          <div className="rounded-lg border border-line p-4 text-xs leading-relaxed text-ink-600">
            <p className="font-medium text-ink-800">What this means for the people in your CRM</p>
            <p className="mt-1">
              Their work contact details are shared with other companies using Atmosphere. Anyone
              can ask to be removed, and an erasure is permanent across the whole network — it
              cannot be undone by another organization contributing them again. Only business
              addresses are eligible; personal ones are rejected outright.
            </p>
          </div>

          {contributing && (
            <div className="flex items-center gap-3">
              <PrimaryButton onClick={() => void contributeNow()} busy={busy}>
                Share existing contacts
              </PrimaryButton>
              <span className="text-xs text-ink-500">
                Pushes contacts you already have. New ones go automatically.
              </span>
            </div>
          )}

          {note && <p className="text-sm text-success-600">{note}</p>}
          <ErrorText message={error} />
        </div>
      )}
    </Card>
  );
}

/**
 * Test a lookup — the answer to "is any of this real?"
 *
 * A search result cannot answer that question: it looks identical whether the
 * pipeline confirmed a mailbox or a vendor asserted something nobody checked.
 * This runs the whole thing against a name and company you pick and shows what
 * each stage actually did, so a null result says which stage was empty instead
 * of leaving somebody guessing.
 *
 * Run it on yourself first. You already know your own work address, so it
 * tells you immediately whether the machinery works.
 */
function TestLookupCard() {
  const [fullName, setFullName] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.diagnoseLookup(fullName, domain));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run that lookup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Test a lookup"
      description="Runs the full pipeline against one person without charging or saving anything. Try your own name and company domain — you already know the right answer, which makes it the honest test."
    >
      <form onSubmit={run} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className={INPUT_CLASS}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Marcia Delgado"
              required
              minLength={2}
            />
          </Field>
          <Field label="Company domain" hint="Just the domain — vantageresidential.com">
            <input
              className={INPUT_CLASS}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="vantageresidential.com"
              required
              minLength={3}
            />
          </Field>
        </div>
        <PrimaryButton type="submit" busy={busy}>
          Run lookup
        </PrimaryButton>
        <ErrorText message={error} />
      </form>

      {result && (
        <div className="mt-6 space-y-4 border-t border-line pt-5">
          <div
            className={`rounded-lg border p-4 text-sm ${
              result.wouldReturn
                ? 'border-success-200 bg-success-50 text-success-600'
                : 'border-caution-200 bg-caution-50 text-caution-600'
            }`}
          >
            {result.summary}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink-900">Sources</h3>
            <ul className="mt-2 space-y-1.5">
              {result.stages.length === 0 && (
                <li className="text-xs text-ink-500">No free sources are enabled.</li>
              )}
              {result.stages.map((stage) => (
                <li
                  key={stage.name}
                  className="flex items-center justify-between gap-3 rounded-lg glass-card px-3 py-2 text-xs"
                >
                  <span className="text-ink-800">{stage.name}</span>
                  <span className="text-ink-500">
                    {stage.directHit && <span className="text-success-600">held them · </span>}
                    {stage.evidenceFound} known {stage.evidenceFound === 1 ? 'address' : 'addresses'}
                    {' · '}
                    {stage.ms}ms
                    {stage.note ? ` · ${stage.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <ReadOnlyRow label="Evidence" value={`${result.evidenceTotal} addresses`} />
            <ReadOnlyRow
              label="Convention"
              value={
                result.inferredPattern
                  ? `${result.inferredPattern} (${result.patternSupport} agree)`
                  : 'none inferred'
              }
            />
            <ReadOnlyRow label="Verifier" value={result.mailboxVerifier ?? 'none configured'} />
          </dl>

          {result.candidates.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Addresses tried</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Masked on purpose — this runs the same machinery a paid reveal runs.
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.candidates.map((candidate) => (
                  <li
                    key={candidate.masked}
                    className="flex items-center justify-between gap-3 rounded-lg glass-card px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-ink-800">{candidate.masked}</span>
                    <span
                      title={candidate.reason}
                      className={
                        candidate.verdict === 'valid'
                          ? 'text-success-600'
                          : candidate.verdict === 'invalid'
                            ? 'text-danger-600'
                            : 'text-caution-600'
                      }
                    >
                      {candidate.verdict}
                      {candidate.verifier ? ` · ${candidate.verifier}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Sending email — connecting the mailbox campaigns go out from.
 *
 * Reachable during setup and forever after, because the mailbox is the thing
 * most likely to need reconnecting: people change jobs, revoke grants, and
 * rotate passwords, and a campaign that silently stops sending is worse than
 * one that never started.
 *
 * The page is explicit about what is being asked for. "Connect your email" is
 * the kind of phrase that gets clicked without thought; what we actually want
 * is permission to send as you and nothing else, and saying so is both more
 * honest and — in my experience of these consent screens — more likely to be
 * granted.
 */
function SendingSection() {
  const [state, setState] = useState<MailStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const [address, setAddress] = useState('');
  const [maxRecipients, setMaxRecipients] = useState(200);
  const [savedPolicy, setSavedPolicy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.mailStatus();
      setState(res);
      setAddress(res.policy?.postalAddress ?? '');
      setMaxRecipients(res.policy?.maxRecipients ?? 200);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'insufficient_role'
          ? 'Only an owner or admin can set up sending.'
          : err instanceof Error
            ? err.message
            : 'Could not load sending setup.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The provider sends the browser back here with ?code=&state=.
  useEffect(() => {
    const code = params.get('code');
    const oauthState = params.get('state');
    if (!code || !oauthState) return;
    const system = params.get('provider') ?? 'google_mail';

    setBusy(system);
    api
      .completeMailbox(system, code, oauthState)
      .then((res) => {
        setNote(`Connected — campaigns will send from ${res.address}.`);
        return load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not finish connecting.'))
      .finally(() => {
        setBusy(null);
        const next = new URLSearchParams(params);
        next.delete('code');
        next.delete('state');
        setParams(next, { replace: true });
      });
  }, [params, setParams, load]);

  async function connect(system: 'google_mail' | 'microsoft_mail') {
    setBusy(system);
    setError(null);
    try {
      const { url } = await api.connectMailbox(system);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that connection.');
      setBusy(null);
    }
  }

  async function disconnect(system: string) {
    setBusy(system);
    try {
      await api.disconnectMailbox(system);
      setNote('Disconnected. Campaigns will not send until a mailbox is connected again.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.saveSendPolicy({ postalAddress: address, maxRecipients });
      setSavedPolicy(true);
      setTimeout(() => setSavedPolicy(false), 2500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    }
  }

  const connectedSystems = new Set((state?.connected ?? []).map((c) => c.system));
  const hasMailbox = connectedSystems.size > 0;
  const hasAddress = Boolean(state?.policy?.postalAddress?.trim());

  return (
    <div className="space-y-5">
      <Card
        title="The mailbox campaigns send from"
        description="Campaign email goes out from your own address, so it lands like a note from a person and replies come straight back to you."
      >
        {!state ? (
          <p className="text-sm text-ink-600">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div
              className={`rounded-lg border p-4 text-sm ${
                hasMailbox && hasAddress
                  ? 'border-success-200 bg-success-50 text-success-600'
                  : 'border-caution-200 bg-caution-50 text-caution-600'
              }`}
            >
              {!hasMailbox ? (
                <>
                  <strong>No mailbox connected.</strong> Campaigns cannot send until one is.
                </>
              ) : !hasAddress ? (
                <>
                  <strong>Almost there.</strong> Add your postal address below — every commercial
                  email is legally required to carry one, and sending is blocked until it does.
                </>
              ) : (
                <>
                  <strong>Ready to send.</strong> {state.sentToday} sent today.
                </>
              )}
            </div>

            {state.providers.map((provider) => {
              const isConnected = connectedSystems.has(provider.id);
              const detail = state.connected.find((c) => c.system === provider.id);
              return (
                <div key={provider.id} className="rounded-lg glass-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink-900">{provider.name}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">{provider.note}</p>
                      {detail?.accountLabel && (
                        <p className="mt-1.5 text-xs text-success-600">
                          Sending as {detail.accountLabel}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isConnected ? (
                        <button
                          onClick={() => void disconnect(provider.id)}
                          disabled={busy === provider.id}
                          className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-paper-200/50 disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <PrimaryButton
                          onClick={() => void connect(provider.id)}
                          busy={busy === provider.id}
                          disabled={!provider.available || !state.vaultConfigured}
                        >
                          Connect
                        </PrimaryButton>
                      )}
                    </div>
                  </div>
                  {!provider.available && !isConnected && (
                    <p className="mt-2 text-xs text-caution-600">
                      Not configured on this deployment.
                    </p>
                  )}
                </div>
              );
            })}

            {note && <p className="text-sm text-success-600">{note}</p>}
            <ErrorText message={error} />
          </div>
        )}
      </Card>

      <Card
        title="What every email must carry"
        description="US law requires a physical postal address and a working unsubscribe in every commercial email. We add both automatically — the address has to be yours."
      >
        <form onSubmit={savePolicy} className="space-y-4">
          <Field
            label="Your postal address"
            hint="Appears at the foot of every campaign email. A PO box is fine."
          >
            <input
              className={INPUT_CLASS}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Atmosphere Restoration, 100 Congress Ave, Austin TX 78701"
            />
          </Field>
          <Field
            label="Most people one campaign may reach"
            hint="A wall, not a target. An audience rule that unexpectedly matches four thousand people should stop here rather than send."
          >
            <input
              type="number"
              min={1}
              max={5000}
              className={INPUT_CLASS}
              value={maxRecipients}
              onChange={(e) => setMaxRecipients(Number(e.target.value))}
            />
          </Field>
          <div className="flex items-center gap-3">
            <PrimaryButton type="submit">Save</PrimaryButton>
            <Saved show={savedPolicy} />
          </div>
        </form>
      </Card>

      <Card
        title="What we can and cannot do with your mailbox"
        description="Worth being precise about, because the permission screen goes past quickly."
      >
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium text-ink-800">We can send</dt>
            <dd className="mt-0.5 text-ink-600">
              Messages you have written, to people your campaign rules select. They appear in your
              Sent folder like anything else you send.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-800">We cannot read</dt>
            <dd className="mt-0.5 text-ink-600">
              The permission requested is send-only. There is no version of this connection that
              can open a message in your inbox — not your mail, not your contacts, not your
              calendar.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-800">You can revoke it without us</dt>
            <dd className="mt-0.5 text-ink-600">
              From your Google or Microsoft account settings, at any time. Disconnecting here does
              the same thing.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
