import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  type Org,
} from '../lib/api';
import { loginHref, resolveAuthRedirect } from '../lib/authRedirect';
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
  type SetupWizardStep,
} from '../components/setup/setupWizard';
import { resolveVerifierSetup } from '../components/setup/verifierSetupOptions';
import { JoinQrCard } from '../components/team/JoinQrCard';
import { normalizeJoinCode } from '../lib/joinLink';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Step 1 — account
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  // Arriving through the invite QR code / link: /signup?join=CODE. The code is
  // the same org join code as ever, just carried in the URL — so the scan
  // lands with "join" preselected and the code already typed.
  const invitedJoinCode = normalizeJoinCode(searchParams.get('join'));

  // Step 2 — organization
  const [mode, setMode] = useState<OrgMode>(invitedJoinCode ? 'join' : 'create');
  const [orgName, setOrgName] = useState('');
  const [joinCode, setJoinCode] = useState(invitedJoinCode ?? '');

  // Who the code belongs to, when the server can say — the difference between
  // "enter a code" and "you are joining Ortiz Restoration". Best-effort: no
  // name, same flow.
  const [invitedOrgName, setInvitedOrgName] = useState<string | null>(null);
  useEffect(() => {
    if (!invitedJoinCode) return;
    let cancelled = false;
    api
      .lookupJoinCode(invitedJoinCode)
      .then((res) => {
        if (!cancelled) setInvitedOrgName(res.org.name);
      })
      .catch(() => {
        /* unknown code or lookup unavailable — the form still works */
      });
    return () => {
      cancelled = true;
    };
  }, [invitedJoinCode]);

  // Step 3 — invite / join result
  const [createdOrg, setCreatedOrg] = useState<Org | null>(null);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [billingGate, setBillingGate] = useState<'loading' | 'pending' | 'complete'>('loading');

  const checkoutOutcome = searchParams.get('checkout');
  const checkoutParam =
    checkoutOutcome === 'success' || checkoutOutcome === 'cancelled' ? checkoutOutcome : null;

  useEffect(() => {
    document.title = 'Create your organization · Atmosphere';
    return () => {
      document.title = 'Atmosphere';
    };
  }, []);

  useEffect(() => {
    if (!loading && user && !membership && step === 1) {
      setStep(2);
    }
  }, [loading, user, membership, step]);

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
  const orgStepValid =
    mode === 'create' ? orgName.trim().length >= 2 : /^[A-Za-z0-9]{6,12}$/.test(joinCode.trim());

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountNotice(null);
    if (!nameValid || !emailValid || !passwordValid || accountSubmitting) return;

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
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function completeSetup() {
    setSubmitting(true);
    setError(null);
    try {
      const { role: finalRole, workType, contractorType, usageIntents } = resolveVerifierSetup(
        SETUP_DEFAULTS.role,
        SETUP_DEFAULTS.trade,
        true,
      );

      let org: Org;
      if (mode === 'create') {
        const res = await api.createOrg(
          orgName.trim(),
          finalRole,
          workType,
          contractorType,
          usageIntents,
        );
        org = res.org;
      } else {
        const res = await api.joinOrg(
          joinCode.trim().toUpperCase(),
          finalRole,
          workType,
          usageIntents,
        );
        org = res.org;
      }

      await refreshMembership();
      setCreatedOrg(org);
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      if (err instanceof ApiError && err.code === 'join_org_failed') setStep(2);
    } finally {
      setSubmitting(false);
    }
  }

  function enterApp() {
    scheduleWorkVerificationTour();
    queueRedirect(withTourQuery(redirectTo));
  }

  async function copyJoinCode() {
    if (!createdOrg?.joinCode) return;
    try {
      await navigator.clipboard.writeText(createdOrg.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — user can still select manually */
    }
  }

  return (
    <SetupWizardShell
      step={step}
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
      {step === 1 && !user && (
        <SetupStepCard
          step={1}
          title="Your login details"
          subtitle="Organization setup starts on the next screen — about two minutes total."
        >
          {invitedJoinCode && <InvitedBanner orgName={invitedOrgName} />}

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
                once your email is confirmed to continue setup.
              </span>
            </div>
          )}

          {error && <Alert>{error}</Alert>}

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

            <PrimaryButton
              type="submit"
              disabled={!nameValid || !emailValid || !passwordValid || accountSubmitting}
              loading={accountSubmitting}
            >
              {accountSubmitting ? 'Creating account…' : 'Continue to step 2'}
            </PrimaryButton>
          </form>

          <p className="mt-5 rounded-lg bg-paper-50 px-3.5 py-3 text-xs leading-relaxed text-ink-500">
            Joining a team that already uses Atmosphere? Create your account here, then choose{' '}
            <strong className="font-medium text-ink-700">Join with a code</strong> on step 2.
          </p>
        </SetupStepCard>
      )}

      {step === 1 && user && (
        <SetupStepCard
          step={1}
          title="Account ready"
          subtitle="Your login is set. Continue to name your organization or join with a code."
        >
          <PrimaryButton onClick={() => setStep(2)}>Continue to step 2</PrimaryButton>
        </SetupStepCard>
      )}

      {step === 2 && (
        <SetupStepCard
          step={2}
          title="Your organization"
          subtitle="Create a new workspace for your company, or join one that already exists."
        >
          {invitedJoinCode && <InvitedBanner orgName={invitedOrgName} />}

          {error && <Alert>{error}</Alert>}

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg glass-card p-1">
            <ModeTab active={mode === 'create'} onClick={() => setMode('create')}>
              Create new
            </ModeTab>
            <ModeTab active={mode === 'join'} onClick={() => setMode('join')}>
              Join with a code
            </ModeTab>
          </div>

          {mode === 'create' ? (
            <Field label="Organization name" htmlFor="org-name" className="mt-5">
              <input
                id="org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Meridian Services"
                autoFocus
                className={inputClass}
              />
              <p className="mt-2 text-xs text-ink-500">
                You will get a join code on the next step to invite your crew.
              </p>
            </Field>
          ) : (
            <Field label="Organization join code" htmlFor="join-code" className="mt-5">
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
                {invitedJoinCode && joinCode === invitedJoinCode
                  ? 'Filled in from your invite — just continue.'
                  : 'Ask a teammate or admin for your team’s code.'}
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

      {step === 3 && createdOrg && (
        <SetupStepCard
          step={3}
          title={mode === 'create' ? 'Invite your crew' : 'You are connected'}
          subtitle={
            mode === 'create'
              ? 'Share this join code with anyone who should work in the same organization.'
              : `You joined ${createdOrg.name}. You can invite others from Settings later.`
          }
        >
          {mode === 'create' && (
            <div className="mt-6 rounded-xl border border-line bg-paper-50 p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                Your organization join code
              </p>
              <p className="mt-3 font-mono text-3xl font-bold tracking-[0.2em] text-ink-900">
                {createdOrg.joinCode}
              </p>
              <button
                type="button"
                onClick={copyJoinCode}
                className="mt-4 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
              >
                {copied ? 'Copied!' : 'Copy join code'}
              </button>
              <p className="mt-4 text-xs text-ink-500">
                Teammates choose <strong>Join with a code</strong> when they sign up.
              </p>
            </div>
          )}

          {mode === 'create' && createdOrg.joinCode && (
            <div className="mt-4 rounded-xl border border-line bg-paper-50 p-5">
              <JoinQrCard code={createdOrg.joinCode} />
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-ink-500">You can update your profile anytime in Settings.</span>
            <PrimaryButton onClick={() => setStep(4)}>
              {mode === 'create' ? 'Continue to billing' : 'Continue'}
            </PrimaryButton>
          </div>
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
          title="Set up billing"
          subtitle="Finish organization setup on step 2 first."
        >
          <PrimaryButton onClick={() => setStep(2)}>Back to organization setup</PrimaryButton>
        </SetupStepCard>
      )}

      <p className="mt-6 text-center text-xs text-ink-400">
        Passwords are encrypted, never stored in plain text, and never seen by this page.
      </p>
    </SetupWizardShell>
  );
}

const inputClass =
  'w-full rounded-lg glass-card px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';

/**
 * Shown when signup opened from the invite QR code / link. Two jobs: name the
 * company when the server can (so the person knows the scan took them to the
 * right place), and say out loud that no card will be asked for — the account
 * lands under the company's billing, which is the whole point of arriving
 * through the invite.
 */
function InvitedBanner({ orgName }: { orgName: string | null }) {
  return (
    <div
      role="status"
      className="mt-6 rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-ink-800"
    >
      {orgName ? (
        <>
          You&apos;re joining <strong className="font-semibold">{orgName}</strong>.
        </>
      ) : (
        <>You&apos;ve been invited to join a company on Atmosphere.</>
      )}{' '}
      Create your login and your account is connected to the company automatically — billing is
      already handled by them, so you won&apos;t be asked for payment details.
    </div>
  );
}

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

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-brand-500 text-ink-900 shadow' : 'text-ink-600 hover:text-ink-900'
      }`}
    >
      {children}
    </button>
  );
}

