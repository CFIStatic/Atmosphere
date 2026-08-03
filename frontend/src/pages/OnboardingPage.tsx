import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  CONTRACTOR_TYPE_LABELS,
  ROLE_LABELS,
  USAGE_INTENT_LABELS,
  WORK_TYPE_LABELS,
  type ContractorType,
  type MemberRole,
  type UsageIntent,
  type WorkType,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { PLATFORM_HOME } from '../lib/platforms';
import { getPlatform } from '../lib/usePlatform';
import { SpinnerIcon, CheckIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

type OrgMode = 'create' | 'join';

const ROLE_OPTIONS: { value: MemberRole; blurb: string }[] = [
  { value: 'project_manager', blurb: 'Runs jobs end to end and coordinates the crew.' },
  { value: 'field_technician', blurb: 'On-site work: mitigation, demo, and repairs.' },
  { value: 'accountant', blurb: 'Invoicing, payments, job cost, and the books.' },
  { value: 'office_manager', blurb: 'Scheduling, dispatch, and back office.' },
  { value: 'sales', blurb: 'Estimates, bids, and winning new work.' },
];

const WORK_OPTIONS: { value: WorkType; blurb: string }[] = [
  { value: 'mitigation', blurb: 'Emergency response, water/fire/mold mitigation and drying.' },
  { value: 'construction', blurb: 'Rebuild and reconstruction after mitigation.' },
];

const CONTRACTOR_OPTIONS: { value: ContractorType; blurb: string }[] = [
  {
    value: 'restoration',
    blurb: 'Water, fire, mold, and related restoration — mitigation through rebuild.',
  },
  { value: 'roofing', blurb: 'Roofing installs, repairs, and storm work.' },
  { value: 'general_contractor', blurb: 'General contracting across trades and scopes.' },
  { value: 'other', blurb: 'Another kind of contractor or related business.' },
];

const USAGE_OPTIONS: { value: UsageIntent; blurb: string }[] = [
  { value: 'mitigation_estimating', blurb: 'Build and price mitigation scopes.' },
  { value: 'construction_estimating', blurb: 'Build and price reconstruction scopes.' },
  { value: 'project_management', blurb: 'Keep jobs, tasks, and crews on track.' },
  { value: 'crm', blurb: 'Track leads, contacts, properties, and jobs.' },
  { value: 'web_access', blurb: 'Have AI sign into carrier and vendor portals for you.' },
  { value: 'field_work', blurb: 'Support technicians on site.' },
  { value: 'billing', blurb: 'Manage plans, seats, and usage credits.' },
  { value: 'financial', blurb: 'Monitor cash, AR, job cost, and the books.' },
  { value: 'exploring', blurb: 'Not sure yet — just getting set up.' },
];

function stepsFor(mode: OrgMode): string[] {
  return mode === 'create'
    ? ['Organization', 'Company type', 'Your role', 'Type of work', 'How you will use it']
    : ['Organization', 'Your role', 'Type of work', 'How you will use it'];
}

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
  const [contractorType, setContractorType] = useState<ContractorType | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [usageIntents, setUsageIntents] = useState<UsageIntent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = useMemo(() => stepsFor(mode), [mode]);

  const orgStepValid = useMemo(() => {
    if (mode === 'create') return orgName.trim().length >= 2;
    return /^[A-Za-z0-9]{6,12}$/.test(joinCode.trim());
  }, [mode, orgName, joinCode]);

  const canContinue = useMemo(() => {
    if (mode === 'create') {
      if (step === 0) return orgStepValid;
      if (step === 1) return contractorType !== null;
      if (step === 2) return role !== null;
      if (step === 3) return workType !== null;
      if (step === 4) return usageIntents.length > 0;
      return false;
    }
    if (step === 0) return orgStepValid;
    if (step === 1) return role !== null;
    if (step === 2) return workType !== null;
    if (step === 3) return usageIntents.length > 0;
    return false;
  }, [mode, step, orgStepValid, contractorType, role, workType, usageIntents]);

  function switchMode(next: OrgMode) {
    setMode(next);
    setStep(0);
    setError(null);
  }

  function next() {
    setError(null);
    if (step < steps.length - 1) setStep((s) => s + 1);
  }
  function back() {
    setError(null);
    if (step > 0) setStep((s) => s - 1);
  }

  function toggleUsage(intent: UsageIntent) {
    setUsageIntents((current) =>
      current.includes(intent) ? current.filter((value) => value !== intent) : [...current, intent],
    );
  }

  async function finish() {
    if (!role || !workType || usageIntents.length === 0) return;
    if (mode === 'create' && !contractorType) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'create') {
        await api.createOrg(orgName.trim(), role, workType, contractorType!, usageIntents);
      } else {
        await api.joinOrg(joinCode.trim().toUpperCase(), role, workType, usageIntents);
      }
      await refreshMembership();
      navigate(PLATFORM_HOME[getPlatform()], { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      // Send the user back to the org step if the join code was the problem.
      if (err instanceof ApiError && err.code === 'join_org_failed') setStep(0);
    } finally {
      setSubmitting(false);
    }
  }

  const showOrg = step === 0;
  const showContractor = mode === 'create' && step === 1;
  const showRole = mode === 'create' ? step === 2 : step === 1;
  const showWork = mode === 'create' ? step === 3 : step === 2;
  const showUsage = mode === 'create' ? step === 4 : step === 3;

  return (
    <div className="cx-aurora flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Logo />
        <button
          onClick={() => logout()}
          className="text-sm text-ink-600 transition hover:text-ink-900"
        >
          Sign out
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <div className="w-full max-w-lg animate-fade-in-up">
          {/* Step indicator */}
          <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
            {steps.map((label, i) => (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition ${
                    i < step
                      ? 'border-brand-500 bg-brand-500 text-ink-900'
                      : i === step
                        ? 'border-brand-400 text-brand-600'
                        : 'border-line text-ink-500'
                  }`}
                >
                  {i < step ? <CheckIcon width={16} height={16} /> : i + 1}
                </span>
                <span
                  className={`hidden text-xs sm:block ${i === step ? 'text-ink-900' : 'text-ink-500'}`}
                >
                  {label}
                </span>
                {i < steps.length - 1 && <span className="h-px flex-1 bg-paper-200" />}
              </li>
            ))}
          </ol>

          <div className="rounded-2xl glass-panel p-7 shadow-2xl shadow-lift-xl sm:p-9">
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
              >
                {error}
              </div>
            )}

            {/* Step: Organization */}
            {showOrg && (
              <section>
                <h1 className="text-xl font-bold text-ink-900">Join or create an organization</h1>
                <p className="mt-1.5 text-sm text-ink-600">
                  Everyone in {user?.email ? 'your team' : 'an organization'} works together and can
                  see each other's linked accounts.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg glass-card p-1">
                  <ModeTab active={mode === 'create'} onClick={() => switchMode('create')}>
                    Create new
                  </ModeTab>
                  <ModeTab active={mode === 'join'} onClick={() => switchMode('join')}>
                    Link existing
                  </ModeTab>
                </div>

                {mode === 'create' ? (
                  <div className="mt-5">
                    <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium text-ink-700">
                      Organization name
                    </label>
                    <input
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Acme Restoration"
                      autoFocus
                      className="w-full rounded-lg glass-card px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                    />
                    <p className="mt-2 text-xs text-ink-500">
                      You'll get a join code to invite the rest of your team.
                    </p>
                  </div>
                ) : (
                  <div className="mt-5">
                    <label htmlFor="joinCode" className="mb-1.5 block text-sm font-medium text-ink-700">
                      Organization join code
                    </label>
                    <input
                      id="joinCode"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="e.g. 8F3A9C2B"
                      autoFocus
                      autoCapitalize="characters"
                      className="w-full rounded-lg glass-card px-3.5 py-2.5 font-mono tracking-widest text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                    />
                    <p className="mt-2 text-xs text-ink-500">
                      Ask an admin in your organization for the code.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Step: Company type (create only) */}
            {showContractor && (
              <section>
                <h1 className="text-xl font-bold text-ink-900">What kind of contractor are you?</h1>
                <p className="mt-1.5 text-sm text-ink-600">
                  This helps Atmosphere tailor defaults for your company.
                </p>
                <div className="mt-5 space-y-2.5">
                  {CONTRACTOR_OPTIONS.map((opt) => (
                    <OptionCard
                      key={opt.value}
                      selected={contractorType === opt.value}
                      title={CONTRACTOR_TYPE_LABELS[opt.value]}
                      blurb={opt.blurb}
                      onClick={() => setContractorType(opt.value)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Step: Role */}
            {showRole && (
              <section>
                <h1 className="text-xl font-bold text-ink-900">What's your role?</h1>
                <p className="mt-1.5 text-sm text-ink-600">Pick the account type that fits you best.</p>
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

            {/* Step: Work type */}
            {showWork && (
              <section>
                <h1 className="text-xl font-bold text-ink-900">Mitigation or construction?</h1>
                <p className="mt-1.5 text-sm text-ink-600">
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

            {/* Step: How you'll use Atmosphere */}
            {showUsage && (
              <section>
                <h1 className="text-xl font-bold text-ink-900">How do you plan to use Atmosphere?</h1>
                <p className="mt-1.5 text-sm text-ink-600">
                  Select everything that applies — you can change this later in Settings.
                </p>
                <div className="mt-5 space-y-2.5">
                  {USAGE_OPTIONS.map((opt) => (
                    <OptionCard
                      key={opt.value}
                      selected={usageIntents.includes(opt.value)}
                      title={USAGE_INTENT_LABELS[opt.value]}
                      blurb={opt.blurb}
                      onClick={() => toggleUsage(opt.value)}
                      multi
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
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-600 transition hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Back
              </button>

              {step < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={!canContinue}
                  className="rounded-lg bg-brand-500 px-5 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finish}
                  disabled={!canContinue || submitting}
                  className="flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
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
        active ? 'bg-brand-500 text-ink-900 shadow' : 'text-ink-600 hover:text-ink-900'
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
  multi = false,
}: {
  selected: boolean;
  title: string;
  blurb: string;
  onClick: () => void;
  multi?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
          : 'glass-card hover:border-line hover:bg-paper-100'
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border transition ${
          multi ? 'rounded-md' : 'rounded-full'
        } ${selected ? 'border-brand-400 bg-brand-500 text-ink-900' : 'border-line'}`}
      >
        {selected && <CheckIcon width={14} height={14} />}
      </span>
      <span>
        <span className="block font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-600">{blurb}</span>
      </span>
    </button>
  );
}
