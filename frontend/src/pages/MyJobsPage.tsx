import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ClaimedJob, type FieldJobList } from '../lib/api';
import { jobSharePagePath } from '../lib/jobSharePath';
import { SpinnerIcon } from '../components/icons';

/**
 * One screen, every general contractor.
 *
 * This is the answer to the problem the whole identity feature exists for: a
 * sub who works for six GCs holds eighteen links and cannot find the one for
 * the house they are parked in front of.
 *
 * Two things carry the design.
 *
 *   Today comes first, and today ignores who the employer is. At 7am the only
 *   question is where to go, and a crew's day does not organize itself by
 *   which general contractor is paying for it. So the top of the screen is a
 *   flat list across all of them, and the by-GC grouping is what you scroll
 *   to when you are looking for something specific.
 *
 *   Nothing here is shared upward. The list spans organizations, which means
 *   it is the sub's and only the sub's — a GC reading their own screen sees
 *   who claimed their invitations and nothing about anybody else's. Saying so
 *   in plain words at the bottom is not decoration; a sub who suspects this
 *   screen reports back to their GC will stop using it.
 */

const SESSION_KEY = 'atm.field.session';

export function readFieldSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeFieldSession(token: string) {
  try {
    window.localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* A phone in private mode still works; it just asks again next time. */
  }
}

export function clearFieldSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

export function MyJobsPage() {
  const [list, setList] = useState<FieldJobList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const session = readFieldSession();
    if (!session) {
      setError('Open one of your job links to sign in.');
      setLoaded(true);
      return;
    }
    api
      .fieldJobs(session)
      .then((res) => {
        setList(res);
        setLoaded(true);
      })
      .catch((err) => {
        // An expired session is not an error to argue with — clear it and say
        // the one thing that fixes it.
        clearFieldSession();
        setError(
          err instanceof Error && err.message
            ? `${err.message} Open one of your job links to sign in again.`
            : 'Open one of your job links to sign in again.',
        );
        setLoaded(true);
      });
  }, []);

  async function signOut() {
    const session = readFieldSession();
    if (session) await api.fieldSignOut(session).catch(() => undefined);
    clearFieldSession();
    navigate('/');
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="flex items-center gap-2 text-sm text-ink-600">
          <SpinnerIcon className="animate-spin" width={14} height={14} />
          Finding your jobs…
        </p>
      </main>
    );
  }

  if (error || !list) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-lg font-semibold text-ink-900">Your jobs</h1>
        <p className="mt-2 text-sm text-ink-600">{error}</p>
      </main>
    );
  }

  const total = list.generalContractors.reduce((n, g) => n + g.jobs.length, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8" data-testid="my-jobs">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Your jobs</h1>
          <p className="mt-0.5 text-xs text-ink-500">
            {total} {total === 1 ? 'job' : 'jobs'} from {list.generalContractors.length}{' '}
            {list.generalContractors.length === 1 ? 'general contractor' : 'general contractors'} ·{' '}
            {list.identity.contact}
          </p>
        </div>
        <button onClick={() => void signOut()} className="text-xs font-medium text-ink-500 hover:text-ink-700">
          Sign out
        </button>
      </header>

      {list.today.length > 0 && (
        <section className="mt-6" data-testid="today">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-wide text-brand-600">Today</h2>
          <ul className="mt-2 space-y-2">
            {list.today.map((job) => (
              <JobCard key={job.partyId} job={job} showOrg />
            ))}
          </ul>
        </section>
      )}

      {list.generalContractors.map((group) => (
        <section key={group.orgId} className="mt-7" data-org={group.orgId}>
          <h2 className="text-sm font-semibold text-ink-800">{group.orgName}</h2>
          <ul className="mt-2 space-y-2">
            {group.jobs.map((job) => (
              <JobCard key={job.partyId} job={job} showOrg={false} />
            ))}
          </ul>
        </section>
      ))}

      {total === 0 && (
        <p className="mt-6 text-sm text-ink-600">
          Nothing here yet. Open a job link from a general contractor and choose “put my jobs in
          one place” — it will show up on this screen.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-[11px] text-ink-500">
        This screen is yours. Each general contractor can see that you opened the link they sent
        you, and nothing about the others.
      </p>
    </main>
  );
}

function JobCard({ job, showOrg }: { job: ClaimedJob; showOrg: boolean }) {
  return (
    <li>
      <Link
        to={jobSharePagePath(job.accessToken)}
        className="block rounded-xl border border-line bg-paper-50 px-4 py-3 hover:border-brand-300"
        data-job={job.jobId}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-ink-900">{job.jobTitle}</p>
          {job.trade && (
            <span className="shrink-0 rounded-full bg-paper-200/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-600">
              {job.trade}
            </span>
          )}
        </div>
        {job.address && <p className="mt-0.5 text-xs text-ink-600">{job.address}</p>}
        {(when(job.scheduledStart) || showOrg) && (
          <p className="mt-1 text-[11px] text-ink-500">
            {[when(job.scheduledStart), showOrg ? job.orgName : ''].filter(Boolean).join(' · ')}
          </p>
        )}
      </Link>
    </li>
  );
}
