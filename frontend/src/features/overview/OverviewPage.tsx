import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '../../design';
import { KpiTile, PageBody, PageHeader, AgentActivityFeed } from '../../patterns';
import { jobHealthLabel, jobHealthTone, phaseLabel } from '../../patterns/tone';
import { useAgentRuns, useApprovals, useJobs, useMetrics } from '../../data/hooks';
import { compareUrgency } from '../../domain/approvals';
import { isExecutive } from '../../domain/permissions';
import { money } from '../../domain/format';
import { useViewer } from '../../shell/ViewerContext';
import type { Job } from '../../domain/types';

/**
 * "What is happening?" — the org pulse.
 *
 * Ordered by what a manager checks first thing: the numbers, then what is going
 * wrong, then what the agents did overnight. Executives get the same page with
 * the work queues removed, because a roll-up view that also shows individual
 * tasks invites the wrong kind of attention.
 */
export function OverviewPage() {
  const { role, displayName } = useViewer();
  const executive = isExecutive(role);

  const { data: metrics = [], isLoading: metricsLoading } = useMetrics();
  const { data: jobs = [], isLoading: jobsLoading } = useJobs();
  const { data: runs = [] } = useAgentRuns();
  const { data: approvals = [] } = useApprovals();

  const needsAttention = jobs
    .filter((j) => j.health !== 'on_track' && j.phase !== 'closed')
    .sort((a, b) => severity(b) - severity(a));

  const pending = approvals.filter((a) => a.status === 'proposed').sort(compareUrgency);

  return (
    <>
      <PageHeader
        title={executive ? 'Company overview' : `Good to see you, ${displayName}`}
        description={
          executive
            ? 'Roll-up across every active job, agent, and receivable.'
            : 'Everything happening across your jobs right now.'
        }
        actions={
          pending.length > 0 && (
            <Link
              to="/approvals"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white shadow-lg shadow-brand-900/30 transition hover:bg-brand-500"
            >
              {pending.length} awaiting approval
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )
        }
      />

      <PageBody className="space-y-5">
        {/* ── Metrics ──────────────────────────────────────────────────────── */}
        <section aria-label="Key metrics">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {metricsLoading
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[5.5rem]" />)
              : metrics.map((m) => <KpiTile key={m.id} metric={m} />)}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-3">
          {/* ── Jobs needing attention ─────────────────────────────────────── */}
          <Card className="xl:col-span-2">
            <CardHeader
              title="Needs attention"
              description={
                needsAttention.length > 0
                  ? `${needsAttention.length} of ${jobs.filter((j) => j.phase !== 'closed').length} active jobs are off track`
                  : 'Every active job is on track'
              }
              action={
                <Link
                  to="/jobs"
                  className="text-2xs font-medium text-brand-400 transition hover:text-brand-300"
                >
                  All jobs
                </Link>
              }
            />
            <CardBody className="p-0">
              {jobsLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : needsAttention.length === 0 ? (
                <EmptyState
                  title="Nothing off track"
                  description="Every active job is inside its target window."
                />
              ) : (
                <ul className="divide-y divide-line/5">
                  {needsAttention.map((job) => (
                    <li key={job.id}>
                      <Link
                        to={`/jobs/${job.id}`}
                        className="flex items-start gap-3 px-4 py-3 transition hover:bg-line/[0.03]"
                      >
                        <AlertTriangle
                          className={
                            job.health === 'on_track'
                              ? 'mt-0.5 h-4 w-4 shrink-0 text-state-ok'
                              : job.health === 'at_risk'
                                ? 'mt-0.5 h-4 w-4 shrink-0 text-state-warn'
                                : 'mt-0.5 h-4 w-4 shrink-0 text-state-danger'
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs text-fg-3">{job.number}</span>
                            <span className="truncate text-sm font-medium text-fg">
                              {job.customerName}
                            </span>
                            <Badge tone={jobHealthTone[job.health]}>
                              {jobHealthLabel[job.health]}
                            </Badge>
                            <Badge tone="idle">{phaseLabel[job.phase]}</Badge>
                          </div>
                          {job.flags.length > 0 && (
                            <p className="mt-1 text-xs text-fg-3">{job.flags.join(' · ')}</p>
                          )}
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-xs font-medium text-fg-2">
                            {money(job.approvedTotal || job.estimateTotal)}
                          </p>
                          <p className="text-2xs text-fg-4">day {job.ageDays}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* ── Agent activity ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Agent activity"
              description="What Atmosphere has been doing"
              action={
                <Link
                  to="/agents"
                  className="text-2xs font-medium text-brand-400 transition hover:text-brand-300"
                >
                  All agents
                </Link>
              }
            />
            <CardBody className="px-3 py-1">
              <AgentActivityFeed runs={runs} limit={7} compact />
            </CardBody>
          </Card>
        </div>

        {!executive && (
          <Card>
            <CardHeader
              title="Recent agent runs across every capability"
              description="Scheduling, estimating, collections, project management, compliance"
              action={<Bot className="h-4 w-4 text-fg-4" />}
            />
            <CardBody className="px-3 py-1">
              <AgentActivityFeed runs={runs.slice(7)} />
            </CardBody>
          </Card>
        )}
      </PageBody>
    </>
  );
}

/** Sort weight so blocked and critical jobs surface above merely at-risk ones. */
function severity(job: Job): number {
  const weights = { blocked: 3, critical: 3, at_risk: 2, on_track: 0 } as const;
  return weights[job.health];
}
