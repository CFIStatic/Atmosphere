import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, Circle, CircleDot, OctagonX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SegmentedControl,
  Skeleton,
  cn,
} from '../../design';
import { ActionProposal, PageBody, PageHeader } from '../../patterns';
import { taskPriorityTone, taskStatusLabel, taskStatusTone } from '../../patterns/tone';
import {
  useApprovals,
  useApproveRequest,
  useRejectRequest,
  useSetTaskStatus,
  useTasks,
} from '../../data/hooks';
import { compareUrgency } from '../../domain/approvals';
import { relativeTime } from '../../domain/format';
import { isFieldFirst } from '../../domain/permissions';
import { useViewer } from '../../shell/ViewerContext';
import type { Task, TaskStatus } from '../../domain/types';

type Scope = 'open' | 'today' | 'done';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  blocked: 'in_progress',
  done: 'todo',
};

const STATUS_ICON = {
  todo: Circle,
  in_progress: CircleDot,
  blocked: OctagonX,
  done: CheckCircle2,
} as const;

/**
 * "What needs attention?" from the individual's side.
 *
 * The same page serves a PM at a desk and a technician on a phone; the layout
 * adapts, the data does not. Tasks an agent created are marked as such, because
 * "why is this on my list?" is the first question a field tech asks.
 */
export function MyWorkPage() {
  const { role } = useViewer();
  const [scope, setScope] = useState<Scope>('open');
  // Pinned once per mount rather than read during render: due/overdue markers
  // that shift mid-interaction are worse than ones that are a few minutes stale.
  const [now] = useState(() => Date.now());

  const { data: tasks = [], isLoading } = useTasks();
  const { data: approvals = [] } = useApprovals();
  const setStatus = useSetTaskStatus();
  const approve = useApproveRequest();
  const reject = useRejectRequest();

  const fieldFirst = isFieldFirst(role);

  const visible = useMemo(() => {
    const byScope = tasks.filter((t) => {
      if (scope === 'done') return t.status === 'done';
      if (scope === 'today') {
        if (t.status === 'done' || !t.dueDate) return false;
        const due = new Date(t.dueDate);
        return due.getTime() - now < 24 * 3_600_000;
      }
      return t.status !== 'done';
    });
    return byScope.sort(sortTasks);
  }, [tasks, scope, now]);

  // Field roles can act on their own approvals (e.g. sending a customer update)
  // but should not be handed the company-wide queue.
  const myApprovals = approvals
    .filter(
      (a) => a.status === 'proposed' && (!fieldFirst || a.requiredRole === 'field_technician'),
    )
    .sort(compareUrgency)
    .slice(0, fieldFirst ? 2 : 3);

  const overdue = visible.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length;

  return (
    <>
      <PageHeader
        title="My Work"
        description={
          overdue > 0
            ? `${visible.length} open · ${overdue} past due`
            : `${visible.length} open task${visible.length === 1 ? '' : 's'}`
        }
      >
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'today', label: 'Due today' },
            { value: 'done', label: 'Done' },
          ]}
          aria-label="Filter tasks"
        />
      </PageHeader>

      <PageBody className="space-y-5">
        {myApprovals.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-fg-3">
              Waiting on you
            </h2>
            {myApprovals.map((request) => (
              <ActionProposal
                key={request.id}
                request={request}
                role={role}
                variant={fieldFirst ? 'compact' : 'full'}
                onApprove={(id) => approve.mutate(id)}
                onReject={(id) => reject.mutate(id)}
                busy={approve.isPending || reject.isPending}
              />
            ))}
          </section>
        )}

        <Card>
          <CardHeader title="Tasks" description="Across every job you're assigned to" />
          <CardBody className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-7 w-7" />}
                title={scope === 'done' ? 'Nothing completed yet' : "You're all clear"}
                description={
                  scope === 'done' ? undefined : 'No open tasks assigned to you right now.'
                }
              />
            ) : (
              <ul className="divide-y divide-line/5">
                {visible.map((task) => {
                  const Icon = STATUS_ICON[task.status];
                  const isOverdue =
                    task.dueDate &&
                    task.status !== 'done' &&
                    new Date(task.dueDate).getTime() < now;

                  return (
                    <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setStatus.mutate({ id: task.id, status: NEXT_STATUS[task.status] })
                        }
                        aria-label={`Mark ${task.title} as ${taskStatusLabel[NEXT_STATUS[task.status]]}`}
                        className="mt-0.5 shrink-0 transition hover:scale-110"
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px]',
                            task.status === 'done' && 'text-state-ok',
                            task.status === 'in_progress' && 'text-state-info',
                            task.status === 'blocked' && 'text-state-danger',
                            task.status === 'todo' && 'text-fg-4',
                          )}
                        />
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-sm leading-snug',
                            task.status === 'done' ? 'text-fg-3 line-through' : 'text-fg',
                          )}
                        >
                          {task.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-4">
                          <Link
                            to={`/jobs/${task.jobId}`}
                            className="font-mono font-medium text-brand-400 transition hover:text-brand-300"
                          >
                            {task.jobNumber}
                          </Link>
                          {task.dueDate && (
                            <>
                              <span>·</span>
                              <span className={isOverdue ? 'font-medium text-state-danger' : ''}>
                                {isOverdue ? 'Overdue ' : 'Due '}
                                {relativeTime(task.dueDate)}
                              </span>
                            </>
                          )}
                          {task.createdByAgentId && (
                            <>
                              <span>·</span>
                              <span className="flex items-center gap-1 text-brand-400/80">
                                <Bot className="h-3 w-3" />
                                created by Atmosphere
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {task.priority !== 'normal' && task.priority !== 'low' && (
                          <Badge tone={taskPriorityTone[task.priority]}>{task.priority}</Badge>
                        )}
                        <Badge tone={taskStatusTone[task.status]} className="hidden sm:inline-flex">
                          {taskStatusLabel[task.status]}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {fieldFirst && (
          <div className="flex justify-center">
            <Link to="/technician">
              <Button variant="primary" size="lg">
                Open field mode
              </Button>
            </Link>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** Blocked first, then overdue, then by due date. Done always sinks. */
function sortTasks(a: Task, b: Task): number {
  if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
  if ((a.status === 'blocked') !== (b.status === 'blocked')) return a.status === 'blocked' ? -1 : 1;
  const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
  return aDue - bDue;
}
