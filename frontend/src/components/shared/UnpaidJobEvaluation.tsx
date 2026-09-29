import { SAMPLE_EVIDENCE, posterClock } from '../../lib/firstEvidence';
import { InvitePanel } from '../team/InvitePanel';
import { UpgradePrompt } from '../billing/ProductActionLock';
import { ShareJobProgressPanel } from './ShareJobProgressPanel';

/**
 * What an unpaid office can look at on its first job: the sample clip,
 * the invite form, and the homeowner-share form. Sending stays locked.
 */
export function UnpaidJobEvaluation({ jobId }: { jobId: string }) {
  return (
    <section className="mb-4 space-y-4" data-testid="unpaid-job-evaluation">
      <div className="rounded-xl border border-line bg-paper-0 p-4">
        <UpgradePrompt />
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-paper-0" data-testid="job-sample-evidence">
        <div className="flex items-center gap-3 border-b border-line bg-paper-50 p-3">
          <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-ink-900/80">
            <img src={SAMPLE_EVIDENCE.posterUrl} alt="" className="h-full w-full object-cover" />
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] font-semibold text-white">
              {posterClock(SAMPLE_EVIDENCE.durationSeconds)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-900">{SAMPLE_EVIDENCE.title}</p>
            <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
              Sample
            </span>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-ink-800">{SAMPLE_EVIDENCE.summary}</p>
          <p className="text-xs text-ink-500">This is a sample, not your data. Upload and recording stay locked until you choose a plan.</p>
        </div>
      </div>
      <InvitePanel />
      <ShareJobProgressPanel jobId={jobId} creating />
    </section>
  );
}
