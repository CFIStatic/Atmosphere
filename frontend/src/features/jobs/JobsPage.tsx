import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import {
  Badge,
  DataTable,
  EmptyState,
  SearchInput,
  SegmentedControl,
  type Column,
} from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { jobHealthLabel, jobHealthTone, phaseLabel } from '../../patterns/tone';
import { useJobs } from '../../data/hooks';
import { money } from '../../domain/format';
import type { Job } from '../../domain/types';

type Scope = 'active' | 'attention' | 'all';

/**
 * The job list.
 *
 * Defaults to active work rather than everything ever recorded — a restoration
 * company's closed jobs vastly outnumber its live ones, and an operator opening
 * this page wants today's board, not the archive.
 */
export function JobsPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>('active');
  const [query, setQuery] = useState('');

  const { data: jobs = [], isLoading } = useJobs();

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return jobs
      .filter((j) => {
        if (scope === 'active') return j.phase !== 'closed';
        if (scope === 'attention') return j.health !== 'on_track' && j.phase !== 'closed';
        return true;
      })
      .filter(
        (j) =>
          !term ||
          j.number.toLowerCase().includes(term) ||
          j.customerName.toLowerCase().includes(term) ||
          j.address.toLowerCase().includes(term) ||
          (j.claimNumber ?? '').toLowerCase().includes(term),
      );
  }, [jobs, scope, query]);

  const columns: Column<Job>[] = [
    {
      id: 'number',
      header: 'Job',
      className: 'w-[22rem]',
      cell: (job) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-fg-3">{job.number}</span>
            <span className="truncate font-medium text-fg">{job.customerName}</span>
          </div>
          <p className="truncate text-2xs text-fg-4">{job.address}</p>
        </div>
      ),
    },
    {
      id: 'health',
      header: 'Health',
      cell: (job) => (
        <div className="space-y-1">
          <Badge tone={jobHealthTone[job.health]}>{jobHealthLabel[job.health]}</Badge>
          {job.flags.length > 0 && (
            <p className="max-w-[16rem] truncate text-2xs text-fg-4">{job.flags[0]}</p>
          )}
        </div>
      ),
    },
    {
      id: 'phase',
      header: 'Phase',
      cell: (job) => <Badge tone="idle">{phaseLabel[job.phase]}</Badge>,
    },
    {
      id: 'age',
      header: 'Age',
      hideOnMobile: true,
      cell: (job) => <span className="text-fg-3">{job.ageDays}d</span>,
    },
    {
      id: 'carrier',
      header: 'Carrier',
      hideOnMobile: true,
      cell: (job) => <span className="text-fg-3">{job.carrier ?? '—'}</span>,
    },
    {
      id: 'value',
      header: 'Approved',
      className: 'text-right',
      cell: (job) => (
        <span className="font-medium text-fg-2">
          {money(job.approvedTotal || job.estimateTotal)}
        </span>
      ),
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      className: 'text-right',
      hideOnMobile: true,
      cell: (job) => {
        const outstanding = job.invoicedTotal - job.paidTotal;
        return (
          <span className={outstanding > 0 ? 'font-medium text-state-warn' : 'text-fg-4'}>
            {outstanding > 0 ? money(outstanding) : '—'}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Jobs"
        description={`${rows.length} shown · ${jobs.filter((j) => j.phase !== 'closed').length} active`}
        actions={
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, customers, claims…"
            className="w-56"
          />
        }
      >
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'attention', label: 'Needs attention' },
            { value: 'all', label: 'All' },
          ]}
          aria-label="Filter jobs"
        />
      </PageHeader>

      <PageBody>
        <div className="overflow-hidden rounded-xl border border-line/10 bg-surface/40">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(job) => job.id}
            onRowClick={(job) => navigate(`/jobs/${job.id}`)}
            loading={isLoading}
            rowTone={(job) =>
              job.health === 'critical' || job.health === 'blocked'
                ? 'danger'
                : job.health === 'at_risk'
                  ? 'warn'
                  : undefined
            }
            empty={
              <EmptyState
                icon={<Building2 className="h-7 w-7" />}
                title="No jobs match"
                description="Try a different filter or search term."
              />
            }
          />
        </div>
      </PageBody>
    </>
  );
}
