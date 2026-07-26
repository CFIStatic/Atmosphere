import { Link } from 'react-router-dom';
import { Bot, Check, Clock, Loader2, X } from 'lucide-react';
import { Badge, EmptyState, StatusDot, ToneText, cn } from '../design';
import { relativeTime } from '../domain/format';
import type { AgentRun } from '../domain/types';
import { runOutcomeLabel, runOutcomeTone } from './tone';

const ICONS = {
  succeeded: Check,
  failed: X,
  awaiting_approval: Clock,
  running: Loader2,
} as const;

/**
 * What the agents have been doing.
 *
 * Every entry names the agent, what it touched, and which systems it reached
 * into. That last part is the difference between an activity feed and an audit
 * trail — when an agent writes to QuickBooks, the operator gets to see that it
 * did, without going and asking.
 */
export function AgentActivityFeed({
  runs,
  limit,
  showJob = true,
  compact = false,
  className,
}: {
  runs: AgentRun[];
  limit?: number;
  showJob?: boolean;
  /**
   * Drops the trailing status badge and folds the outcome into the meta line.
   * In a narrow sidebar the badge eats half the width and wraps the summary to
   * six lines — the status dot already carries the same signal.
   */
  compact?: boolean;
  className?: string;
}) {
  const visible = limit ? runs.slice(0, limit) : runs;

  if (visible.length === 0) {
    return <EmptyState icon={<Bot className="h-6 w-6" />} title="No agent activity yet" />;
  }

  return (
    <ul className={cn('divide-y divide-line/5', className)}>
      {visible.map((run) => {
        const Icon = ICONS[run.outcome];
        const tone = runOutcomeTone[run.outcome];

        return (
          // `items-start` matters: without it the flex children stretch to the
          // row height and the pill-shaped badge renders as a giant ellipse.
          <li key={run.id} className="flex items-start gap-3 px-1 py-2.5">
            <span className="mt-0.5 shrink-0">
              <StatusDot tone={tone} pulse={run.outcome === 'running'} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-fg-2">{run.summary}</p>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-4">
                {compact && (
                  <>
                    <ToneText tone={tone} className="font-medium">
                      {runOutcomeLabel[run.outcome]}
                    </ToneText>
                    <span>·</span>
                  </>
                )}
                <span className="font-medium text-fg-3">{run.agentName}</span>
                <span>·</span>
                <span>{relativeTime(run.at)}</span>

                {showJob && run.jobId && run.jobNumber && (
                  <>
                    <span>·</span>
                    <Link
                      to={`/jobs/${run.jobId}`}
                      className="font-medium text-brand-400 transition hover:text-brand-300"
                    >
                      {run.jobNumber}
                    </Link>
                  </>
                )}

                {run.systemsTouched.length > 0 && (
                  <>
                    <span>·</span>
                    <span>{run.systemsTouched.join(', ')}</span>
                  </>
                )}
              </div>
            </div>

            <Badge
              tone={tone}
              className={cn('shrink-0', compact && 'hidden')}
              icon={
                <Icon className={cn('h-2.5 w-2.5', run.outcome === 'running' && 'animate-spin')} />
              }
            >
              {runOutcomeLabel[run.outcome]}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
