import { Badge, Card, CardBody, CardHeader, Progress, StatusDot } from '../../design';
import { AgentActivityFeed, PageBody, PageHeader } from '../../patterns';
import { agentStatusTone } from '../../patterns/tone';
import { useAgentRuns, useAgents } from '../../data/hooks';
import { CAPABILITY_LABELS } from '../../domain/routing';
import { percent, relativeTime, titleCase } from '../../domain/format';

/**
 * "What are the AI agents doing?"
 *
 * An observability surface, not a chooser. Users never select an agent to talk
 * to — the assistant routes for them — so this page answers a different
 * question: what ran, against which systems, how often did it work, and what is
 * waiting on a human. Success rate and degraded status are shown plainly
 * because an automation you cannot audit is one you will not trust.
 */
export function AgentsPage() {
  const { data: agents = [] } = useAgents();
  const { data: runs = [] } = useAgentRuns();

  const awaiting = agents.reduce((sum, a) => sum + a.actionsAwaitingApproval, 0);
  const degraded = agents.filter((a) => a.status === 'degraded').length;

  return (
    <>
      <PageHeader
        title="Agents"
        description={
          degraded > 0
            ? `${agents.filter((a) => a.status === 'active').length} active · ${degraded} degraded · ${awaiting} awaiting approval`
            : `${agents.filter((a) => a.status === 'active').length} active · ${awaiting} awaiting approval`
        }
      />

      <PageBody className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot
                        tone={agentStatusTone[agent.status]}
                        pulse={agent.status === 'active'}
                      />
                      <h3 className="truncate text-sm font-semibold text-white">{agent.name}</h3>
                    </div>
                    <p className="mt-0.5 text-2xs text-gray-600">
                      {CAPABILITY_LABELS[agent.capability]}
                    </p>
                  </div>
                  <Badge tone={agentStatusTone[agent.status]}>{titleCase(agent.status)}</Badge>
                </div>

                <p className="text-xs leading-relaxed text-gray-500">{agent.description}</p>

                <div>
                  <div className="mb-1 flex items-center justify-between text-2xs">
                    <span className="text-gray-600">Success rate</span>
                    <span
                      className={
                        agent.successRate >= 90
                          ? 'font-medium text-state-ok'
                          : agent.successRate >= 80
                            ? 'font-medium text-state-warn'
                            : 'font-medium text-state-danger'
                      }
                    >
                      {percent(agent.successRate, 1)}
                    </span>
                  </div>
                  <Progress
                    value={agent.successRate}
                    tone={
                      agent.successRate >= 90 ? 'ok' : agent.successRate >= 80 ? 'warn' : 'danger'
                    }
                  />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-gray-600">
                  <span>
                    <span className="font-medium text-gray-400">{agent.runsToday}</span> runs today
                  </span>
                  {agent.actionsAwaitingApproval > 0 && (
                    <span className="text-state-warn">
                      {agent.actionsAwaitingApproval} awaiting approval
                    </span>
                  )}
                  <span>last run {relativeTime(agent.lastRunAt)}</span>
                </div>

                <div className="flex flex-wrap gap-1 border-t border-white/5 pt-2.5">
                  {agent.connectedSystems.map((system) => (
                    <Badge key={system} tone="idle">
                      {system}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader
            title="Activity"
            description="Every agent run, newest first — including what each one touched"
          />
          <CardBody className="px-3 py-1">
            <AgentActivityFeed runs={runs} />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
