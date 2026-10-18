import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { HomeownerEmailSignIn } from '../components/HomeownerEmailSignIn';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { loginHref, parseSignupIntent, resolveAuthRedirect } from '../lib/authRedirect';
import { captureAfterSignup, FIRST_RUN_HOME, firstRunDestination } from '../lib/firstRun';
import { currentPostOnboardingEnv, isAbsoluteHref, offersInviteStep, postOnboardingHref } from '../lib/postOnboarding';
import { resetBillingOnboardingShared } from '../lib/billingOnboardingShared';
import { isGlobalAdmin } from '../domain/productRoles';
import { homeownerAfterSignup } from '../lib/homeownerHub';
import { PLATFORM_HOME } from '../lib/platforms';
import { usePendingAuthRedirect } from '../hooks/usePendingAuthRedirect';
import { getPlatform } from '../lib/usePlatform';
import { AtmospherePlanPicker } from '../components/billing/AtmospherePlanPicker';
import {
  ATMOSPHERE_SELF_SERVE_PLANS,
  parseAtmosphereBillingInterval,
  parseAtmospherePlanCode,
  type AtmosphereBillingInterval,
} from '../lib/atmospherePlans';
import { SetupStepCard, SetupWizardShell } from '../components/setup/SetupWizardShell';
import { SetupBillingStep } from '../components/setup/SetupBillingStep';
import { SetupInviteStep } from '../components/setup/SetupInviteStep';
import {
  SETUP_DEFAULTS,
  initialSetupStep,
  type SetupWizardStep,
  INVITE_STEP_PARAM,
} from '../components/setup/setupWizard';
import { resolveVerifierSetup } from '../components/setup/verifierSetupOptions';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';
import { isFieldEmbedMarked, withFieldEmbed } from '../lib/fieldEmbed';
import { CURRENT_TERMS_VERSION } from '../lib/terms';
import { isInAppShell } from '../lib/appShell';
import { TermsAckCheckbox } from '../components/TermsAckCheckbox';
import { ServiceRolePicker } from '../components/shared/ServiceRolePicker';
import type { ServiceRoleSlug } from '../lib/serviceRole';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OrgMode = 'create' | 'join';

export function SignupPage() {
  const { user, loading, membership, signup, refreshMembership, logout } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // iPhone/Android app: no plan picker or prices (App Store 3.1.1).
  const inApp = isInAppShell();
  const queueRedirect = usePendingAuthRedirect();
  const platformHome = PLATFORM_HOME[getPlatform()];
  const redirectTo = resolveAuthRedirect(
    searchParams.get('next'),
    (location.state as { from?: string } | null)?.from,
    platformHome,
  );
  /** After billing (or a comped setup), the Dashboard, unless a specific deep link was asked for. */
  const afterSetupTo = firstRunDestination(redirectTo, platformHome);

  const checkoutOutcome = searchParams.get('checkout');
  const checkoutParam =
    checkoutOutcome === 'success' || checkoutOutcome === 'cancelled' ? checkoutOutcome : null;

  const orgIntent = parseSignupIntent(searchParams.get('intent'));
  const isInviteeIntent = orgIntent === 'homeowner' || orgIntent === 'capture';

  const [step, setStep] = useState<SetupWizardStep>(() =>
    initialSetupStep({
      user: Boolean(user),
      membership: Boolean(membership),
      stepParam: searchParams.get('step'),
      checkout: checkoutParam,
      inviteeAccount: isInviteeIntent,
    }),
  );

  const [fullName, setFullName] = useState('');
  const [serviceRole, setServiceRole] = useState<ServiceRoleSlug | ''>('');
  const [serviceRoleCustom, setServiceRoleCustom] = useState('');
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [homeownerEmail, setHomeownerEmail] = useState(() => searchParams.get('homeowner') === '1');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [mode, setMode] = useState<OrgMode>(orgIntent === 'join' ? 'join' : 'create');
  const [orgName, setOrgName] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(() =>
    parseAtmospherePlanCode(searchParams.get('plan')),
  );
  const [billingInterval, setBillingInterval] = useState<AtmosphereBillingInterval>(() =>
    parseAtmosphereBillingInterval(searchParams.get('interval')),
  );
  const [annualAvailable, setAnnualAvailable] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);

  const existingSession = Boolean(user) && !membership;
  const creatingNewAccount = !existingSession;

  const goToStep = useCallback(
    (next: SetupWizardStep) => {
      const safe = isInviteeIntent ? 1 : next;
      setStep(safe);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('step', safe === 3 ? INVITE_STEP_PARAM : String(safe));
          // Leaving the Stripe return: it would send the page back to billing.
          if (safe === 3) params.delete('checkout');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, isInviteeIntent],
  );

  useEffect(() => {
    if (orgIntent === 'join') setMode('join');
  }, [orgIntent]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSelfServeBilling()
      .then((catalog) => {
        if (!cancelled) setAnnualAvailable(Boolean(catalog.annualAvailable));
      })
      .catch(() => {
        if (!cancelled) setAnnualAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Invitees never enter Stripe / plan selection — keep them on step 1.
    if (isInviteeIntent) {
      if (step !== 1) setStep(1);
      return;
    }
    if (loading || !user || !membership) return;

    let cancelled = false;
    (async () => {
      try {
        const status = await api.getBillingOnboarding();
        if (cancelled) return;
        const needsBilling = status.required && !status.complete;
        const stepParam = searchParams.get('step');
        // Invite screen only once paid (or comped).
        if (stepParam === INVITE_STEP_PARAM) {
          setStep(needsBilling ? 2 : 3);
          return;
        }
        // Already past billing: a late answer for the Stripe return URL must not pull the page back.
        if (step === 3 && !needsBilling) return;
        // Paid checkout returns still need the billing step so SetupBillingStep
        // can auto-enter — do not wait for an incomplete payment.
        if (
          checkoutParam ||
          (needsBilling &&
            (stepParam === '2' || stepParam === '3' || stepParam === '4' || stepParam === '5'))
        ) {
          setStep(2);
        }
      } catch {
        /* stay on the current step */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, membership, searchParams, checkoutParam, isInviteeIntent, step]);

  // Only a Global Admin invites the company; anyone else leaves setup.
  const skipInviteStep = step === 3 && Boolean(membership) && !isGlobalAdmin(membership?.role);
  useEffect(() => {
    if (skipInviteStep) leaveSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipInviteStep]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (isFieldEmbedMarked()) {
    return (
      <Navigate
        to={withFieldEmbed(
          redirectTo === '/signup' || redirectTo.startsWith('/signup')
            ? '/verifier-library'
            : redirectTo,
        )}
        replace
      />
    );
  }

  const signInHref = loginHref(redirectTo);
  const nameValid = fullName.trim().length >= 2;
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const isHomeowner = orgIntent === 'homeowner';
  const isCapture = orgIntent === 'capture';
  const isInviteeAccount = isHomeowner || isCapture;
  const workspaceValid = isInviteeAccount
    ? true
    : mode === 'join'
      ? true
      : orgName.trim().length >= 2;
  const accountValid = creatingNewAccount
    ? (isInviteeAccount ? emailValid && passwordValid : nameValid && emailValid && passwordValid)
    : true;
  const termsValid = creatingNewAccount ? termsAcknowledged : true;
  const formValid = accountValid && workspaceValid && termsValid;

  /** Where setup ends for this person. A Platform-only seat never lands in Field Capture. */
  function setupEnv() {
    return { ...currentPostOnboardingEnv(), platformSeat: membership?.seatType === 'platform' };
  }

  /** Leave setup: computers to the Dashboard (or deep link), phones to Field Capture. Same session. */
  function leaveSetup() {
    const href = postOnboardingHref(afterSetupTo, setupEnv());
    if (isAbsoluteHref(href)) {
      window.location.assign(href);
      return;
    }
    queueRedirect(href);
  }

  /** Paid or comped. Computers get the optional invite screen first; phones go straight on. */
  function enterApp() {
    if (isAbsoluteHref(postOnboardingHref(afterSetupTo, setupEnv())) || !offersInviteStep()) {
      leaveSetup();
      return;
    }
    resetBillingOnboardingShared();
    goToStep(3);
  }

  async function continueAfterWorkspace() {
    try {
      const status = await api.getBillingOnboarding();
      const needsBilling = status.required && !status.complete;
      if (needsBilling) {
        // Account, then plan and invites. No first job is needed first.
        goToStep(2);
        return;
      }
      enterApp();
    } catch {
      goToStep(2);
    }
  }

  async function completeWorkspace() {
    const already = await refreshMembership();
    if (already?.org) {
      await continueAfterWorkspace();
      return;
    }

    const {
      role: finalRole,
      usageIntents,
      workType,
      contractorType,
    } = resolveVerifierSetup(
      mode === 'join' ? 'employee' : SETUP_DEFAULTS.role,
      SETUP_DEFAULTS.trade,
      mode !== 'join',
    );

    if (mode === 'join') {
      await api.joinOrg(
        'employee',
        SETUP_DEFAULTS.workType,
        usageIntents.length ? usageIntents : ['field_work', 'exploring'],
      );
    } else {
      await api.createOrg(orgName.trim(), finalRole, workType, contractorType, usageIntents);
    }

    await refreshMembership();
    await continueAfterWorkspace();
  }

  async function handleSetupSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountNotice(null);
    if (!formValid || submitting) return;

    setSubmitting(true);
    try {
      if (creatingNewAccount) {
        if (user) {
          await logout();
        }
        const res = await signup(email.trim(), password, CURRENT_TERMS_VERSION);
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
        if (fullName.trim() || (serviceRole && !isHomeowner)) {
          await api.updateProfile(
            fullName.trim() || null,
            isHomeowner ? 'homeowner' : serviceRole || null,
            !isHomeowner && serviceRole === 'other' ? serviceRoleCustom.trim() || null : null,
          );
          await refreshMembership();
        } else if (isHomeowner) {
          try {
            await api.updateProfile(null, 'homeowner', null);
          } catch {
            /* claim path also forces Homeowner */
          }
        }
        // Homeowner / capture invitees never create an org or enter billing —
        // even if signup somehow returned a membership.
        if (orgIntent === 'homeowner') {
          queueRedirect(homeownerAfterSignup(redirectTo));
          return;
        }
        if (orgIntent === 'capture') {
          window.location.assign(
            captureAfterSignup(searchParams.get('token'), email.trim() || searchParams.get('email')),
          );
          return;
        }
        if (res.membership?.org) {
          await continueAfterWorkspace();
          return;
        }
      }
      if (orgIntent === 'homeowner') {
        queueRedirect(homeownerAfterSignup(redirectTo));
        return;
      }
      if (orgIntent === 'capture') {
        window.location.assign(
          captureAfterSignup(searchParams.get('token'), email.trim() || searchParams.get('email')),
        );
        return;
      }
      await completeWorkspace();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      goToStep(1);
    } finally {
      setSubmitting(false);
    }
  }

  // "Homeowner? Sign in with your email": the email-link step on its own, with
  // no company setup, plan or billing around it.
  if (homeownerEmail && !user) {
    return (
      <div className="relative flex min-h-screen flex-col bg-paper-100">
        <header className="flex items-center justify-between gap-4 px-6 py-8 sm:px-10 sm:py-10">
          <Logo size="lg" />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md animate-fade-in-up">
            <div className="rounded-2xl border border-line bg-paper-0 p-8 shadow-lift sm:p-10" data-testid="homeowner-signup">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">Homeowner</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">Sign in with your email</h1>
              <p className="mt-1.5 text-sm text-ink-600">See the job your contractor shared with you.</p>
              <HomeownerEmailSignIn initialEmail={email} onBack={() => setHomeownerEmail(false)} />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <SetupWizardShell
      step={step}
      intent={orgIntent}
      onStepSelect={(next) => {
        // Invite team opens only after the plan step finishes.
        if (next !== 3) goToStep(next);
      }}
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
          title={
            isCapture
              ? 'Create your account'
              : isHomeowner
                ? 'Save this job'
                : mode === 'join'
                  ? 'Join your team'
                  : 'Account & workspace'
          }
          subtitle={
            isCapture
              ? 'Email and password. Then Field Capture opens this job.'
              : isHomeowner
                ? 'Invited email + password. Free — no plan or payment.'
                : mode === 'join'
                  ? 'Use the invite from your Global Admin — create the account with the invited email.'
                  : inApp
                    ? 'You are creating this company as Global Admin. Next: invite your team.'
                    : 'You are creating this company as Global Admin. Next: pick a plan and invite your team.'
          }
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

          <form onSubmit={handleSetupSubmit} noValidate className="mt-6 space-y-4">
            {creatingNewAccount && (
              <>
                {!isInviteeAccount && (
                <Field label="Your name" htmlFor="signup-name">
                  <input
                    id="signup-name"
                    name="name"
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
                )}

                {!isHomeowner && (
                  <ServiceRolePicker
                    value={serviceRole}
                    custom={serviceRoleCustom}
                    onChange={(role, custom) => {
                      setServiceRole(role);
                      setServiceRoleCustom(custom);
                    }}
                    hint="Analysis labels you with this title (e.g. Alex — Electrician)."
                  />
                )}
                {isHomeowner && (
                  <p className="text-xs text-ink-500">
                    Free for homeowners — no plan or payment. You will be labeled as{' '}
                    <span className="font-semibold text-ink-800">Homeowner</span> on this job.
                    Use the same email as the invite.
                  </p>
                )}

                <Field label={isInviteeAccount ? 'Email' : 'Work email'} htmlFor="signup-email">
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={isInviteeAccount ? 'you@email.com' : 'you@company.com'}
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
                      placeholder={isInviteeAccount ? 'At least 8 characters' : 'Choose a strong password'}
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
              </>
            )}

            {!isInviteeAccount && (mode === 'create' ? (
              <Field label="Company name" htmlFor="org-name">
                <input
                  id="org-name"
                  name="organization"
                  type="text"
                  autoComplete="organization"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Meridian Services"
                  className={inputClass}
                />
                <p className="mt-2 text-xs text-ink-500">
                  Were you invited by your office? Open the link in that email — only invited people
                  can join an existing workspace.
                </p>
              </Field>
            ) : (
              <p className="text-sm text-ink-600">
                Use the invited email. Your Global Admin already sent the invite.{' '}
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  Starting a new company as Global Admin?
                </button>
              </p>
            ))}

            {creatingNewAccount && (
              <TermsAckCheckbox
                id="signup-tos"
                checked={termsAcknowledged}
                onChange={setTermsAcknowledged}
              />
            )}

            <PrimaryButton type="submit" disabled={!formValid || submitting} loading={submitting}>
              {submitting ? 'Saving…' : isCapture ? 'Create account' : isHomeowner ? 'Save this job' : 'Continue'}
            </PrimaryButton>
          </form>
          {!user && !isCapture && (
            <p className="mt-4 text-center text-sm text-ink-600">
              <button
                type="button"
                onClick={() => setHomeownerEmail(true)}
                className="font-medium text-brand-600 hover:text-brand-700"
                data-testid="homeowner-email-option"
              >
                Homeowner? Sign in with your email
              </button>
            </p>
          )}
        </SetupStepCard>
      )}

      {step === 3 && !isInviteeAccount && membership && isGlobalAdmin(membership.role) && (
        <SetupInviteStep
          continueLabel={afterSetupTo === FIRST_RUN_HOME ? 'Continue to dashboard' : 'Continue'}
          onDone={leaveSetup}
        />
      )}

      {step === 2 && !isInviteeAccount && membership && (
        <SetupBillingStep
          redirectTo={afterSetupTo}
          checkoutOutcome={checkoutParam}
          nextLabel={offersInviteStep() ? 'Continue to invite your team' : 'Continue'}
          onComplete={enterApp}
        />
      )}

      {step === 2 && !isInviteeAccount && !membership && inApp && (
        <SetupStepCard
          step={2}
          intent={orgIntent}
          title="Plan"
          subtitle="Plans and billing are managed on atmosphereteam.com."
        >
          <div className="mt-7 flex justify-end">
            <PrimaryButton onClick={() => goToStep(1)}>Continue to company setup</PrimaryButton>
          </div>
        </SetupStepCard>
      )}

      {step === 2 && !isInviteeAccount && !membership && !inApp && (
        <SetupStepCard
          step={2}
          intent={orgIntent}
          title="Set up billing"
          subtitle="Choose a plan, then finish company setup to add a payment method."
        >
          <div className="mt-6">
            <AtmospherePlanPicker
              plans={ATMOSPHERE_SELF_SERVE_PLANS}
              value={selectedPlan}
              interval={annualAvailable ? billingInterval : 'month'}
              annualAvailable={annualAvailable}
              onIntervalChange={(next) => {
                setBillingInterval(next);
                setSearchParams(
                  (prev) => {
                    const params = new URLSearchParams(prev);
                    params.set('step', '2');
                    if (next === 'year') params.set('interval', 'year');
                    else params.delete('interval');
                    return params;
                  },
                  { replace: true },
                );
              }}
              onChange={(code) => {
                setSelectedPlan(code);
                setSearchParams(
                  (prev) => {
                    const params = new URLSearchParams(prev);
                    params.set('step', '2');
                    params.set('plan', code);
                    return params;
                  },
                  { replace: true },
                );
              }}
            />
          </div>
          <div className="mt-7 flex justify-end">
            <PrimaryButton onClick={() => goToStep(1)}>Continue to company setup</PrimaryButton>
          </div>
        </SetupStepCard>
      )}

      {!isInviteeAccount && (
        <p className="mt-6 text-center text-xs text-ink-400">
          Passwords are encrypted, never stored in plain text, and never seen by this page.
        </p>
      )}
    </SetupWizardShell>
  );
}

function looksLikeExistingAccount(message: string): boolean {
  return /already exist/i.test(message);
}

const inputClass =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-hidden transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

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
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[180px]"
    >
      {loading && <SpinnerIcon className="animate-spin" />}
      {children}
    </button>
  );
}
