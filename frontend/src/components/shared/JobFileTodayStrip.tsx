import { useEffect, useMemo, useState } from 'react';
import { api, type ProofQuestion, type ProofResponse, type SharedJobRecord } from '../../lib/api';
import {
  jobFileToday,
  jobFileTodayHasChange,
  pluralCount,
} from '../../lib/jobFileToday';

/**
 * One compact line on the job file: what landed today.
 * Not a card dump — clips, scope, and unanswered Ask only.
 */
export function JobFileTodayStrip({
  jobId,
  record,
  proofs,
  questions,
  now,
}: {
  jobId: string;
  record: SharedJobRecord | null;
  proofs?: ProofResponse | null;
  questions?: ProofQuestion[];
  now?: Date;
}) {
  const [ownProofs, setOwnProofs] = useState<ProofResponse | null>(null);
  const [ownQuestions, setOwnQuestions] = useState<ProofQuestion[]>([]);
  const preloaded = proofs !== undefined && questions !== undefined;

  useEffect(() => {
    if (preloaded || !jobId) return;
    let cancelled = false;
    Promise.all([
      api.jobProofs(jobId).catch(() => null),
      api.proofQuestions(jobId).catch(() => ({ questions: [] as ProofQuestion[] })),
    ]).then(([nextProofs, nextQuestions]) => {
      if (cancelled) return;
      setOwnProofs(nextProofs);
      setOwnQuestions(nextQuestions.questions);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, preloaded]);

  const change = useMemo(
    () =>
      jobFileToday({
        proofs: proofs !== undefined ? proofs : ownProofs,
        scope: record?.scope ?? [],
        questions: questions !== undefined ? questions : ownQuestions,
        now,
      }),
    [proofs, ownProofs, record, questions, ownQuestions, now],
  );

  if (!jobFileTodayHasChange(change)) return null;

  const bits: string[] = [];
  if (change.clips.length) bits.push(pluralCount(change.clips.length, 'new clip', 'new clips'));
  if (change.scope.length) bits.push(pluralCount(change.scope.length, 'new scope line', 'new scope lines'));
  if (change.unansweredAsk.length) {
    bits.push(pluralCount(change.unansweredAsk.length, 'unanswered Ask', 'unanswered Ask items'));
  }

  return (
    <div
      data-testid="job-file-today"
      className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-line bg-paper-50/80 px-3 py-2 text-sm"
    >
      <span className="shrink-0 font-semibold text-ink-900">What changed today</span>
      <span className="min-w-0 text-ink-600">{bits.join(' · ')}</span>
    </div>
  );
}
