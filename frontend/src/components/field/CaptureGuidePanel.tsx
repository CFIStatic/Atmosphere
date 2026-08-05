import { useEffect, useState } from 'react';
import { api, type CaptureGuide, type JobSummary } from '../../lib/api';
import { CaptureGuideSteps } from '../shared/CaptureGuideSteps';

/**
 * The shot list, flowing into the camera below it.
 *
 * Same rail the subcontractor sees through their link — one visual language
 * for filming proof, wherever it is filmed from. Here the rail's last node is
 * not a button: the camera panel sits directly underneath this component, so
 * the final step simply hands off to it. No hide/show, no ceremony — a crew
 * that has to open a drawer to find the instructions will not open it twice.
 */
export function CaptureGuidePanel({
  onContext,
}: {
  /**
   * Reports the selected job and phase upward, so the camera panel below can
   * run live monitoring against the same shot list this guide is showing.
   */
  onContext?: (context: { jobId: string; phase: 'before' | 'after' } | null) => void;
}) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [jobId, setJobId] = useState<string>('');
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  const [guide, setGuide] = useState<CaptureGuide | null>(null);

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
    onContext?.(jobId ? { jobId, phase } : null);
  }, [jobId, phase, onContext]);

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

  // No jobs, no guide — the capture tools below still work on their own.
  if (jobs !== null && jobs.length === 0) return null;

  return (
    <section className="rounded-xl glass-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900">Film the proof</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            In this order — the opening shot is what proves the footage is this site.
          </p>
        </div>
        <div className="flex rounded-lg glass-card p-0.5" role="group" aria-label="Which half of the day">
          {(['before', 'after'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              aria-pressed={phase === p}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                phase === p ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {jobs !== null && jobs.length > 1 ? (
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="mt-2.5 w-full rounded-lg glass-field px-2.5 py-1.5 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          aria-label="Job"
        >
          {jobs.map((job) => (
            <option key={job.jobId} value={job.jobId}>
              #{job.jobNumber} — {job.title}
            </option>
          ))}
        </select>
      ) : jobs?.length === 1 ? (
        <p className="mt-2 text-xs font-medium text-ink-700">
          #{jobs[0].jobNumber} — {jobs[0].title}
        </p>
      ) : null}

      {guide && (
        <CaptureGuideSteps
          steps={guide.steps}
          final={
            <p className="pt-0.5 text-xs text-ink-800">
              <span className="font-semibold">Record below</span>
              <span className="text-ink-500">
                {' '}
                — one continuous clip, about {Math.max(1, Math.round(guide.targetSeconds / 60))} min.
                Fragments compare worse than one walk.
              </span>
            </p>
          }
        />
      )}
    </section>
  );
}
