import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Badge, DataTable, EmptyState, type Column } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { estimateStatusLabel, estimateStatusTone } from '../../patterns/tone';
import { useEstimates } from '../../data/hooks';
import { formatDate, money } from '../../domain/format';
import type { Estimate } from '../../domain/types';

/**
 * Estimates, with carrier variance as a first-class column.
 *
 * The gap between what was scoped and what the carrier approved is the number
 * that decides whether a job makes money, so it is shown on the list rather
 * than buried one click deep.
 */
export function EstimatesPage() {
  const navigate = useNavigate();
  const { data: estimates = [], isLoading } = useEstimates();

  const totalVariance = estimates.reduce((sum, e) => sum + (e.varianceFromCarrier ?? 0), 0);
  const needingAction = estimates.filter(
    (e) => e.status === 'supplement_needed' || e.status === 'rejected',
  ).length;

  const columns: Column<Estimate>[] = [
    {
      id: 'job',
      header: 'Job',
      cell: (e) => (
        <div className="min-w-0">
          <span className="font-mono text-xs text-gray-500">{e.jobNumber}</span>
          <p className="truncate font-medium text-white">{e.customerName}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => (
        <Badge tone={estimateStatusTone[e.status]}>{estimateStatusLabel[e.status]}</Badge>
      ),
    },
    {
      id: 'carrier',
      header: 'Carrier',
      hideOnMobile: true,
      cell: (e) => <span className="text-gray-400">{e.carrier ?? '—'}</span>,
    },
    {
      id: 'items',
      header: 'Lines',
      hideOnMobile: true,
      className: 'text-right',
      cell: (e) => <span className="text-gray-500">{e.lineItems || '—'}</span>,
    },
    {
      id: 'total',
      header: 'Total',
      className: 'text-right',
      cell: (e) => <span className="font-medium text-gray-200">{money(e.total)}</span>,
    },
    {
      id: 'variance',
      header: 'Variance',
      className: 'text-right',
      cell: (e) =>
        e.varianceFromCarrier === null || e.varianceFromCarrier === 0 ? (
          <span className="text-gray-600">—</span>
        ) : (
          <span className="font-medium text-state-danger">{money(e.varianceFromCarrier)}</span>
        ),
    },
    {
      id: 'submitted',
      header: 'Submitted',
      hideOnMobile: true,
      cell: (e) => <span className="text-gray-500">{formatDate(e.submittedAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Estimates"
        description={
          totalVariance < 0
            ? `${estimates.length} estimates · ${money(Math.abs(totalVariance))} unrecovered variance · ${needingAction} need action`
            : `${estimates.length} estimates`
        }
      />
      <PageBody>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/40">
          <DataTable
            rows={estimates}
            columns={columns}
            rowKey={(e) => e.id}
            onRowClick={(e) => navigate(`/jobs/${e.jobId}`)}
            loading={isLoading}
            rowTone={(e) => (e.status === 'supplement_needed' ? 'warn' : undefined)}
            empty={<EmptyState icon={<FileText className="h-7 w-7" />} title="No estimates yet" />}
          />
        </div>
      </PageBody>
    </>
  );
}
