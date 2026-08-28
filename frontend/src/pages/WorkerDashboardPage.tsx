import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  type FieldTodayJob,
  type JobSummary,
} from '../lib/api';
import { displayName, nameFromMetadata } from '../lib/display';
import {
  mergeWorkerJobs,
  reasonLabel,
  workerListIsUnassigned,
  type WorkerJobCard,
} from '../lib/workerBoard';
import { CameraIcon, ChevronRightIcon, GaugeIcon, UsersIcon, VideoIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

/**
 * The worker phone — same jobs Field Capture already knows, inside the office
 * console. Corporate Overview stays the company picture; this screen is what
 * one person is on today, with a film button sized for a thumb.
 */
export function WorkerDashboardPage() {
  useFeatureTimer('my_work');
  const { user, profile, membership } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [today, setToday] = useState<FieldTodayJob[] | null>(null);
  const [todayReady, setTodayReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getJobs({ status: 'all' }).then(({ jobs: next }) => next).catch(() => [] as JobSummary[]),
      api.fieldToday().then((res) => res.jobs).catch(() => null),
    ]).then(([nextJobs, nextToday]) => {
      if (cancelled) return;
      setJobs(nextJobs);
      setToday(nextToday);
      setTodayReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () => mergeWorkerJobs(today, jobs ?? [], user?.id ?? null),
    [today, jobs, user?.id],
  );
  const loaded = jobs != null && todayReady;
  const unassigned = workerListIsUnassigned(cards, user?.id ?? null);
  const name = displayName(profile?.fullName || nameFromMetadata(user?.metadata), user?.email);
  const first = name.split(/\s+/)[0] || 'there';
  const fieldTech = membership?.role === 'field_technician';
  const filmed = cards.filter((card) => card.filmed).length;

  return (
    <div data-testid="worker-dashboard" className="mx-auto w-full max-w-[430px]">
      <div className="overflow-hidden rounded-2xl border border-line bg-paper-0 shadow-xl shadow-ink-900/5 sm:rounded-[2rem]">
        <header className="border-b border-line px-5 pb-4 pt-5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-600">
            My work
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
            {loaded ? `Hi, ${first}` : 'My work'}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {fieldTech
              ? 'Jobs you are on. Film the day — the office reads it against the scope.'
              : 'Your assigned jobs. Company-wide proof lives on Overview.'}
          </p>
          {membership?.org?.name && (
            <p className="mt-1 text-xs text-ink-500">{membership.org.name}</p>
          )}
        </header>

        <div className="px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Today" value={loaded ? String(cards.length) : '—'} />
            <Stat label="Filmed" value={loaded ? String(filmed) : '—'} />
          </div>

          {unassigned && loaded && (
            <p className="mt-3 rounded-lg bg-paper-200/80 px-3 py-2 text-xs text-ink-600">
              You are not on a crew yet. These are the open jobs — the office can put you on
              one from the job file.
            </p>
          )}

          <section className="mt-4" aria-label="Your jobs">
            <h2 className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {unassigned ? 'Open jobs' : 'Your jobs'}
            </h2>
            {!loaded ? (
              <div className="mt-2 space-y-2">
                <div className="h-24 animate-pulse rounded-2xl bg-paper-200" />
                <div className="h-24 animate-pulse rounded-2xl bg-paper-200" />
              </div>
            ) : cards.length === 0 ? (
              <div className="mt-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center">
                <p className="text-sm font-medium text-ink-800">No jobs on your list</p>
                <p className="mt-1 text-xs text-ink-500">
                  When the office starts a job and puts you on the crew, it shows up here.
                </p>
                <Link
                  to="/field"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600"
                >
                  See what the company is doing
                  <ChevronRightIcon width={14} height={14} />
                </Link>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {cards.map((card) => (
                  <JobTile key={card.id} card={card} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <nav
          aria-label="Worker app"
          className="flex border-t border-line bg-paper-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Tab to="/my-work" label="Today" Icon={UsersIcon} current />
          <Tab to="/technician" label="Film" Icon={CameraIcon} />
          <Tab to="/field" label="Company" Icon={GaugeIcon} />
        </nav>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper-200/70 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-ink-900">{value}</p>
    </div>
  );
}

function JobTile({ card }: { card: WorkerJobCard }) {
  return (
    <li className="rounded-2xl border border-line bg-paper-50 p-3.5">
      <Link to={card.href} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {card.number && (
              <p className="font-mono text-[11px] text-ink-500">{card.number}</p>
            )}
            <p className="truncate text-sm font-semibold text-ink-900">{card.name}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
              card.filmed
                ? 'bg-brand-50 text-brand-700'
                  : card.reason === 'in_progress'
                  ? 'bg-caution-50 text-caution-600'
                  : 'bg-paper-200 text-ink-600'
            }`}
          >
            {reasonLabel(card.reason, card.filmed)}
          </span>
        </div>
        {card.address && <p className="mt-0.5 truncate text-xs text-ink-600">{card.address}</p>}
        {(card.at || card.crewNames.length > 0) && (
          <p className="mt-1 truncate text-[11px] text-ink-500">
            {[card.at, card.crewNames.length ? card.crewNames.join(', ') : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {card.lastEvent && (
          <p className="mt-1 line-clamp-2 text-[11px] text-ink-500">{card.lastEvent}</p>
        )}
      </Link>
      <Link
        to={card.filmHref}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
      >
        <VideoIcon width={16} height={16} />
        {card.filmed ? 'Add more film' : 'Film the day'}
      </Link>
    </li>
  );
}

function Tab({
  to,
  label,
  Icon,
  current,
}: {
  to: string;
  label: string;
  Icon: typeof UsersIcon;
  current?: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
        current ? 'text-brand-600' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      <Icon width={18} height={18} />
      {label}
    </Link>
  );
}
