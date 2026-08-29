import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  CONTRACTOR_TYPE_LABELS,
  CONTRACTOR_TYPE_ORDER,
  type ContractorType,
} from '../lib/api';
import { loginHref, parseSignupIntent, resolveAuthRedirect } from '../lib/authRedirect';
import { PLATFORM_HOME } from '../lib/platforms';
import { usePendingAuthRedirect } from '../hooks/usePendingAuthRedirect';
import { getPlatform } from '../lib/usePlatform';
import { SetupStepCard, SetupWizardShell } from '../components/setup/SetupWizardShell';
import { SetupBillingStep } from '../components/setup/SetupBillingStep';
import {
  SETUP_DEFAULTS,
  initialSetupStep,
  workspaceNameFrom,
  type SetupWizardStep,
} from '../components/setup/setupWizard';
import {
  resolveVerifierSetup,
  workTypeForContractorType,
} from '../components/setup/verifierSetupOptions';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';
import { isFieldEmbedMarked, withFieldEmbed } from '../lib/fieldEmbed';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JOIN_CODE_RE = /^[A-Za-z0-9]{6,12}$/;

type OrgMode = 'create' | 'join';

export function SignupPage() {
  const { user, loading, membership, signup, refreshMembership, logout } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queueRedirect = usePendingAuthRedirect();
  const redirectTo = resolveAuthRedirect(
    searchParams.get('next'),
    (location.state as { from?: string } | null)?.from,
    PLATFORM_HOME[getPlatform()],
  );

  const [step, setStep] = useState<SetupWizardStep>(() =>
    initialSetupStep({
      user: Boolean(user),
      membership: Boolean(membership),
      stepParam: searchParams.get('step'),
    }),
  );
  const orgIntent = parseSignupIntent(searchParams.get('intent'));

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<OrgMode>(orgIntent === 'join' ? 'join' : 'create');
  const [orgName, setOrgName] = useState('');
  const [contractorType, setContractorType] = useState<ContractorType | null>(null);
  const [joinCode, setJoinCode] = useState(() => (searchParams.get('code') ?? '').toUpperCase());

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checkoutOutcome = searchParams.get('checkout');
  const checkoutParam =
    checkoutOutcome === 'success' || checkoutOutcome === 'cancelled' ? checkoutOutcome : null;

  const goToStep = useCallback(
    (next: SetupWizardStep) => {
      setStep(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('step', String(next));
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (orgIntent === 'join') setMode('join');
  }, [orgIntent]);

  useEffect(() => {
    const fromLink = (searchParams.get('code') ?? '').toUpperCase();
    if (fromLink && JOIN_CODE_RE.test(fromLink)) setJoinCode(fromLink);
  }, [searchParams]);

  useEffect(() => {
    if (accountSubmitting) return;
    if (!loading && user && !membership && step === 1) {
      goToStep(2);
    }
  }, [loading, user, membership, step, accountSubmitting, goToStep]);

  useEffect(() => {
    if (step !== 2 || mode !== 'create' || orgName.trim()) return;
    const suggested = workspaceNameFrom(fullName, email);
    if (suggested) setOrgName(suggested);
  }, [step, mode, fullName, email, orgName]);

  useEffect(() => {
    if (loading || !user || !membership) return;

    let cancelled = false;
    (async () => {
      try {
        const status = await api.getBillingOnboarding();
        if (cancelled) return;
        const needsBilling = status.required && !status.complete;
        const stepParam = searchParams.get('step');
        if (needsBilling && (stepParam === '3' || stepParam === '4' || stepParam === '5' || checkoutParam)) {
          setStep(3);
        }
      } catch {
        /* stay on the current step */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, membership, searchParams, checkoutParam]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (isFieldEmbedMarked()) {
    return <Navigate to={withFieldEmbed(redirectTo === '/signup' || redirectTo.startsWith('/signup') ? '/verifier-library' : redirectTo)} replace />;
  }

  const signInHref = loginHref(redirectTo);
  const nameValid = fullName.trim().length >= 2;
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const joinCodeValid = JOIN_CODE_RE.test(joinCode.trim());
  const orgStepValid =
    mode === 'join' ? joinCodeValid : orgName.trim().length >= 2 && Boolean(contractorType);

  function enterApp() {
    queueRedirect(redirectTo);
  }

  async function continueAfterWorkspace() {
    try {
      const status = await api.getBillingOnboarding();
      const needsBilling = status.required && !status.complete;
      if (needsBilling) {
        goToStep(3);
        return;
      }
      enterApp();
    } catch {
      goToStep(3);
    }
  }

  async function completeWorkspace() {
    setSubmitting(true);
    setError(null);
    try {
      const already = await refreshMembership();
      if (already?.org) {
        await continueAfterWorkspace();
        return;
      }

      const { role: finalRole, usageIntents } = resolveVerifierSetup(
        mode === 'join' ? 'employee' : SETUP_DEFAULTS.role,
        SETUP_DEFAULTS.trade,
        mode !== 'join',
      );

      if (mode === 'join') {
        await api.joinOrg(
          joinCode.trim().toUpperCase(),
          'employee',
          SETUP_DEFAULTS.workType,
          usageIntents.length ? usageIntents : ['field_work', 'exploring'],
        );
      } else {
        if (!contractorType) {
          setError('Select a company type.');
          goToStep(2);
          return;
        }
        await api.createOrg(
          orgName.trim(),
          finalRole,
          workTypeForContractorType(contractorType),
          contractorType,
          usageIntents,
        );
      }

      await refreshMembership();
      await continueAfterWorkspace();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      goToStep(2);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountNotice(null);
    if (!nameValid || !emailValid || !passwordValid || accountSubmitting) return;

    setAccountSubmitting(true);
    try {
      if (user) {
        await logout();
      }
      const res = await signup(email.trim(), password);
      if (res.needsEmailConfirmation) {
        if (res.user?.emailConfirmed) {
          setError('An account with this email already exists. Sign in instead.');
          return;
        }
        setAccountNotice(
          res.message ?? 'Account created. Check your email to confirm before continuing.',
        );
        setPassword('');
        return;
      }
      if (fullName.trim()) {
        await api.updateProfile(fullName.trim());
        await refreshMembership();
      }
      if (res.membership?.org) {
        await continueAfterWorkspace();
        return;
      }
      goToStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setAccountSubmitting(false);
    }
  }

  return (
    <SetupWizardShell
      step={step}
      intent={orgIntent}
      onStepSelect={goToStep}
      headerAction={
        user ? (
          <button
            type="button"
            onClick={() => logout()}
            className="text-sm text-ink-600 transition hover:text-ink-900"
          >
            Sign out
          </button>
        ) : undefined
      }
    >
      {step === 1 && (
        <SetupStepCard
          step={1}
          intent={orgIntent}
          title="Create your account"
          subtitle="Name, email, and a password — then the workspace on the next screen."
        >
          {user?.email && !accountSubmitting && (
            <p className="mt-6 text-sm text-ink-600">
              You&apos;re signed in as <span className="font-medium text-ink-900">{user.email}</span>.
              Creating a new account will switch you to that login, or{' '}
              <button
                type="button"
                onClick={() => logout()}
                className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
              >
                sign out
              </button>{' '}
              first.
            </p>
          )}
          {accountNotice && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-600"
            >
              <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
              <span>
                {accountNotice}{' '}
                <Link to={signInHref} className="font-semibold underline underline-offset-2">
                  Sign in
                </Link>{' '}
                once your email is confirmed.
              </span>
            </div>
          )}

          {error && (
            <Alert>
              {error}{' '}
              {looksLikeExistingAccount(error) ? (
                <Link to={signInHref} className="font-semibold underline underline-offset-2">
                  Sign in
                </Link>
              ) : null}
            </Alert>
          )}

          <form onSubmit={handleAccountSubmit} noValidate className="mt-6 space-y-4">
            <Field label="Your name" htmlFor="signup-name">
              <input
                id="signup-name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="First and last name"
                className={inputClass}
              />
            </Field>

            <Field label="Work email" htmlFor="signup-email">
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
              />
            </Field>

            <Field label="Password" htmlFor="signup-password" hint="Min. 8 characters">
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a strong password"
                  className={`${inputClass} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-600"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </Field>

            <PrimaryButton
              type="submit"
              disabled={!nameValid || !emailValid || !passwordValid || accountSubmitting}
              loading={accountSubmitting}
            >
              {accountSubmitting ? 'Creating account…' : 'Continue to workspace'}
            </PrimaryButton>
          </form>
        </SetupStepCard>
      )}

      {step === 2 && (
        <SetupStepCard
          step={2}
          intent={orgIntent}
          title={mode === 'join' ? 'Enter your join code' : 'Your workspace'}
          subtitle={
            mode === 'join'
              ? 'Use the invite from your Global Admin — create the account with the invited email, then enter the join code.'
              : 'You are creating this company as Global Admin. Invite Employees afterward from Settings.'
          }
        >
          {error && <Alert>{error}</Alert>}

          {mode === 'create' ? (
            <>
              <Field label="Company name" htmlFor="org-name" className="mt-5">
                <input
                  id="org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Meridian Services"
                  autoFocus
                  className={inputClass}
                />
              </Field>
              <Field label="Company type" htmlFor="org-contractor-type" className="mt-4">
                <select
                  id="org-contractor-type"
                  value={contractorType ?? ''}
                  onChange={(e) =>
                    setContractorType((e.target.value || null) as ContractorType | null)
                  }
                  className={inputClass}
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
                <p className="mt-2 text-xs text-ink-500">
                  Were you invited by your office? Open the link in that email — only invited
                  people can join an existing workspace.
                </p>
              </Field>
            </>
          ) : (
            <Field label="Join code" htmlFor="join-code" className="mt-5">
              <input
                id="join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. 8F3A9C2B"
                autoFocus
                autoCapitalize="characters"
                className={`${inputClass} font-mono tracking-widest`}
              />
              <p className="mt-2 text-xs text-ink-500">
                Starting a new company as Global Admin?{' '}
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  Name a workspace
                </button>
              </p>
            </Field>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            {user ? (
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="text-sm font-medium text-ink-600 hover:text-ink-900"
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <PrimaryButton
              disabled={!orgStepValid || submitting}
              loading={submitting}
              onClick={() => {
                setError(null);
                void completeWorkspace();
              }}
            >
              {submitting ? 'Setting up…' : 'Continue'}
            </PrimaryButton>
          </div>
        </SetupStepCard>
      )}

      {step === 3 && membership && (
        <SetupBillingStep
          redirectTo={redirectTo}
          checkoutOutcome={checkoutParam}
          nextLabel="Enter Atmosphere"
          onComplete={enterApp}
        />
      )}

      {step === 3 && !membership && (
        <SetupStepCard
          step={3}
          intent={orgIntent}
          title="Set up billing"
          subtitle="Add a payment method to activate the workspace."
        >
          <div className="mt-6 rounded-xl border border-line bg-paper-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
              Work Verification
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-ink-900">
              $599
              <span className="text-base font-medium text-ink-500"> / month</span>
            </p>
          </div>
          <div className="mt-7 flex justify-end">
            <PrimaryButton onClick={() => goToStep(2)}>Continue to workspace</PrimaryButton>
          </div>
        </SetupStepCard>
      )}

      <p className="mt-6 text-center text-xs text-ink-400">
        Passwords are encrypted, never stored in plain text, and never seen by this page.
      </p>
    </SetupWizardShell>
  );
}

function looksLikeExistingAccount(message: string): boolean {
  return /already exist/i.test(message);
}

const inputClass =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
    >
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700">
          {label}
        </label>
        {hint ? <span className="text-xs text-ink-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  loading,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[180px]"
    >
      {loading && <SpinnerIcon className="animate-spin" />}
      {children}
    </button>
  );
}
