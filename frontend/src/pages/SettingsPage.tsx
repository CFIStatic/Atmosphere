import {
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
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type MemberRole,
  type WorkType,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { PinSetupCard } from '../components/PinSetupCard';
import { displayName, initials } from '../lib/display';
import { setPreference, usePreferences, type Preferences } from '../lib/preferences';
import {
  BuildingIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LogOutIcon,
  ShieldIcon,
  SlidersIcon,
  SpinnerIcon,
  UserIcon,
} from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

type SectionId = 'profile' | 'security' | 'organization' | 'preferences';

const SECTIONS: {
  id: SectionId;
  label: string;
  blurb: string;
  icon: typeof UserIcon;
}[] = [
  { id: 'profile', label: 'Profile', blurb: 'Your name and account details', icon: UserIcon },
  { id: 'security', label: 'Security', blurb: 'Password and PIN sign-in', icon: ShieldIcon },
  {
    id: 'organization',
    label: 'Organization',
    blurb: 'Your org, invite code, and role',
    icon: BuildingIcon,
  },
  { id: 'preferences', label: 'Preferences', blurb: 'How this device behaves', icon: SlidersIcon },
];

function isSectionId(value: string | null): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

export function SettingsPage() {
  useFeatureTimer('settings');
  // The section lives in the URL so a settings link can point at one directly
  // and the browser's back button steps between them.
  const [params, setParams] = useSearchParams();
  const raw = params.get('section');
  const active: SectionId = isSectionId(raw) ? raw : 'profile';

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
              {SECTIONS.map((section) => {
                const isActive = section.id === active;
                return (
                  <li key={section.id} className="shrink-0 lg:shrink">
                    <button
                      onClick={() => select(section.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-ink-600 hover:bg-paper-0 hover:text-ink-900'
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
        tone === 'danger' ? 'border-danger-200 bg-danger-50' : 'border-line bg-paper-0 shadow-card'
      }`}
    >
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-600">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-sm text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:opacity-60';

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
      className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
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

function OrganizationSection() {
  const { membership, refreshMembership } = useAuth();
  const [role, setRole] = useState<MemberRole | null>(membership?.role ?? null);
  const [workType, setWorkType] = useState<WorkType | null>(membership?.workType ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRole(membership?.role ?? null);
    setWorkType(membership?.workType ?? null);
  }, [membership?.role, membership?.workType]);

  const org = membership?.org;
  const dirty = useMemo(
    () => role !== membership?.role || workType !== membership?.workType,
    [role, workType, membership?.role, membership?.workType],
  );

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
    if (!role || !workType) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateMembership(role, workType);
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
        <p className="mt-4 text-xs text-ink-500">
          Share the invite code so teammates can link their account to {org?.name ?? 'your org'}.
          Renaming an organization isn't available yet.
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
                <option key={value} value={value} className="bg-paper-0">
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
                <option key={value} value={value} className="bg-paper-0">
                  {WORK_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={save} busy={saving} disabled={!dirty}>
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

const TOGGLES: { key: keyof Preferences; label: string; description: string }[] = [
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
      </div>
    </Card>
  );
}
