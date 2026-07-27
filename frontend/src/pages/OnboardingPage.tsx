import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type MemberRole,
  type WorkType,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon, CheckIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

type OrgMode = 'create' | 'join';

const ROLE_OPTIONS: { value: MemberRole; blurb: string }[] = [
  { value: 'project_manager', blurb: 'Runs jobs end to end and coordinates the crew.' },
  { value: 'field_technician', blurb: 'On-site work: mitigation, demo, and repairs.' },
  { value: 'accountant', blurb: 'Invoicing, payments, and the books.' },
  { value: 'office_manager', blurb: 'Scheduling, dispatch, and back office.' },
  { value: 'sales', blurb: 'Estimates, bids, and winning new work.' },
];

const WORK_OPTIONS: { value: WorkType; blurb: string }[] = [
  { value: 'mitigation', blurb: 'Emergency response, water/fire/mold mitigation and drying.' },
  { value: 'construction', blurb: 'Rebuild and reconstruction after mitigation.' },
];

const STEPS = ['Organization', 'Your role', 'Type of work'];

export function OnboardingPage() {
  const { user, refreshMembership, logout } = useAuth();
  const navigate = useNavigate();
  // Onboarding time is only attributable once the user has an org, so the first
  // heartbeats here land after the org is created — which is the honest answer.
  useFeatureTimer('onboarding');

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<OrgMode>('create');
  const [orgName, setOrgName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [role, setRole] = useState<MemberRole | null>(null);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgStepValid = useMemo(() => {
    if (mode === 'create') return orgName.trim().length >= 2;
    return /^[A-Za-z0-9]{6,12}$/.test(joinCode.trim());
  }, [mode, orgName, joinCode]);

  const canContinue =
    (step === 0 && orgStepValid) || (step === 1 && role !== null) || (step === 2 && workType !== null);

  function next() {
    setError(null);
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }
  function back() {
    setError(null);
    if (step > 0) setStep((s) => s - 1);
  }

  async function finish() {
    if (!role || !workType) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'create') {
        await api.createOrg(orgName.trim(), role, workType);
      } else {
        await api.joinOrg(joinCode.trim().toUpperCase(), role, workType);
      }
      await refreshMembership();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      // Send the user back to the org step if the join code was the problem.
      if (err instanceof ApiError && err.code === 'join_org_failed') setStep(0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cx-aurora flex min-h-screen flex-col bg-ink-900">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Logo />
        <button
          onClick={() => logout()}
          className="text-sm text-gray-400 transition hover:text-gray-200"
        >
          Sign out
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <div className="w-full max-w-lg animate-fade-in-up">
          {/* Step indicator */}
          <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition ${
                    i < step
                      ? 'border-brand-500 bg-brand-600 text-white'
                      : i === step
                        ? 'border-brand-400 text-brand-300'
                        : 'border-white/15 text-gray-500'
                  }`}
                >
                  {i < step ? <CheckIcon width={16} height={16} /> : i + 1}
                </span>
                <span
                  className={`hidden text-xs sm:block ${i === step ? 'text-white' : 'text-gray-500'}`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px flex-1 bg-white/10" />}
              </li>
            ))}
          </ol>

          <div className="rounded-2xl border border-white/10 bg-ink-800/70 p-7 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-9">
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-200"
              >
                {error}
              </div>
            )}

            {/* Step 1: Organization */}
            {step === 0 && (
              <section>
                <h1 className="text-xl font-bold text-white">Join or create an organization</h1>
                <p className="mt-1.5 text-sm text-gray-400">
                  Everyone in {user?.email ? 'your team' : 'an organization'} works together and can
                  see each other's linked accounts.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-ink-700/50 p-1">
                  <ModeTab active={mode === 'create'} onClick={() => setMode('create')}>
                    Create new
                  </ModeTab>
                  <ModeTab active={mode === 'join'} onClick={() => setMode('join')}>
                    Link existing
                  </ModeTab>
                </div>

                {mode === 'create' ? (
                  <div className="mt-5">
                    <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium text-gray-300">
                      Organization name
                    </label>
                    <input
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Acme Restoration"
                      autoFocus
                      className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      You'll get a join code to invite the rest of your team.
                    </p>
                  </div>
                ) : (
                  <div className="mt-5">
                    <label htmlFor="joinCode" className="mb-1.5 block text-sm font-medium text-gray-300">
                      Organization join code
                    </label>
                    <input
                      id="joinCode"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="e.g. 8F3A9C2B"
                      autoFocus
                      autoCapitalize="characters"
                      className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 font-mono tracking-widest text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Ask an admin in your organization for the code.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Step 2: Role */}
            {step === 1 && (
              <section>
                <h1 className="text-xl font-bold text-white">What's your role?</h1>
                <p className="mt-1.5 text-sm text-gray-400">Pick the account type that fits you best.</p>
                <div className="mt-5 space-y-2.5">
                  {ROLE_OPTIONS.map((opt) => (
                    <OptionCard
                      key={opt.value}
                      selected={role === opt.value}
                      title={ROLE_LABELS[opt.value]}
                      blurb={opt.blurb}
                      onClick={() => setRole(opt.value)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Step 3: Work type */}
            {step === 2 && (
              <section>
                <h1 className="text-xl font-bold text-white">Mitigation or construction?</h1>
                <p className="mt-1.5 text-sm text-gray-400">
                  Tell us what kind of work you focus on.
                </p>
                <div className="mt-5 space-y-2.5">
                  {WORK_OPTIONS.map((opt) => (
                    <OptionCard
                      key={opt.value}
                      selected={workType === opt.value}
                      title={WORK_TYPE_LABELS[opt.value]}
                      blurb={opt.blurb}
                      onClick={() => setWorkType(opt.value)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Nav buttons */}
            <div className="mt-7 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === 0 || submitting}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Back
              </button>

              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={!canContinue}
                  className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finish}
                  disabled={!canContinue || submitting}
                  className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting && <SpinnerIcon className="animate-spin" />}
                  {submitting
                    ? mode === 'create'
                      ? 'Creating…'
                      : 'Linking…'
                    : mode === 'create'
                      ? 'Create organization'
                      : 'Link account'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
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
        active ? 'bg-brand-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function OptionCard({
  selected,
  title,
  blurb,
  onClick,
}: {
  selected: boolean;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-brand-400 bg-brand-500/10 ring-1 ring-brand-500/40'
          : 'border-white/10 bg-ink-700/40 hover:border-white/20 hover:bg-ink-700/70'
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
          selected ? 'border-brand-400 bg-brand-500 text-white' : 'border-white/25'
        }`}
      >
        {selected && <CheckIcon width={14} height={14} />}
      </span>
      <span>
        <span className="block font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-sm text-gray-400">{blurb}</span>
      </span>
    </button>
  );
}
