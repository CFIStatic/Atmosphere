import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type JobSummary } from '../lib/api';
import { AppShell, EmptyState, PageHeader, PanelSpinner } from '../components/AppShell';

function dollars(amount: number): string {
  if (Math.abs(amount) >= 100_000) {
    return `$${(amount / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`;
  }
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

type SortKey = 'outstanding' | 'contract' | 'billed';

/**
 * The Manager Platform's ledger view: every job as money rather than work.
 *
 * Billed-to-contract is the number that matters here — a job at 100% of its
 * contract with nothing outstanding is finished in the only sense accounting
 * cares about. Labour cost is not in the schema yet, so this reports what the
 * record actually holds and does not guess at margin.
 */
export function JobCostingPage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [sort, setSort] = useState<SortKey>('outstanding');

  useEffect(() => {
    let cancelled = false;
    api
      .getJobs({ status: 'all' })
      .then(({ jobs }) => !cancelled && setJobs(jobs))
      .catch(() => !cancelled && setJobs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const withMoney = (jobs ?? []).filter(
      (j) => (j.contractAmount ?? 0) > 0 || (j.invoicedAmount ?? 0) > 0,
    );
    const value = (j: JobSummary) =>
      sort === 'contract'
        ? j.contractAmount ?? 0
        : sort === 'billed'
          ? j.invoicedAmount ?? 0
          : Math.max(0, (j.invoicedAmount ?? 0) - (j.paidAmount ?? 0));
    return withMoney.sort((a, b) => value(b) - value(a));
  }, [jobs, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, j) => ({
          contract: acc.contract + (j.contractAmount ?? 0),
          invoiced: acc.invoiced + (j.invoicedAmount ?? 0),
          paid: acc.paid + (j.paidAmount ?? 0),
        }),
        { contract: 0, invoiced: 0, paid: 0 },
      ),
    [rows],
  );
  const outstanding = Math.max(0, totals.invoiced - totals.paid);
  const unbilled = Math.max(0, totals.contract - totals.invoiced);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Manager Platform"
        title="Job costing"
        description="Every job as money: what was contracted, what has been billed, and what is still owed. Sorted by whichever number you are chasing today."
        action={
          <div className="flex rounded-lg glass-card p-1">
            {(
              [
                ['outstanding', 'Outstanding'],
                ['billed', 'Billed'],
                ['contract', 'Contract'],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  sort === key ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {jobs === null && <PanelSpinner label="Loading job costing" />}

      {jobs !== null && rows.length === 0 && (
        <EmptyState
          title="No money on the books yet"
          hint="A job appears here once it carries a contract amount or an invoice."
        />
      )}

      {jobs !== null && rows.length > 0 && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Contracted" value={dollars(totals.contract)} sub="Approved scope" />
            <Stat label="Billed" value={dollars(totals.invoiced)} sub="Invoices raised" />
            <Stat label="Collected" value={dollars(totals.paid)} sub="Payments received" />
            <Stat
              label="Outstanding"
              value={dollars(outstanding)}
              sub={unbilled > 0 ? `+ ${dollars(unbilled)} not yet billed` : 'Everything billed'}
              accent
            />
          </div>

          <div className="overflow-x-auto rounded-xl glass-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Job</Th>
                  <Th right>Contract</Th>
                  <Th right>Billed</Th>
                  <Th right>Collected</Th>
                  <Th right>Outstanding</Th>
                  <Th>Billed to contract</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => {
                  const contract = job.contractAmount ?? 0;
                  const invoiced = job.invoicedAmount ?? 0;
                  const paid = job.paidAmount ?? 0;
                  const due = Math.max(0, invoiced - paid);
                  const pct = contract > 0 ? Math.min(100, Math.round((invoiced / contract) * 100)) : null;
                  return (
                    <tr key={job.jobId} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3">
                        <Link
                          to={`/jobs/${job.jobId}`}
                          className="block max-w-[26rem] truncate font-semibold text-ink-900 hover:text-brand-600"
                        >
                          <span className="mr-2 font-mono text-xs font-normal text-ink-500">
                            #{job.jobNumber}
                          </span>
                          {job.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {job.status.replace(/_/g, ' ')}
                          {job.claimNumber ? ` · ${job.claimNumber}` : ''}
                        </p>
                      </td>
                      <Td>{contract > 0 ? dollars(contract) : '—'}</Td>
                      <Td>{invoiced > 0 ? dollars(invoiced) : '—'}</Td>
                      <Td>{paid > 0 ? dollars(paid) : '—'}</Td>
                      <Td strong={due > 0}>{due > 0 ? dollars(due) : '—'}</Td>
                      <td className="px-4 py-3">
                        {pct === null ? (
                          <span className="text-xs text-ink-500">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-300">
                              <div
                                className={`h-full rounded-full ${
                                  pct >= 100 ? 'bg-success-600' : 'bg-brand-500'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-ink-600">{pct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-ink-500">
            Contract, billed, and collected come from each job's own record. Labour and material
            cost are not captured yet, so this page reports cash position rather than margin.
          </p>
        </>
      )}
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl glass-card px-4 py-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${
          accent ? 'text-brand-600' : 'text-ink-900'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-ink-500">{sub}</p>
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td
      className={`px-4 py-3 text-right tabular-nums ${
        strong ? 'font-semibold text-ink-900' : 'text-ink-700'
      }`}
    >
      {children}
    </td>
  );
}
