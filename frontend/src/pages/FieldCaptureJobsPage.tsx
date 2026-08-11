import { useCallback, useEffect, useState } from 'react';
import { api, type FieldAppJob, type FieldAppOrgRef } from '../lib/api';
import { AppShell, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';

/**
 * GC Field Capture job finder — for this company’s Field Capture seats only.
 * Search open jobs in the org and open the recorder even if not personally
 * invited. Subcontractors working for a GC must use a per-job invite with the
 * subcontractor designation instead — they never browse the GC’s book here.
 */
export function FieldCaptureJobsPage() {
  const [q, setQ] = useState('');
  const [jobs, setJobs] = useState<FieldAppJob[] | null>(null);
  const [org, setOrg] = useState<FieldAppOrgRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setError(null);
    try {
      const res = query.trim()
        ? await api.fieldAppSearchJobs(query.trim())
        : await api.fieldAppTodayJobs();
      setJobs(res.jobs);
      setOrg(res.org);
    } catch (err) {
      setJobs([]);
      setError(err instanceof Error ? err.message : 'Could not load jobs.');
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load(q);
    }, q ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [q, load]);

  async function openCapture(jobId: string) {
    setBusyId(jobId);
    setError(null);
    try {
      const link = await api.fieldAppCaptureLink(jobId);
      window.location.assign(link.fieldCapturePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Field Capture for that job.');
      setBusyId(null);
    }
  }

  const company = org?.name ?? 'your company';

  return (
    <AppShell>
      <PageHeader
        eyebrow="On site"
        title="Film a job"
        description={`For ${company}’s Field Capture team only. Search this company’s open jobs — including ones you were not assigned to — when something comes up off-schedule. Subcontractors working for a general contractor must be invited to each job as a subcontractor; they do not use this screen.`}
      />

      <label className="block max-w-xl">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Find a job at {company}
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Address, job #, title, claim…"
          className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </label>
      <p className="mt-2 max-w-xl text-xs text-ink-500">
        Results are limited to {company}. Selecting a job attaches your Field Capture account so
        your office can see the day film — you do not need to have been on the original invite list.
      </p>

      {error ? (
        <div className="mt-4 max-w-xl">
          <ErrorNote message={error} />
        </div>
      ) : null}

      <div className="mt-6 max-w-2xl space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          {q.trim() ? `Matching ${company} jobs` : `${company} open jobs`}
        </p>
        {jobs === null ? (
          <PanelSpinner label="Loading jobs…" />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-ink-500">
            {q.trim()
              ? `No open ${company} jobs match that search.`
              : 'No open jobs yet for your company. Create one in intake, then refresh.'}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {job.number ? (
                      <span className="mr-2 font-mono text-xs font-medium text-ink-400">
                        {job.number}
                      </span>
                    ) : null}
                    {job.name}
                  </p>
                  <p className="truncate text-xs text-ink-500">{job.address}</p>
                </div>
                <span className="font-mono text-xs text-ink-400">{job.at}</span>
                <button
                  type="button"
                  onClick={() => void openCapture(job.id)}
                  disabled={busyId === job.id}
                  className="rounded-lg bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
                >
                  {busyId === job.id ? 'Opening…' : 'Open Field Capture'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
