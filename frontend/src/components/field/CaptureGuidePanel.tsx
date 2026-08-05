import { useEffect, useState } from 'react';
import { api, type CaptureGuide, type JobSummary } from '../../lib/api';

/**
 * The shot list, on the crew's own capture screen.
 *
 * Same guide the subcontractor sees through their link, through the org door:
 * pick the job, pick which half of the day, film in the order given. The
 * anchor step leads for the same reason everywhere — verification is only as
 * strong as an opening shot that proves which building this is — and the
 * model checks the habit on every analysed day.
 */
export function CaptureGuidePanel() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [jobId, setJobId] = useState<string>('');
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  const [guide, setGuide] = useState<CaptureGuide | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .getJobs({ status: 'in_progress' })
      .then((res) => {
        setJobs(res.jobs);
        if (res.jobs.length > 0) setJobId(res.jobs[0].jobId);
      })
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    if (!jobId) {
      setGuide(null);
      return;
    }
    let cancelled = false;
    api
      .captureGuide(jobId, phase)
      .then((res) => {
        if (!cancelled) setGuide(res.guide);
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, phase]);

  if (jobs !== null && jobs.length === 0) return null;

  return (
    <section className="rounded-xl glass-card p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-ink-900">Proof filming guide</span>
        <span className="text-xs text-ink-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      <p className="mt-0.5 text-xs text-ink-500">
        Where to point the camera, in order — starting outside, because the opening shot is what
        proves the footage is this site.
      </p>

      {open && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg glass-field px-2.5 py-1.5 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              aria-label="Job"
            >
              {(jobs ?? []).map((job) => (
                <option key={job.jobId} value={job.jobId}>
                  #{job.jobNumber} — {job.title}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg glass-card p-0.5">
              {(['before', 'after'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${
                    phase === p ? 'bg-brand-600 text-white' : 'text-ink-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {guide && (
            <>
              <ol className="mt-3 space-y-2">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        step.kind === 'anchor' ? 'bg-brand-600 text-white' : 'bg-paper-200 text-ink-600'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span>
                      <span
                        className={step.kind === 'anchor' ? 'font-semibold text-ink-900' : 'text-ink-800'}
                      >
                        {step.kind === 'anchor' && <span className="text-brand-600">Start here: </span>}
                        {step.instruction}
                      </span>
                      <span className="block text-[11px] text-ink-500">{step.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-ink-400">
                Aim for about {Math.max(1, Math.round(guide.targetSeconds / 60))} min. One continuous
                clip beats five fragments.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
