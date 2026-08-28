import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type JobSummary,
  type SharedJobSummary,
} from '../lib/api';
import {
  ACTION_META,
  PIPELINE_META,
  buildOverview,
  emptyPulse,
  todayLine,
  type OverviewAction,
  type OverviewModel,
  type PipelineStage,
} from '../lib/companyOverview';
import { jobFilePath } from '../lib/jobFileAsk';
import { buildCrewBoard, type CrewBoardRow } from '../lib/workerBoard';
import { AlertIcon, BoltIcon, ChevronRightIcon, DecisionIcon, UsersIcon, VideoIcon } from '../components/icons';

/**
 * Overview is a decision queue, not a company dashboard.
 *
 * The office opens this tab to answer one question: what is stuck in the
 * proof chain, and what should I do next? Inventory (crew, contracted,
 * invoiced) belongs nowhere here — Atmosphere does not run the money loop.
 * A second job list belongs on Job Files. Clip counts without a job name are
 * vanity. This page names the file and the break.
 */

const TONE: Record<(typeof ACTION_META)[keyof typeof ACTION_META]['tone'], string> = {
  danger: 'bg-danger-50 text-danger-600',
  caution: 'bg-caution-50 text-caution-600',
  brand: 'bg-brand-50 text-brand-700',
  idle: 'bg-paper-200 text-ink-600',
};

export function PlatformHomePage({ platform: _platform }: { platform: string }) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [shared, setShared] = useState<SharedJobSummary[] | null>(null);
  const [pulse, setPulse] = useState(emptyPulse());
  const [pulseReady, setPulseReady] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getJobs({ status: 'all' }).then(({ jobs: next }) => next).catch(() => [] as JobSummary[]),
      api.sharedJobs().then(({ jobs: next }) => next).catch(() => [] as SharedJobSummary[]),
      api.proofPulse().catch(() => emptyPulse()),
    ]).then(([nextJobs, nextShared, nextPulse]) => {
      if (cancelled) return;
      setJobs(nextJobs);
      setShared(nextShared);
      setPulse({ ...emptyPulse(), ...nextPulse, byJob: nextPulse.byJob ?? [] });
      setPulseReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(
    () => buildOverview(jobs ?? [], shared ?? [], pulseReady ? pulse : null),
    [jobs, shared, pulse, pulseReady],
  );
  const loaded = jobs != null && shared != null && pulseReady;
  const crew = useMemo(() => buildCrewBoard(jobs ?? []), [jobs]);

  return (
    <div data-testid="company-overview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-600">Overview</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">What needs you</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Jobs where proof is stuck — film unread, briefs behind, questions unanswered. Open the
            file when you are ready to move it. Field Capture is the jobs a worker is on.
          </p>
        </div>
        <Link
          to="/my-work"
          aria-label="Open Field Capture"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-900/20 hover:bg-brand-500"
        >
          <UsersIcon width={16} height={16} />
          Field Capture
        </Link>
      </div>

      <PipelineStrip model={model} loaded={loaded} selected={stage} onSelect={setStage} />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl glass-card lg:col-span-2" aria-label="Do this next">
          <header className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">Do this next</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {!loaded
                  ? 'Loading the proof chain…'
                  : stage
                    ? `${PIPELINE_META[stage].label} — ${PIPELINE_META[stage].hint}`
                    : model.actions.length
                      ? `${model.actions.length} job${model.actions.length === 1 ? '' : 's'} off the proof path`
                      : 'Nothing waiting on you'}
              </p>
            </div>
            <Link to="/intake" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Start a job
            </Link>
          </header>
          <ActionList model={model} loaded={loaded} stage={stage} />
        </section>

        <div className="space-y-4">
          <TodayCard model={model} loaded={loaded} />
          <OnJobsCard crew={crew} loaded={loaded} />
        </div>
      </div>
    </div>
  );
}

function PipelineStrip({
  model,
  loaded,
  selected,
  onSelect,
}: {
  model: OverviewModel;
  loaded: boolean;
  selected: PipelineStage | null;
  onSelect: (stage: PipelineStage | null) => void;
}) {
  return (
    <section className="mt-6 rounded-xl glass-card px-3 py-3 sm:px-4" aria-label="Proof chain">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-2">
        <h2 className="text-[15px] font-semibold text-ink-900">Proof chain</h2>
        <p className="text-xs text-ink-500">
          {loaded
            ? `${model.openCount} open job${model.openCount === 1 ? '' : 's'} · click a stage to see those files`
            : 'Counting open jobs…'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {model.pipeline.map((bucket) => {
          const active = selected === bucket.stage;
          return (
            <button
              key={bucket.stage}
              type="button"
              onClick={() => onSelect(active ? null : bucket.stage)}
              aria-pressed={active}
              title={bucket.hint}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                active
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/20'
                  : 'bg-paper-200/70 text-ink-900 hover:bg-paper-200'
              }`}
            >
              <p
                className={`text-[10.5px] font-semibold uppercase tracking-[0.08em] ${
                  active ? 'text-white/80' : 'text-ink-500'
                }`}
              >
                {bucket.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
                {loaded ? bucket.count : '—'}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ActionList({
  model,
  loaded,
  stage,
}: {
  model: OverviewModel;
  loaded: boolean;
  stage: PipelineStage | null;
}) {
  if (!loaded) {
    return (
      <div className="space-y-2 px-5 py-4">
        <div className="h-14 animate-pulse rounded-lg bg-paper-200" />
        <div className="h-14 animate-pulse rounded-lg bg-paper-200" />
        <div className="h-14 animate-pulse rounded-lg bg-paper-200" />
      </div>
    );
  }

  if (model.openCount === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm font-medium text-ink-800">No job files yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
          Start a job — publish a brief, invite the crew, and this page will fill with what needs a
          decision.
        </p>
        <Link
          to="/intake"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
        >
          <BoltIcon width={14} height={14} />
          Start a job
        </Link>
      </div>
    );
  }

  const rows = stage ? model.jobs.filter((job) => job.stage === stage) : model.jobs.filter((job) => job.action);
  const showingActions = !stage;

  if (rows.length === 0) {
    return (
      <p className="px-5 py-8 text-sm text-ink-500">
        {showingActions
          ? 'Every open job is moving through the proof chain.'
          : `No open jobs in ${PIPELINE_META[stage!].label.toLowerCase()}.`}
      </p>
    );
  }

  return (
    <ul>
      {rows.map((row) =>
        row.action ? (
          <ActionRow key={row.jobId} action={row.action} />
        ) : (
          <QuietRow key={row.jobId} title={row.title} jobId={row.jobId} jobNumber={row.jobNumber} />
        ),
      )}
    </ul>
  );
}

function ActionRow({ action }: { action: OverviewAction }) {
  const meta = ACTION_META[action.kind];
  return (
    <li>
      <Link
        to={action.href}
        className="flex items-start gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
      >
        <AlertIcon
          width={15}
          height={15}
          className={`mt-0.5 shrink-0 ${
            meta.tone === 'danger'
              ? 'text-danger-600'
              : meta.tone === 'caution'
                ? 'text-caution-600'
                : 'text-ink-500'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {action.jobNumber != null && (
              <span className="font-mono text-xs text-ink-500">#{action.jobNumber}</span>
            )}
            <span className="truncate text-sm font-semibold text-ink-900">{action.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[meta.tone]}`}>
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-700">{action.headline}</p>
          <p className="mt-0.5 text-[13px] text-ink-500">{action.detail}</p>
          {action.notes.length > 0 && (
            <p className="mt-1 truncate text-xs text-ink-400">{action.notes.join(' · ')}</p>
          )}
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-600">
          {meta.verb}
          <ChevronRightIcon width={14} height={14} />
        </span>
      </Link>
    </li>
  );
}

function QuietRow({
  title,
  jobId,
  jobNumber,
}: {
  title: string;
  jobId: string;
  jobNumber: number | null;
}) {
  return (
    <li>
      <Link
        to={jobFilePath(jobId, { title, number: jobNumber })}
        className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5 last:border-b-0 hover:bg-paper-200"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
          <p className="mt-0.5 text-[13px] text-ink-500">Moving — nothing waiting on you</p>
        </div>
        {jobNumber != null && <span className="shrink-0 font-mono text-[11px] text-ink-400">#{jobNumber}</span>}
      </Link>
    </li>
  );
}

function TodayCard({ model, loaded }: { model: OverviewModel; loaded: boolean }) {
  return (
    <section className="rounded-xl glass-card" aria-label="Today's film">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Today&apos;s film</h2>
          <p className="mt-0.5 text-xs text-ink-500">{loaded ? todayLine(model) : 'Checking the pipeline…'}</p>
        </div>
        <Link to="/verifier-library" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Dashboard
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-line">
        <TodayStat
          icon={<VideoIcon width={14} height={14} />}
          label="Filmed today"
          value={loaded ? String(model.today.filmed) : '—'}
        />
        <TodayStat
          icon={<DecisionIcon width={14} height={14} />}
          label="Waiting to be read"
          value={loaded ? String(model.today.unread) : '—'}
        />
        <TodayStat label="Being read" value={loaded ? String(model.today.analysing) : '—'} />
        <TodayStat
          label="Failed"
          value={loaded ? String(model.today.failed) : '—'}
          danger={loaded && model.today.failed > 0}
        />
      </dl>
      <div className="px-5 py-3">
        <Link
          to="/verifier-library"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Open the library
          <ChevronRightIcon width={14} height={14} />
        </Link>
      </div>
    </section>
  );
}

function TodayStat({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="bg-paper-0 px-5 py-3.5">
      <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {icon}
        {label}
      </dt>
      <dd
        className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${
          danger ? 'text-danger-600' : 'text-ink-900'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function OnJobsCard({ crew, loaded }: { crew: CrewBoardRow[]; loaded: boolean }) {
  return (
    <section className="rounded-xl glass-card" aria-label="Who is on jobs">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Who is on jobs</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {loaded
              ? crew.length
                ? `${crew.length} ${crew.length === 1 ? 'person' : 'people'} on open work`
                : 'Nobody assigned yet'
              : 'Checking the crew…'}
          </p>
        </div>
        <Link to="/my-work" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Field Capture
        </Link>
      </header>
      {!loaded ? (
        <div className="space-y-2 px-5 py-4">
          <div className="h-10 animate-pulse rounded-lg bg-paper-200" />
          <div className="h-10 animate-pulse rounded-lg bg-paper-200" />
        </div>
      ) : crew.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">
          Put people on a job from the file. They will see it in Field Capture.
        </p>
      ) : (
        <ul>
          {crew.slice(0, 8).map((row) => (
            <li key={row.userId} className="border-b border-line px-5 py-3 last:border-b-0">
              <p className="text-sm font-semibold text-ink-900">{row.name}</p>
              <p className="mt-0.5 truncate text-xs text-ink-500">
                {row.jobs
                  .map((job) => (job.jobNumber != null ? `#${job.jobNumber} ${job.title}` : job.title))
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
