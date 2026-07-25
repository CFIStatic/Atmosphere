import { Wallet } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Progress,
  type Column,
} from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { invoiceStatusTone } from '../../patterns/tone';
import { useInvoices, useJobs } from '../../data/hooks';
import { formatDate, money, titleCase } from '../../domain/format';
import type { Invoice } from '../../domain/types';

/**
 * Receivables and work-in-progress.
 *
 * Aging buckets first, because in restoration the question is rarely "how much
 * did we bill?" and almost always "how much have we not been paid, and for how
 * long?"
 */
export function FinancialsPage() {
  const { data: invoices = [], isLoading } = useInvoices();
  const { data: jobs = [] } = useJobs();

  const outstanding = invoices.reduce((sum, i) => sum + (i.amount - i.paidAmount), 0);
  const overdue = invoices
    .filter((i) => i.daysOverdue > 0)
    .reduce((sum, i) => sum + (i.amount - i.paidAmount), 0);
  const collected = invoices.reduce((sum, i) => sum + i.paidAmount, 0);

  // Approved scope not yet invoiced — the pipeline behind the receivables.
  const wip = jobs
    .filter((j) => j.phase !== 'closed')
    .reduce((sum, j) => sum + Math.max(0, j.approvedTotal - j.invoicedTotal), 0);

  const buckets = [
    { label: 'Current', test: (i: Invoice) => i.daysOverdue === 0, tone: 'ok' as const },
    {
      label: '1–30 days',
      test: (i: Invoice) => i.daysOverdue > 0 && i.daysOverdue <= 30,
      tone: 'warn' as const,
    },
    {
      label: '31–60 days',
      test: (i: Invoice) => i.daysOverdue > 30 && i.daysOverdue <= 60,
      tone: 'danger' as const,
    },
    { label: '60+ days', test: (i: Invoice) => i.daysOverdue > 60, tone: 'danger' as const },
  ].map((bucket) => ({
    ...bucket,
    amount: invoices.filter(bucket.test).reduce((sum, i) => sum + (i.amount - i.paidAmount), 0),
  }));

  const columns: Column<Invoice>[] = [
    {
      id: 'job',
      header: 'Invoice',
      cell: (i) => (
        <div className="min-w-0">
          <span className="font-mono text-xs text-gray-500">{i.jobNumber}</span>
          <p className="truncate font-medium text-white">{i.customerName}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (i) => <Badge tone={invoiceStatusTone[i.status]}>{titleCase(i.status)}</Badge>,
    },
    {
      id: 'issued',
      header: 'Issued',
      hideOnMobile: true,
      cell: (i) => <span className="text-gray-500">{formatDate(i.issuedAt)}</span>,
    },
    {
      id: 'due',
      header: 'Due',
      hideOnMobile: true,
      cell: (i) => <span className="text-gray-500">{formatDate(i.dueAt)}</span>,
    },
    {
      id: 'age',
      header: 'Overdue',
      className: 'text-right',
      cell: (i) =>
        i.daysOverdue > 0 ? (
          <span className="font-medium text-state-danger">{i.daysOverdue}d</span>
        ) : (
          <span className="text-gray-600">—</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      className: 'text-right',
      cell: (i) => <span className="text-gray-300">{money(i.amount)}</span>,
    },
    {
      id: 'balance',
      header: 'Balance',
      className: 'text-right',
      cell: (i) => {
        const balance = i.amount - i.paidAmount;
        return (
          <span className={balance > 0 ? 'font-medium text-state-warn' : 'text-gray-600'}>
            {balance > 0 ? money(balance) : '—'}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Financials"
        description={`${money(outstanding)} outstanding · ${money(overdue)} overdue · ${money(wip)} approved but not yet invoiced`}
      />

      <PageBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {buckets.map((bucket) => (
            <Card key={bucket.label}>
              <CardBody className="p-3.5">
                <p className="text-2xs uppercase tracking-wide text-gray-600">{bucket.label}</p>
                <p className="mt-1 text-xl font-semibold text-white">{money(bucket.amount)}</p>
                <Progress
                  value={outstanding > 0 ? (bucket.amount / outstanding) * 100 : 0}
                  tone={bucket.tone}
                  className="mt-2"
                />
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody className="p-3.5">
              <p className="text-2xs uppercase tracking-wide text-gray-600">Collected to date</p>
              <p className="mt-1 text-xl font-semibold text-state-ok">{money(collected)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="p-3.5">
              <p className="text-2xs uppercase tracking-wide text-gray-600">Work in progress</p>
              <p className="mt-1 text-xl font-semibold text-white">{money(wip)}</p>
              <p className="mt-0.5 text-2xs text-gray-600">Approved scope not yet billed</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="p-3.5">
              <p className="text-2xs uppercase tracking-wide text-gray-600">Overdue exposure</p>
              <p className="mt-1 text-xl font-semibold text-state-danger">{money(overdue)}</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Invoices" description="Every invoice and its outstanding balance" />
          <CardBody className="p-0">
            <DataTable
              rows={invoices}
              columns={columns}
              rowKey={(i) => i.id}
              loading={isLoading}
              rowTone={(i) =>
                i.daysOverdue > 30 ? 'danger' : i.daysOverdue > 0 ? 'warn' : undefined
              }
              empty={<EmptyState icon={<Wallet className="h-7 w-7" />} title="No invoices yet" />}
            />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
