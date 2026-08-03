import {
  useCallback,
  useEffect,
  useMemo,
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
  USAGE_INTENT_LABELS,
  WORK_TYPE_LABELS,
  type ContractorType,
  type CrmConnections,
  type Diagnosis,
  type Integration,
  type MemberRole,
  type UsageIntent,
  type WorkType,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { PinSetupCard } from '../components/PinSetupCard';
import { displayName, initials } from '../lib/display';
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
} from '../components/icons';

type SectionId =
  | 'profile'
  | 'security'
  | 'organization'
  | 'integrations'
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
  { id: 'security', label: 'Security', blurb: 'Password and PIN sign-in', icon: ShieldIcon },
  {
    id: 'organization',
    label: 'Organization',
    blurb: 'Your org, invite code, and role',
    icon: BuildingIcon,
  },
  {
    id: 'integrations',
    label: 'Connected apps',
    blurb: 'Your CRM and the data we mirror from it',
    icon: BuildingIcon,
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
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">Settings</h1>
          <p className="mt-1.5 text-sm text-ink-600">
            Manage your account, how you sign in, and how Atmosphere behaves on this device.
          </p>
        </header>

        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-10">
          {/* Section nav: a rail beside the content on wide screens, a row of
              tabs above it on narrow ones. */}
          <nav className="lg:w-60 lg:shrink-0">
            <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
              {visible.map((section) => {
                const isActive = section.id === active;
                return (
                  <li key={section.id} className="shrink-0 lg:shrink">
                    <button
                      onClick={() => select(section.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
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

          <div className="min-w-0 flex-1 space-y-6">
            {active === 'profile' && <ProfileSection />}
            {active === 'security' && <SecuritySection />}
            {active === 'organization' && <OrganizationSection />}
            {active === 'integrations' && <IntegrationsSection />}
            {active === 'contactdata' && <ContactDataSection />}
            {active === 'preferences' && <PreferencesSection />}
          </div>
        </div>
      </div>
    </AppShell>
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
  const [name, setName] = useState(profile?.fullName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile arrives asynchronously; adopt it unless the user has already
  // started typing, which would otherwise be overwritten mid-edit.
  useEffect(() => {
    setName((current) => (current === '' ? (profile?.fullName ?? '') : current));
  }, [profile?.fullName]);

  const dirty = name.trim() !== (profile?.fullName ?? '');

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
      <PinSetupCard />
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
      description="Ends the session on this device. Your PIN stays set up, so you can come straight back in with it."
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

const ROLE_ORDER: MemberRole[] = [
  'project_manager',
  'field_technician',
  'accountant',
  'office_manager',
  'sales',
];
const WORK_ORDER: WorkType[] = ['mitigation', 'construction'];
const CONTRACTOR_ORDER: ContractorType[] = [
  'restoration',
  'roofing',
  'general_contractor',
  'other',
];
const USAGE_ORDER: UsageIntent[] = [
  'mitigation_estimating',
  'construction_estimating',
  'project_management',
  'crm',
  'web_access',
  'field_work',
  'billing',
  'exploring',
];

function sameUsageIntents(a: UsageIntent[] | undefined, b: UsageIntent[] | undefined) {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function OrganizationSection() {
  const { membership, refreshMembership } = useAuth();
  const [role, setRole] = useState<MemberRole | null>(membership?.role ?? null);
  const [workType, setWorkType] = useState<WorkType | null>(membership?.workType ?? null);
  const [usageIntents, setUsageIntents] = useState<UsageIntent[]>(membership?.usageIntents ?? []);
  const [contractorType, setContractorType] = useState<ContractorType | null>(
    membership?.org?.contractorType ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRole(membership?.role ?? null);
    setWorkType(membership?.workType ?? null);
    setUsageIntents(membership?.usageIntents ?? []);
    setContractorType(membership?.org?.contractorType ?? null);
  }, [
    membership?.role,
    membership?.workType,
    membership?.usageIntents,
    membership?.org?.contractorType,
  ]);

  const org = membership?.org;
  const dirty = useMemo(
    () =>
      role !== membership?.role ||
      workType !== membership?.workType ||
      !sameUsageIntents(usageIntents, membership?.usageIntents) ||
      contractorType !== (membership?.org?.contractorType ?? null),
    [
      role,
      workType,
      usageIntents,
      contractorType,
      membership?.role,
      membership?.workType,
      membership?.usageIntents,
      membership?.org?.contractorType,
    ],
  );

  function toggleUsage(intent: UsageIntent) {
    setUsageIntents((current) =>
      current.includes(intent) ? current.filter((value) => value !== intent) : [...current, intent],
    );
  }

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
    if (!role || !workType || usageIntents.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const contractorChanged = contractorType !== (membership?.org?.contractorType ?? null);
      if (contractorChanged && contractorType) {
        await api.updateOrgProfile(contractorType);
      }
      await api.updateMembership(role, workType, usageIntents);
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
    <>
      <Card title="Organization" description="The organization your account is linked to.">
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
        <p className="mt-4 text-xs text-ink-500">
          Share the invite code so teammates can link their account to {org?.name ?? 'your org'}.
          Renaming an organization isn't available yet. Only the org creator can change the company
          type once it is set.
        </p>
      </Card>

      <Card
        title="Your role"
        description="Keep this current if what you do changes — teammates see it in the members list."
      >
        <div className="space-y-5">
          <Field label="Account type">
            <select
              value={role ?? ''}
              onChange={(event) => setRole(event.target.value as MemberRole)}
              className={`mt-2 ${INPUT_CLASS}`}
            >
              {ROLE_ORDER.map((value) => (
                <option key={value} value={value} className="bg-paper-200/50">
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kind of work">
            <select
              value={workType ?? ''}
              onChange={(event) => setWorkType(event.target.value as WorkType)}
              className={`mt-2 ${INPUT_CLASS}`}
            >
              {WORK_ORDER.map((value) => (
                <option key={value} value={value} className="bg-paper-200/50">
                  {WORK_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How you use Atmosphere">
            <div className="mt-2 space-y-2">
              {USAGE_ORDER.map((value) => {
                const checked = usageIntents.includes(value);
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 transition ${
                      checked
                        ? 'border-brand-400 bg-brand-50'
                        : 'glass-card hover:bg-paper-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUsage(value)}
                      className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    />
                    <span className="text-sm font-medium text-ink-900">
                      {USAGE_INTENT_LABELS[value]}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton
              onClick={save}
              busy={saving}
              disabled={!dirty || usageIntents.length === 0}
            >
              Save changes
            </PrimaryButton>
            <Saved show={saved} />
            <ErrorText message={error} />
          </div>
        </div>
      </Card>
    </>
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

function PreferencesSection() {
  const preferences = usePreferences();

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

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Appearance</p>
            <p className="mt-0.5 text-sm text-ink-600">
              Dark is the console's home; light is here when the sun wins.
            </p>
          </div>
          <div className="flex rounded-lg glass-card p-1">
            {(['dark', 'light'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreference('theme', mode)}
                aria-pressed={preferences.theme === mode}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  preferences.theme === mode
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {mode}
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
 * Connected apps — the customer's own CRM, mirrored.
 *
 * The screen has one job beyond the buttons: make the difference between the
 * two ways of connecting legible, because they are not equivalent and a
 * customer choosing between them deserves to know why.
 *
 * Authorising (Salesforce) means they approve us in their vendor's own UI. We
 * never see a password, their MFA keeps working, and they can cut us off from
 * their admin screen without telling us.
 *
 * Signing in (a CRM with no API) means we hold their password and type it in
 * like a person. It is a real risk they are taking deliberately, so the card
 * says that in those words rather than dressing it as "connecting".
 */
function IntegrationsSection() {
  const [state, setState] = useState<CrmConnections | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setState(await api.crmConnections());
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'insufficient_role'
          ? 'Only an owner or admin can manage connected apps.'
          : err instanceof Error
            ? err.message
            : 'Could not load connections.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Salesforce sends the browser back here with ?code=&state=. Completing the
  // exchange server-side is what keeps the client secret off the client.
  useEffect(() => {
    const code = params.get('code');
    const oauthState = params.get('state');
    if (!code || !oauthState) return;

    setBusy('salesforce');
    api
      .completeSalesforce(code, oauthState)
      .then((res) => {
        setNote(`Salesforce connected${res.accountLabel ? ` — ${res.accountLabel}` : ''}.`);
        return load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not finish connecting.'))
      .finally(() => {
        setBusy(null);
        // Clear the code from the URL so a refresh does not replay a spent one.
        const next = new URLSearchParams(params);
        next.delete('code');
        next.delete('state');
        setParams(next, { replace: true });
      });
  }, [params, setParams, load]);

  async function connect() {
    setBusy('salesforce');
    setError(null);
    try {
      const { url } = await api.connectSalesforce();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that connection.');
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('salesforce');
    setError(null);
    setNote(null);
    try {
      const res = await api.disconnectSalesforce();
      setNote(
        res.revokedAtSalesforce
          ? 'Disconnected and revoked at Salesforce.'
          : 'Disconnected here. Salesforce did not confirm the revocation — revoke it in Setup → Connected Apps to be certain.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  const connectedSystems = new Set((state?.connected ?? []).map((c) => c.system));

  return (
    <div className="space-y-5">
      <Card
        title="Your CRM"
        description="Mirror the customers, contacts and opportunities you already have, so prospecting knows who you know and never sells you a contact you own."
      >
        {!state ? (
          <p className="text-sm text-ink-600">Loading…</p>
        ) : (
          <div className="space-y-3">
            {state.available.map((crm) => {
              const isConnected = connectedSystems.has(crm.id);
              const detail = state.connected.find((c) => c.system === crm.id);
              const canOauth = crm.method === 'oauth' && state.salesforceConfigured && state.vaultConfigured;

              return (
                <div key={crm.id} className="rounded-lg glass-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink-900">{crm.name}</h3>
                        <MethodBadge method={crm.method} />
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">{crm.note}</p>
                      {detail && (
                        <p className="mt-1.5 text-xs text-success-600">
                          Connected{detail.accountLabel ? ` — ${detail.accountLabel}` : ''}
                        </p>
                      )}
                    </div>

                    {crm.method === 'oauth' && (
                      <div className="shrink-0">
                        {isConnected ? (
                          <button
                            onClick={() => void disconnect()}
                            disabled={busy === crm.id}
                            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-paper-200/50 disabled:opacity-50"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <PrimaryButton onClick={() => void connect()} busy={busy === crm.id} disabled={!canOauth}>
                            Authorise
                          </PrimaryButton>
                        )}
                      </div>
                    )}
                  </div>

                  {/* A disabled button with no explanation is a dead end. */}
                  {crm.method === 'oauth' && !canOauth && !isConnected && (
                    <p className="mt-2 text-xs text-caution-600">
                      {!state.salesforceConfigured
                        ? 'Needs SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET on the server.'
                        : 'Needs INTEGRATIONS_OAUTH_KEY so the grant can be encrypted at rest.'}
                    </p>
                  )}
                  {crm.method === 'browser' && !state.browserCrmEnabled && (
                    <p className="mt-2 text-xs text-caution-600">
                      Browser sign-in is switched off on this deployment. Turn it on with
                      INTEGRATIONS_BROWSER_CRM=true, then add the login under Web access.
                    </p>
                  )}
                  {crm.method === 'browser' && state.browserCrmEnabled && (
                    <p className="mt-2 text-xs text-ink-500">
                      Set the sign-in up under Web access — the same vault and audit trail as your
                      carrier portals.
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
        title="Why authorising beats a password"
        description="Both routes reach the same data. They are not the same risk, and where a CRM offers the first we use it."
      >
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium text-ink-800">Authorising</dt>
            <dd className="mt-0.5 text-ink-600">
              You approve us inside your CRM, seeing exactly what is being asked for. We never
              learn your password, your multi-factor login keeps working, and you can revoke us
              from your own admin screen without contacting us. The grant is encrypted before it
              is stored, under a key that is not in the database.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-800">Signing in as you</dt>
            <dd className="mt-0.5 text-ink-600">
              For CRMs that publish no API. We hold your password and type it in the way you
              would, which means it defeats your multi-factor login and breaks whenever you change
              it. It is encrypted at rest and only ever sent to the one site you named — but it is
              a larger thing to hand over, and it is only offered where there is no alternative.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function MethodBadge({ method }: { method: 'oauth' | 'browser' | 'rest' }) {
  const style =
    method === 'oauth'
      ? 'bg-success-50 text-success-600'
      : method === 'rest'
        ? 'bg-brand-50 text-brand-700'
        : 'bg-caution-50 text-caution-600';
  const label = method === 'oauth' ? 'authorise' : method === 'rest' ? 'API' : 'browser sign-in';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${style}`}>{label}</span>
  );
}
