import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { SpinnerIcon } from '../components/icons';
import {
  billingStepHref,
  fieldCaptureOpenUrl,
  readFirstRun,
  writeFirstRun,
  type FirstRunState,
} from '../lib/firstRun';
import { jobFilePath } from '../lib/jobFileAsk';
import { safeAuthRedirect } from '../lib/authRedirect';
import { firstClipPreview, posterClock, SAMPLE_EVIDENCE, type FirstClipPreview } from '../lib/firstEvidence';

const POLL_MS = 5000;

/**
 * Value before payment. A new Global Admin names the first job, then either
 * records it in Field Capture or sees labeled sample evidence, and only then
 * picks a plan. Collaborators and homeowner sharing wait for the job file.
 */
export function FirstRunPage() {
  const { membership, membershipLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orgId = membership?.org?.id ?? null;
  // Progress lives in localStorage per org; bump re-reads it after a write.
  const [version, setVersion] = useState(0);
  const state: FirstRunState = useMemo(() => {
    void version;
    return readFirstRun(orgId);
  }, [orgId, version]);
  const save = (patch: FirstRunState) => {
    writeFirstRun(orgId, patch);
    setVersion((v) => v + 1);
  };
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<FirstClipPreview | null>(null);
  const [billingDone, setBillingDone] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getBillingOnboarding()
      .then((status) => {
        if (!cancelled) setBillingDone(!(status.required && !status.complete));
      })
      .catch(() => {
        if (!cancelled) setBillingDone(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Field path: watch for the first clip to reach the office.
  const watchJob = state.path === 'field' ? state.jobId : undefined;
  useEffect(() => {
    if (!watchJob) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const [proofs, library] = await Promise.all([
          api.jobProofs(watchJob),
          api.evidenceLibrary(watchJob).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const preview = firstClipPreview(proofs, library.items);
        setClip(preview);
        if (preview && orgId) {
          writeFirstRun(orgId, { evidenceSeen: true });
          setVersion((v) => v + 1);
        }
        if (preview && !preview.processing) return;
      } catch {
        /* keep waiting */
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [watchJob, orgId]);

  if (membershipLoading || billingDone === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }
  if (!membership?.org) return <Navigate to="/signup" replace />;

  const jobHref = state.jobId
    ? jobFilePath(state.jobId, { title: state.jobTitle, number: state.jobNumber ?? null })
    : safeAuthRedirect(params.get('next')) || '/intake';
  if (billingDone) return <Navigate to={jobHref} replace />;

  async function createJob(e: FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (name.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.approveIntake({ title: name, scope: [], invitees: [] });
      save({ jobId: res.job.id, jobTitle: res.job.title, jobNumber: res.job.jobNumber });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the job. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function choose(path: 'field' | 'office') {
    save({ path, evidenceSeen: path === 'office' ? true : state.evidenceSeen });
    if (path === 'field') window.open(fieldCaptureOpenUrl(), '_blank', 'noopener');
  }

  function continueToPlan() {
    navigate(billingStepHref(jobHref));
  }

  const stage = !state.jobId ? 'job' : !state.path ? 'choose' : 'evidence';

  return (
    <div className="flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-8 sm:px-10">
        <Logo size="lg" />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => logout()}
            className="text-sm text-ink-600 transition hover:text-ink-900"
          >
            Sign out
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16">
        <div className="w-full max-w-xl">
          <FirstRunSteps stage={stage} />

          {stage === 'job' && (
            <Card title="Name your first job" subtitle="One name is enough. Details and invites come later.">
              <form onSubmit={createJob} className="mt-5 space-y-4" noValidate>
                <label htmlFor="first-job-name" className="block text-sm font-medium text-ink-700">
                  Job name
                </label>
                <input
                  id="first-job-name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Smith kitchen leak"
                  autoFocus
                  className="w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                />
                {error ? (
                  <p role="alert" className="text-sm text-danger-700">
                    {error}
                  </p>
                ) : null}
                <Primary type="submit" disabled={title.trim().length < 2 || busy}>
                  {busy ? 'Creating…' : 'Create job'}
                </Primary>
              </form>
            </Card>
          )}

          {stage === 'choose' && (
            <Card title={`${state.jobTitle ?? 'Your job'} is ready`} subtitle="How do you want to see your first evidence?">
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <ChoiceButton
                  testId="first-run-field"
                  title="I'm in the field"
                  detail="Record the first clip in Field Capture on your phone. It shows up here when it uploads."
                  onClick={() => choose('field')}
                />
                <ChoiceButton
                  testId="first-run-office"
                  title="I'm in the office"
                  detail="See what a recorded clip turns into: transcript, summary and Ask with timestamps."
                  onClick={() => choose('office')}
                />
              </div>
            </Card>
          )}

          {stage === 'evidence' && state.path === 'field' && (
            <Card
              title={clip ? 'Your first evidence' : 'Waiting for first clip'}
              subtitle={
                clip
                  ? clip.processing
                    ? 'Uploaded. Transcript and summary are processing.'
                    : 'Transcript and summary from your recording.'
                  : 'Open Field Capture on your phone, pick this job and record. Keep this page open.'
              }
            >
              {clip ? (
                <ClipCard
                  title={clip.title}
                  posterUrl={clip.posterUrl}
                  durationSeconds={clip.durationSeconds}
                  summary={clip.summary}
                  lines={clip.lines}
                  processing={clip.processing}
                />
              ) : (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <a
                    href={fieldCaptureOpenUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-line bg-paper-0 px-4 py-2.5 text-sm font-semibold text-ink-900 hover:border-brand-300"
                  >
                    Open Field Capture
                  </a>
                  <span className="text-sm text-ink-500">app.atmosphereteam.com, same login</span>
                </div>
              )}
              <PlanFooter onContinue={continueToPlan} ready={Boolean(clip)} onSwitch={() => choose('office')} />
            </Card>
          )}

          {stage === 'evidence' && state.path === 'office' && (
            <Card title="Sample evidence" subtitle="This is a sample, not your data. Your own clips look like this.">
              <ClipCard
                sample
                title={SAMPLE_EVIDENCE.title}
                posterUrl={null}
                durationSeconds={SAMPLE_EVIDENCE.durationSeconds}
                summary={SAMPLE_EVIDENCE.summary}
                lines={[...SAMPLE_EVIDENCE.lines]}
                ask={SAMPLE_EVIDENCE.ask}
              />
              <PlanFooter onContinue={continueToPlan} ready />
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function FirstRunSteps({ stage }: { stage: 'job' | 'choose' | 'evidence' }) {
  const steps = [
    { key: 'account', label: 'Account' },
    { key: 'job', label: 'First job' },
    { key: 'evidence', label: 'First evidence' },
    { key: 'plan', label: 'Plan & invites' },
  ];
  const at = stage === 'job' ? 1 : 2;
  return (
    <ol className="mb-5 flex flex-wrap gap-2 text-xs font-semibold" aria-label="Setup progress">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at ? 'step' : undefined}
          className={`rounded-full px-3 py-1 ${
            i < at ? 'bg-brand-50 text-brand-700' : i === at ? 'bg-brand-500 text-ink-900' : 'bg-paper-0 text-ink-500 border border-line'
          }`}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper-0 p-6 shadow-sm sm:p-7">
      <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
      <p className="mt-1.5 text-sm text-ink-600">{subtitle}</p>
      {children}
    </section>
  );
}

function Primary({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[180px]"
    >
      {children}
    </button>
  );
}

function ChoiceButton({
  title,
  detail,
  onClick,
  testId,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="rounded-xl border border-line bg-paper-0 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/60 focus:outline-none focus:ring-2 focus:ring-brand-200"
    >
      <span className="block text-base font-semibold text-ink-900">{title}</span>
      <span className="mt-1 block text-sm text-ink-600">{detail}</span>
    </button>
  );
}

function ClipCard({
  title,
  posterUrl,
  durationSeconds,
  summary,
  lines,
  processing,
  sample,
  ask,
}: {
  title: string;
  posterUrl: string | null;
  durationSeconds: number | null;
  summary: string | null;
  lines: Array<{ at: string; text: string }>;
  processing?: boolean;
  sample?: boolean;
  ask?: { question: string; answer: string };
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-line" data-testid={sample ? 'sample-evidence' : 'first-clip'}>
      <div className="flex items-center gap-3 border-b border-line bg-paper-50 p-3">
        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-ink-900/80">
          {posterUrl ? <img src={posterUrl} alt="" className="h-full w-full object-cover" /> : null}
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] font-semibold text-white">
            {posterClock(durationSeconds)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900">{title}</p>
          {sample ? (
            <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
              Sample
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-4 p-4">
        {summary ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Summary</p>
            <p className="mt-1 text-sm text-ink-800">{summary}</p>
          </div>
        ) : processing ? (
          <p role="status" className="text-sm text-ink-600">
            Summary still processing.
          </p>
        ) : null}
        {lines.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">What was said</p>
            <ul className="mt-1 space-y-1 text-sm text-ink-800">
              {lines.map((line) => (
                <li key={`${line.at}-${line.text}`}>
                  <span className="mr-2 font-mono text-xs text-brand-700">{line.at}</span>“{line.text}”
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {ask ? (
          <div className="rounded-lg bg-paper-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Ask</p>
            <p className="mt-1 text-sm font-medium text-ink-900">{ask.question}</p>
            <p className="mt-1 text-sm text-ink-700">{ask.answer}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlanFooter({
  onContinue,
  ready,
  onSwitch,
}: {
  onContinue: () => void;
  ready: boolean;
  onSwitch?: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-600">
        {ready
          ? 'Next: pick a plan, then invite your team from the job file.'
          : 'No phone handy? '}
        {!ready && onSwitch ? (
          <button type="button" onClick={onSwitch} className="font-medium text-brand-600 hover:text-brand-700">
            See sample evidence instead
          </button>
        ) : null}
      </p>
      <Primary onClick={onContinue} disabled={!ready}>
        Choose a plan
      </Primary>
    </div>
  );
}
