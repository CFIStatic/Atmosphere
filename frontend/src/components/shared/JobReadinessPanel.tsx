import { useEffect, useState } from 'react';
import { api, type JobReadiness, type ReadinessCeiling } from '../../lib/api';

/**
 * What this job can prove today.
 *
 * The panel exists because the gaps in a job file are invisible until the
 * moment they are expensive: the crew has filmed, gone home, and the report
 * says "location unknown" because nobody ever gave the job an address.
 *
 * Two design rules follow from that, and they fight the obvious version of
 * this component:
 *
 *   It is a forecast, not a gate. Nothing here disables anything. A job with
 *   no scope still gets filmed, and the panel says so in the first line —
 *   because a crew told "you cannot film this yet" by a web page will simply
 *   film it on their own phone, and then the evidence is nobody's.
 *
 *   Every gap carries its price. "Missing address" is a nag. "Every clip will
 *   read location unknown" is a reason. The office fixes the second one.
 */

const CEILING_STYLE: Record<ReadinessCeiling, string> = {
  full: 'bg-success-50 text-success-600',
  work_only: 'bg-caution-50 text-caution-600',
  filed_only: 'bg-danger-50 text-danger-600',
};

const CEILING_WORD: Record<ReadinessCeiling, string> = {
  full: 'Work, place and time',
  work_only: 'Work only — no location',
  filed_only: 'Filed, not verified',
};

export function JobReadinessPanel({ jobId, refreshKey }: { jobId: string; refreshKey?: number }) {
  const [readiness, setReadiness] = useState<JobReadiness | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    api
      .jobReadiness(jobId)
      .then((res) => {
        if (!cancelled) {
          setReadiness(res.readiness);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  if (!loaded) {
    return (
      <section className="rounded-xl glass-card p-5">
        <p className="text-xs text-ink-500">Checking what this job can prove…</p>
      </section>
    );
  }
  if (!readiness) return null;

  return (
    <section className="rounded-xl glass-card p-5" data-readiness={readiness.level}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Before the crew films</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${CEILING_STYLE[readiness.ceiling]}`}
          data-ceiling={readiness.ceiling}
        >
          {CEILING_WORD[readiness.ceiling]}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-700">{readiness.headline}</p>

      {readiness.gaps.length > 0 && (
        <ul className="mt-3 space-y-2">
          {readiness.gaps.map((gap) => (
            <li
              key={gap.key}
              className={`rounded-lg border px-3 py-2 ${
                gap.severity === 'blocking'
                  ? 'border-danger-200 bg-danger-50/50'
                  : 'border-caution-200 bg-caution-50/40'
              }`}
            >
              <p className="text-sm font-medium text-ink-800">{gap.what}</p>
              <p className="mt-0.5 text-xs text-ink-600">{gap.costs}</p>
              <p className="mt-1 text-xs text-brand-600">{gap.fix}</p>
            </li>
          ))}
        </ul>
      )}

      {readiness.strengths.length > 0 && (
        <p className="mt-3 text-[11px] text-ink-500">
          Already here: {readiness.strengths.join(' · ')}
        </p>
      )}
    </section>
  );
}
