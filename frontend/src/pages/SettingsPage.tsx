import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  CONTRACTOR_TYPE_LABELS,
  CONTRACTOR_TYPE_ORDER,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type ContractorType,
  type OrgMember,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { BillingSection } from '../components/settings/BillingSection';
import { InvitePanel } from '../components/team/InvitePanel';
import { displayName, nameFromMetadata } from '../lib/display';
import { AVATAR_ACCEPT, prepareAvatarUpload } from '../lib/avatarImage';
import { PersonAvatar } from '../components/PersonAvatar';
import { setPreference, usePreferences, type Preferences } from '../lib/preferences';
import {
  BuildingIcon,
  CameraIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LogOutIcon,
  ShieldIcon,
  SlidersIcon,
  SpinnerIcon,
  UserIcon,
  CreditCardIcon,
} from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

type SectionId = 'profile' | 'security' | 'organization' | 'billing' | 'preferences';

interface SettingsSection {
  id: SectionId;
  label: string;
  blurb: string;
  icon: typeof UserIcon;
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
    id: 'billing',
    label: 'Billing',
    blurb: 'Plan, usage, and receipts',
    icon: CreditCardIcon,
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
  const requested: SectionId = isSectionId(raw) ? raw : 'profile';
  const active: SectionId = SECTIONS.some((s) => s.id === requested) ? requested : 'profile';
  const outlet = useOutletContext<{ chrome?: string } | null>();
  const inShell = outlet?.chrome === 'operations';

  function select(section: SectionId) {
    setParams(section === 'profile' ? {} : { section }, { replace: false });
  }

  return (
    <div className={inShell ? '' : 'min-h-screen bg-paper-100'}>
      {!inShell && (
        <header className="border-b border-line bg-paper-0/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Logo />
            <ThemeToggle />
          </div>
        </header>
      )}
      <div className={inShell ? 'mx-auto max-w-5xl' : 'mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10'}>
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Settings</h1>
          <p className="mt-1.5 text-sm text-ink-600">
            Manage your account, organization, and how Atmosphere behaves on this device.
          </p>
        </header>

        <nav className="mt-8 border-b border-line" aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto pb-px">
            {SECTIONS.map((section) => {
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile arrives asynchronously; adopt it unless the user has already
  // started typing, which would otherwise be overwritten mid-edit.
  useEffect(() => {
    const incoming = profile?.fullName || nameFromMetadata(user?.metadata) || '';
    setName((current) => (current === '' ? incoming : current));
  }, [profile?.fullName, user?.metadata]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const storedName = profile?.fullName ?? '';
  const dirty = name.trim() !== storedName;
  const avatarUrl = previewUrl || profile?.avatarUrl || null;

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

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareAvatarUpload(file);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return prepared.previewUrl;
      });
      const { profile: updated } = await api.uploadAvatar({
        filename: prepared.filename,
        mediaType: prepared.mediaType,
        contentBase64: prepared.contentBase64,
      });
      setProfile(updated);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not update that photo.');
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setUploading(true);
    setError(null);
    try {
      const { profile: updated } = await api.removeAvatar();
      setProfile(updated);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that photo.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Card
        title="Your profile"
        description="This is how teammates see you in the linked accounts list."
      >
        <div className="flex items-center gap-4">
          <label className="relative shrink-0 cursor-pointer">
            <PersonAvatar
              fullName={name || profile?.fullName}
              email={user?.email}
              avatarUrl={avatarUrl}
              size="lg"
            />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-ink-900/45 text-white opacity-0 transition hover:opacity-100">
              {uploading ? (
                <SpinnerIcon className="animate-spin" width={18} height={18} />
              ) : (
                <CameraIcon width={18} height={18} />
              )}
            </span>
            <input
              type="file"
              accept={AVATAR_ACCEPT}
              className="sr-only"
              aria-label="Upload a profile photo or icon"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void onPickPhoto(file);
              }}
            />
          </label>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-900">
              {displayName(name || profile?.fullName, user?.email)}
            </p>
            <p className="truncate text-sm text-ink-500">{user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="cursor-pointer text-sm font-medium text-brand-700 transition hover:text-brand-800">
                {profile?.avatarUrl || previewUrl ? 'Change photo' : 'Upload photo or icon'}
                <input
                  type="file"
                  accept={AVATAR_ACCEPT}
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void onPickPhoto(file);
                  }}
                />
              </label>
              {(profile?.avatarUrl || previewUrl) && (
                <button
                  type="button"
                  onClick={() => void removePhoto()}
                  disabled={uploading}
                  className="text-sm font-medium text-ink-600 transition hover:text-ink-900 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
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
            {CONTRACTOR_TYPE_ORDER.map((value) => (
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
                  <PersonAvatar
                    fullName={member.fullName}
                    email={member.email}
                    avatarUrl={member.avatarUrl}
                    size="sm"
                  />
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
 * How Field Capture attaches to this office. Crew sign in with the same
 * email and password as the Platform; the join code is for new teammates.
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
      description="Crew sign in with the same Atmosphere email and password as the office Platform. The join code is for new teammates linking their account."
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
        <li>
          Open Field Capture on the phone — the web app at{' '}
          <a
            href="https://field-capture-production.up.railway.app/"
            className="font-medium text-ink-900 underline decoration-line underline-offset-2"
          >
            field-capture-production.up.railway.app
          </a>
          , or <code className="font-mono text-xs">/fieldcapture/</code> on this
          office site.
        </li>
        <li>
          They sign in with their <strong className="font-semibold text-ink-900">office email and password</strong>
          — the same login as this Platform.
          {joinCode ? (
            <>
              {' '}
              New teammates can still link a new account with this code (or open{' '}
              <code className="font-mono text-xs">atmosphere-field://join?code={joinCode}</code>
              ).
            </>
          ) : null}
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

