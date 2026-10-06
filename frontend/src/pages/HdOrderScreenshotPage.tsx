/**
 * Dev-only page for ship screenshots of HD materials + Approve cards.
 * Uses Sample Job 058b09a8 evidence + real public Homedepot.com listings.
 * Not linked from product nav.
 */
import { MaterialsListCard } from '../components/computer/MaterialsListCard';
import { ComputerApprovalCard } from '../components/computer/ComputerApprovalCard';
import type { ComputerTaskApproval } from '../lib/computer';
import fixture from '../dev/hdOrderV2Fixture.json';

export default function HdOrderScreenshotPage() {
  const approval = {
    id: 'screenshot-approve',
    actionKind: fixture.approve.actionKind as ComputerTaskApproval['actionKind'],
    buttonLabel: fixture.approve.buttonLabel,
    summary: fixture.approve.summary,
    pageUrl: fixture.approve.pageUrl,
    fields: fixture.approve.fields,
    screenshot: fixture.approve.screenshot,
    status: 'pending' as const,
    requestedAt: '2026-10-05T18:40:00-05:00',
    expiresAt: '2026-10-05T19:40:00-05:00',
  } satisfies ComputerTaskApproval;

  return (
    <div className="min-h-screen bg-paper-100 px-6 py-8 text-ink-900" data-testid="hd-order-screenshot-page">
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Atmosphere · Chat · Computer</p>
        <h1 className="text-lg font-semibold text-ink-900">
          {fixture.job.title} · Sample Job {fixture.job.id.slice(0, 8)}
        </h1>
        <p className="text-sm text-ink-600">
          Demo account {fixture.job.account} · Clip “{fixture.job.clipTitle}” · {fixture.job.workDate}
        </p>
      </header>

      <section className="mx-auto mb-10 max-w-3xl space-y-2" data-testid="materials-shot">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Materials list card</p>
        <MaterialsListCard rows={fixture.materialsRows} />
      </section>

      <section className="mx-auto max-w-3xl space-y-2" data-testid="approve-shot">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Approve card</p>
        <p
          className="rounded-md border border-dashed border-ink-300 bg-paper-0 px-2.5 py-1.5 text-[12px] text-ink-700"
          data-testid="example-data-label"
        >
          <span className="font-semibold">Example data.</span> This cart was not built on homedepot.com and no order was
          placed. Products and prices are public Home Depot listings found Oct 5, 2026.
          <span className="block font-medium text-ink-900 empty:hidden" data-testid="example-caption" />
        </p>
        <ComputerApprovalCard
          approval={approval}
          busy={false}
          onApprove={() => undefined}
          onTakeControl={() => undefined}
          onCancel={() => undefined}
        />
      </section>
    </div>
  );
}
