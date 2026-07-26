import { useState } from 'react';
import { Users } from 'lucide-react';
import { Badge, DataTable, EmptyState, type Column } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { useCustomers } from '../../data/hooks';
import { money, relativeTime, titleCase } from '../../domain/format';
import type { Customer } from '../../domain/types';

/** A week without contact on a live job is the point it starts costing goodwill. */
const STALE_MS = 7 * 86_400_000;

/** Customers, ordered by lifetime value — the relationships worth protecting. */
export function CustomersPage() {
  const { data: customers = [], isLoading } = useCustomers();
  // Pinned per mount so the "stale contact" markers don't shift mid-scroll.
  const [now] = useState(() => Date.now());

  const sorted = [...customers].sort((a, b) => b.lifetimeValue - a.lifetimeValue);
  const stale = customers.filter(
    (c) =>
      c.activeJobs > 0 && c.lastContactAt && now - new Date(c.lastContactAt).getTime() > STALE_MS,
  ).length;

  const columns: Column<Customer>[] = [
    {
      id: 'name',
      header: 'Customer',
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{c.name}</p>
          <p className="truncate text-2xs text-fg-4">{c.city}</p>
        </div>
      ),
    },
    { id: 'type', header: 'Type', cell: (c) => <Badge tone="idle">{titleCase(c.type)}</Badge> },
    {
      id: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      cell: (c) => (
        <div className="min-w-0 text-xs">
          <p className="truncate text-fg-3">{c.email ?? 'No email'}</p>
          <p className="text-fg-4">{c.phone ?? 'No phone'}</p>
        </div>
      ),
    },
    {
      id: 'active',
      header: 'Active jobs',
      className: 'text-right',
      cell: (c) => (
        <span className={c.activeJobs > 0 ? 'font-medium text-fg-2' : 'text-fg-4'}>
          {c.activeJobs || '—'}
        </span>
      ),
    },
    {
      id: 'ltv',
      header: 'Lifetime value',
      className: 'text-right',
      cell: (c) => <span className="font-medium text-fg-2">{money(c.lifetimeValue)}</span>,
    },
    {
      id: 'contacted',
      header: 'Last contact',
      hideOnMobile: true,
      className: 'text-right',
      cell: (c) => {
        const staleContact =
          c.activeJobs > 0 &&
          c.lastContactAt &&
          now - new Date(c.lastContactAt).getTime() > STALE_MS;
        return (
          <span className={staleContact ? 'font-medium text-state-warn' : 'text-fg-3'}>
            {c.lastContactAt ? relativeTime(c.lastContactAt) : 'Never'}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          stale > 0
            ? `${customers.length} customers · ${stale} with active work and no contact this week`
            : `${customers.length} customers`
        }
      />
      <PageBody>
        <div className="overflow-hidden rounded-xl border border-line/10 bg-surface/40">
          <DataTable
            rows={sorted}
            columns={columns}
            rowKey={(c) => c.id}
            loading={isLoading}
            empty={<EmptyState icon={<Users className="h-7 w-7" />} title="No customers yet" />}
          />
        </div>
      </PageBody>
    </>
  );
}
