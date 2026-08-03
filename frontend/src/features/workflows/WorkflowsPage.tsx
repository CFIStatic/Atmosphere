import { CheckCircle2, Layers, PauseCircle, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardBody, EmptyState } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { useWorkflows } from '../../data/hooks';
import { CAPABILITY_LABELS } from '../../domain/routing';
import { relativeTime } from '../../domain/format';

/**
 * Standing automations.
 *
 * Whether a workflow requires approval is shown as prominently as whether it is
 * enabled, because those are the two facts that determine how much the business
 * is trusting it to act unsupervised.
 */
export function WorkflowsPage() {
  const { data: workflows = [] } = useWorkflows();

  const enabled = workflows.filter((w) => w.enabled).length;
  const autonomous = workflows.filter((w) => w.enabled && !w.requiresApproval).length;

  return (
    <>
      <PageHeader
        title="Workflows"
        description={`${enabled} of ${workflows.length} enabled · ${autonomous} run without approval`}
      />

      <PageBody>
        {workflows.length === 0 ? (
          <EmptyState icon={<Layers className="h-7 w-7" />} title="No workflows configured" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflows.map((workflow) => (
              <Card key={workflow.id} className={workflow.enabled ? undefined : 'opacity-60'}>
                <CardBody className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-fg">{workflow.name}</h3>
                      <p className="mt-0.5 text-2xs text-fg-4">
                        {CAPABILITY_LABELS[workflow.capability]}
                      </p>
                    </div>
                    <Badge
                      tone={workflow.enabled ? 'ok' : 'idle'}
                      icon={
                        workflow.enabled ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : (
                          <PauseCircle className="h-2.5 w-2.5" />
                        )
                      }
                    >
                      {workflow.enabled ? 'Enabled' : 'Paused'}
                    </Badge>
                  </div>

                  <p className="text-xs leading-relaxed text-fg-3">{workflow.description}</p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="idle">{workflow.trigger}</Badge>
                    {workflow.requiresApproval ? (
                      <Badge tone="brand" icon={<ShieldCheck className="h-2.5 w-2.5" />}>
                        Requires approval
                      </Badge>
                    ) : (
                      <Badge tone="warn">Runs automatically</Badge>
                    )}
                  </div>

                  <p className="border-t border-line/5 pt-2 text-2xs text-fg-4">
                    {workflow.runsThisWeek} runs this week · edited by {workflow.lastEditedBy}{' '}
                    {relativeTime(workflow.lastEditedAt)}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
