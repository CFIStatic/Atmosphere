import { AlertTriangle, Plug } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, StatusDot } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { integrationStatusLabel, integrationStatusTone } from '../../patterns/tone';
import { useIntegrations } from '../../data/hooks';
import { relativeTime, titleCase } from '../../domain/format';

/**
 * Connected systems.
 *
 * A degraded integration is shown with its actual failure text rather than a
 * generic warning, because "Document Storage is degraded" tells an operator
 * nothing while "sync timing out, 3 failures in 6 hours" tells them whether to
 * wait or call someone.
 */
export function IntegrationsPage() {
  const { data: integrations = [] } = useIntegrations();

  const connected = integrations.filter((i) => i.status === 'connected').length;
  const problems = integrations.filter(
    (i) => i.status === 'degraded' || i.status === 'disconnected',
  );

  return (
    <>
      <PageHeader
        title="Integrations"
        description={`${connected} connected${problems.length > 0 ? ` · ${problems.length} need attention` : ''}`}
      />

      <PageBody className="space-y-4">
        {problems.length > 0 && (
          <div className="rounded-xl border border-state-warn/25 bg-state-warn/[0.07] p-3.5">
            <p className="flex items-center gap-2 text-xs font-medium text-state-warn">
              <AlertTriangle className="h-4 w-4" />
              {problems.length} integration{problems.length === 1 ? '' : 's'} degraded — agents
              relying on {problems.length === 1 ? 'it' : 'them'} may fail
            </p>
            <ul className="mt-2 space-y-1">
              {problems.map((i) => (
                <li key={i.id} className="text-2xs text-gray-400">
                  <span className="font-medium text-gray-300">{i.name}</span>
                  {i.issue ? ` — ${i.issue}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {integrations.length === 0 ? (
          <EmptyState icon={<Plug className="h-7 w-7" />} title="No integrations configured" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {integrations.map((integration) => (
              <Card key={integration.id}>
                <CardBody className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot
                        tone={integrationStatusTone[integration.status]}
                        pulse={integration.status === 'connected'}
                      />
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-white">
                          {integration.name}
                        </h3>
                        <p className="text-2xs text-gray-600">{titleCase(integration.category)}</p>
                      </div>
                    </div>
                    <Badge tone={integrationStatusTone[integration.status]}>
                      {integrationStatusLabel[integration.status]}
                    </Badge>
                  </div>

                  <p className="text-xs leading-relaxed text-gray-500">{integration.description}</p>

                  {integration.issue && (
                    <p className="rounded-lg border border-state-warn/25 bg-state-warn/[0.07] px-2.5 py-1.5 text-2xs text-state-warn">
                      {integration.issue}
                    </p>
                  )}

                  <div className="flex items-center justify-between border-t border-white/5 pt-2.5 text-2xs text-gray-600">
                    <span>
                      {integration.lastSyncAt
                        ? `Synced ${relativeTime(integration.lastSyncAt)}`
                        : 'Never synced'}
                      {integration.recordsSynced !== null &&
                        ` · ${integration.recordsSynced.toLocaleString()} records`}
                    </span>
                    {integration.status === 'not_configured' && (
                      <Button size="sm" variant="ghost">
                        Connect
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
