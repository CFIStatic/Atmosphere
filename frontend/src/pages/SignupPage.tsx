import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
} from '../lib/api';
import { loginHref, parseSignupIntent, resolveAuthRedirect } from '../lib/authRedirect';
import { PLATFORM_HOME } from '../lib/platforms';
import { usePendingAuthRedirect } from '../hooks/usePendingAuthRedirect';
import { getPlatform } from '../lib/usePlatform';
import { SetupStepCard, SetupWizardShell } from '../components/setup/SetupWizardShell';
import { SetupBillingStep } from '../components/setup/SetupBillingStep';
import { scheduleWorkVerificationTour } from '../components/tour/ProductTourHost';
import { withTourQuery } from '../lib/productTour';
import {
  SETUP_DEFAULTS,
  initialSetupStep,
  workspaceNameFrom,
  type SetupWizardStep,
} from '../components/setup/setupWizard';
import { resolveVerifierSetup } from '../components/setup/verifierSetupOptions';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JOIN_CODE_RE = /^[A-Za-z0-9]{6,12}$/;

type OrgMode = 'create' | 'join';

export function SignupPage() {
  const { user, loading, membership, signup, refreshMembership, logout } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
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
  const [joinCode, setJoinCode] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [billingGate, setBillingGate] = useState<'loading' | 'pending' | 'complete'>('loading');

  const checkoutOutcome = searchParams.get('checkout');
  const checkoutParam =
    checkoutOutcome === 'success' || checkoutOutcome === 'cancelled' ? checkoutOutcome : null;

  useEffect(() => {
    document.title = 'Create an account · Atmosphere';
    return () => {
      document.title = 'Atmosphere';
    };
  }, []);

  useEffect(() => {
    if (orgIntent === 'join') setMode('join');
  }, [orgIntent]);

  useEffect(() => {
    if (accountSubmitting || submitting) return;
    if (!loading && user && !membership && step === 1) {
      setStep(2);
    }
  }, [loading, user, membership, step, accountSubmitting, submitting]);

  useEffect(() => {
    if (loading || !user || !membership) {
      if (!membership) setBillingGate('complete');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const status = await api.getBillingOnboarding();
        if (cancelled) return;
        const needsBilling = status.required && !status.complete;
        setBillingGate(needsBilling ? 'pending' : 'complete');
        const stepParam = searchParams.get('step');
        if (needsBilling && (stepParam === '4' || stepParam === '5' || checkoutParam)) {
          setStep(4);
        }
      } catch {
        if (!cancelled) setBillingGate('complete');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, membership, searchParams, checkoutParam]);

  if (loading || (user && membership && billingGate === 'loading')) {
    return (
      <div className="cx-aurora grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (user && membership && billingGate === 'complete' && step !== 4) {
    return <Navigate to={redirectTo} replace />;
  }

  const signInHref = loginHref(redirectTo);
  const nameValid = fullName.trim().length >= 2;
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const joinCodeValid = JOIN_CODE_RE.test(joinCode.trim());
  const orgStepValid = mode === 'join' ? joinCodeValid : true;

  function enterApp() {
    scheduleWorkVerificationTour();
    queueRedirect(withTourQuery(redirectTo));
  }

  async function finishAfterOrg() {
    const status = await api.getBillingOnboarding().catch(() => null);
    if (status?.required && !status.complete) {
      setBillingGate('pending');
      setStep(4);
      return;
    }
    setBillingGate('complete');
    enterApp();
  }

  async function completeSetup() {
    setSubmitting(true);
    setError(null);
    try {
      const already = await refreshMembership();
      if (already?.org) {
        await finishAfterOrg();
        return;
      }

      const { role: finalRole, workType, contractorType, usageIntents } = resolveVerifierSetup(
        SETUP_DEFAULTS.role,
        SETUP_DEFAULTS.trade,
        true,
      );

      if (mode === 'join') {
        await api.joinOrg(
          joinCode.trim().toUpperCase(),
          finalRole,
          workType,
          usageIntents,
        );
      } else {
        await api.createOrg(
          orgName.trim() || workspaceNameFrom(fullName, email),
          finalRole,
          workType,
          contractorType,
          usageIntents,
        );
      }

      await refreshMembership();
      await finishAfterOrg();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setStep(2);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountNotice(null);
    if (!nameValid || !emailValid || !passwordValid || !orgStepValid || accountSubmitting) return;

    setAccountSubmitting(true);
    try {
      const res = await signup(email.trim(), password);
      if (res.needsEmailConfirmation) {
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
      await completeSetup();
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
      signInHref={step === 1 ? signInHref : undefined}
      headerAction={
        step > 1 ? (
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
      {step === 1 && (!user || accountSubmitting) && (
        <SetupStepCard
          step={1}
          intent={orgIntent}
          title="Create an account"
          subtitle="A few details and you can sign in from any device."
        >
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

            <Field
              label="Password"
              htmlFor="signup-password"
              hint="Min. 8 characters"
            >
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

            {mode === 'join' ? (
              <Field label="Join code" htmlFor="join-code">
                <input
                  id="join-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 8F3A9C2B"
                  autoCapitalize="characters"
                  className={`${inputClass} font-mono tracking-widest`}
                />
                <p className="mt-2 text-xs text-ink-500">
                  Starting a new company instead?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    Skip the join code
                  </button>
                </p>
              </Field>
            ) : (
              <Field label="Company name" htmlFor="org-name" hint="Optional">
                <input
                  id="org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Your company"
                  className={inputClass}
                />
                <p className="mt-2 text-xs text-ink-500">
                  Have a join code from your team?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('join')}
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    Enter it here
                  </button>
                </p>
              </Field>
            )}

            <PrimaryButton
              type="submit"
              disabled={!nameValid || !emailValid || !passwordValid || !orgStepValid || accountSubmitting}
              loading={accountSubmitting || submitting}
            >
              {accountSubmitting || submitting ? 'Creating account…' : 'Create account'}
            </PrimaryButton>
          </form>
        </SetupStepCard>
      )}

      {step === 1 && user && !accountSubmitting && (
        <SetupStepCard
          step={1}
          intent={orgIntent}
          title="Account ready"
          subtitle="Finish naming the workspace — or enter a join code if you were invited."
        >
          <PrimaryButton onClick={() => setStep(2)}>Continue</PrimaryButton>
        </SetupStepCard>
      )}

      {step === 2 && (
        <SetupStepCard
          step={2}
          intent={orgIntent}
          title={mode === 'join' ? 'Enter your join code' : 'Your workspace'}
          subtitle={
            mode === 'join'
              ? 'The code from your invite links this login to the team workspace.'
              : 'Name the company, or enter a join code if someone already set this up.'
          }
        >
          {error && <Alert>{error}</Alert>}

          {mode === 'create' ? (
            <Field label="Company name" htmlFor="org-name-step2" className="mt-5">
              <input
                id="org-name-step2"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Meridian Services"
                autoFocus
                className={inputClass}
              />
              <p className="mt-2 text-xs text-ink-500">
                Have a join code?{' '}
                <button
                  type="button"
                  onClick={() => setMode('join')}
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  Enter it instead
                </button>
              </p>
            </Field>
          ) : (
            <Field label="Join code" htmlFor="join-code-step2" className="mt-5">
              <input
                id="join-code-step2"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. 8F3A9C2B"
                autoFocus
                autoCapitalize="characters"
                className={`${inputClass} font-mono tracking-widest`}
              />
              <p className="mt-2 text-xs text-ink-500">
                Starting a new company?{' '}
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
                onClick={() => setStep(1)}
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
                void completeSetup();
              }}
            >
              {submitting ? 'Setting up…' : 'Continue'}
            </PrimaryButton>
          </div>
        </SetupStepCard>
      )}

      {step === 3 && (
        <SetupStepCard
          step={3}
          intent={orgIntent}
          title="Account ready"
          subtitle="You can invite teammates from Settings any time."
        >
          <PrimaryButton onClick={() => setStep(4)}>Continue</PrimaryButton>
        </SetupStepCard>
      )}

      {step === 4 && membership && (
        <SetupBillingStep
          redirectTo={redirectTo}
          checkoutOutcome={checkoutParam}
          onComplete={enterApp}
        />
      )}

      {step === 4 && !membership && (
        <SetupStepCard
          step={4}
          intent={orgIntent}
          title="Set up billing"
          subtitle="Finish creating your account first."
        >
          <PrimaryButton onClick={() => setStep(user ? 2 : 1)}>Back</PrimaryButton>
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
  'w-full rounded-lg glass-card px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

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
