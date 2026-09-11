import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { grantStatusLabel, HOMEOWNER_HUB_PATH } from '../lib/homeownerHub';
import { useAuth } from '../context/AuthContext';
import { SpinnerIcon } from '../components/icons';

/**
 * One screen, every vendor.
 *
 * Homeowners (and counsel / banks) who claimed progress shares from more than
 * one contractor need a place that is theirs — not office Overview, and not
 * the sub `/my-jobs` list. Each row is a job file they can open; nothing
 * here is shared upward to the vendors.
 */

export type HomeownerJobFile = {
  orgId: string;
  jobId: string;
  path: string;
  orgName: string;
  jobTitle: string;
  status: string | null;
};

export function presentHomeownerJobFiles(
  grants: Array<{
    orgId: string;
    jobId: string;
    path: string;
    orgName?: string;
    jobTitle?: string;
    status?: string | null;
  }>,
): HomeownerJobFile[] {
  return grants.map((grant) => ({
    orgId: grant.orgId,
    jobId: grant.jobId,
    path: grant.path || `/job-progress?job=${encodeURIComponent(grant.jobId)}`,
    orgName: grant.orgName?.trim() || 'Contractor',
    jobTitle: grant.jobTitle?.trim() || 'Job',
    status: grant.status ?? null,
  }));
}

export function groupHomeownerJobFiles(files: HomeownerJobFile[]): Array<{
  orgId: string;
  orgName: string;
  jobs: HomeownerJobFile[];
}> {
  const groups: Array<{ orgId: string; orgName: string; jobs: HomeownerJobFile[] }> = [];
  const index = new Map<string, number>();
  for (const file of files) {
    const existing = index.get(file.orgId);
    if (existing === undefined) {
      index.set(file.orgId, groups.length);
      groups.push({ orgId: file.orgId, orgName: file.orgName, jobs: [file] });
    } else {
      groups[existing]!.jobs.push(file);
    }
  }
  return groups;
}

export function MyJobFilesPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState<HomeownerJobFile[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .progressShareGrants()
      .then((res) => {
        if (cancelled) return;
        setFiles(presentHomeownerJobFiles(res.grants));
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : 'Could not load your job files.');
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupHomeownerJobFiles(files ?? []), [files]);
  const total = files?.length ?? 0;

  async function signOut() {
    await logout().catch(() => undefined);
    navigate('/');
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="flex items-center gap-2 text-sm text-ink-600">
          <SpinnerIcon className="animate-spin" width={14} height={14} />
          Finding your job files…
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-lg font-semibold text-ink-900">Your job files</h1>
        <p className="mt-2 text-sm text-ink-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8" data-testid="my-job-files">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">Your job files</h1>
          <p className="mt-0.5 text-xs text-ink-500">
            {total} {total === 1 ? 'job' : 'jobs'} from {groups.length}{' '}
            {groups.length === 1 ? 'company' : 'companies'}
          </p>
        </div>
        <button onClick={() => void signOut()} className="text-xs font-medium text-ink-500 hover:text-ink-700">
          Sign out
        </button>
      </header>

      {groups.map((group) => (
        <section key={group.orgId} className="mt-7" data-org={group.orgId}>
          <h2 className="text-sm font-semibold text-ink-800">{group.orgName}</h2>
          <ul className="mt-2 space-y-2">
            {group.jobs.map((job) => (
              <li key={job.jobId}>
                <Link
                  to={job.path}
                  className="block rounded-xl border border-line bg-paper-50 px-4 py-3 hover:border-brand-300"
                  data-job={job.jobId}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink-900">{job.jobTitle}</p>
                    {grantStatusLabel(job.status) && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase text-ink-500">
                        {grantStatusLabel(job.status)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-500">{job.orgName}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {total === 0 && (
        <p className="mt-6 text-sm text-ink-600">
          Nothing here yet. Open a share link from your email — the job will show up on this
          screen.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-4 text-[11px] text-ink-500">
        This list is yours. Each vendor can see that you opened the invite they sent you, and
        nothing about the others.
      </p>
    </main>
  );
}
