import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  PM_PHASE_LABELS,
  type PmDocument,
  type PmProjectDetail,
  type PmTask,
} from '../lib/api';
import { AppShell, ErrorNote, PanelSpinner } from '../components/AppShell';
import { SpinnerIcon, CheckIcon } from '../components/icons';
import {
  Card,
  DryingSparkline,
  EmptyState,
  HealthPill,
  Meter,
  Pill,
  SeverityTag,
  StatTile,
} from '../components/pm/primitives';

/**
 * One project, in the order a project manager checks it: is it healthy, what is
 * outstanding, is it drying, can it be billed.
 *
 * Every number on this page comes from the same analysis functions the alert
 * engine uses, so the screen and the alert list can never disagree about
 * whether an area has stalled.
 */
export function PmProjectPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<PmProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.pmProject(id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this project.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleTask(task: PmTask) {
    const next = task.status === 'done' ? 'todo' : 'done';
    setData((prev) =>
      prev
        ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, status: next } : t)) }
        : prev,
    );
    try {
      await api.pmUpdateTask(task.id, { status: next });
    } catch {
      await load();
    }
  }

  async function setDocument(doc: PmDocument, status: string) {
    try {
      await api.pmUpdateDocument(doc.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that requirement.');
    }
  }

  async function recheck() {
    setBusy(true);
    try {
      await api.pmRun(id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function draft(audience: string) {
    setBusy(true);
    try {
      await api.pmDraftUpdate(id, audience);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not draft that update.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <AppShell>
        {error ? <ErrorNote message={error} /> : <PanelSpinner label="Loading the project" />}
      </AppShell>
    );
  }

  const { project, analysis } = data;
  const openTasks = data.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const doneTasks = data.tasks.filter((t) => t.status === 'done');

  return (
    <AppShell>
      {/* Back to the board, and the one action this screen owns. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link to="/pm" className="text-sm text-ink-600 transition hover:text-ink-900">
          ← Project board
        </Link>
        <button
          onClick={() => void recheck()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg glass-card px-3 py-2 text-sm text-ink-700 transition hover:text-ink-900 disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          Re-check
        </button>
      </div>

      <main className="mx-auto max-w-5xl">
        {error && (
          <div className="mb-6 rounded-lg glass-card px-4 py-3 text-sm text-ink-800">
            {error}
          </div>
        )}

        <div className="animate-fade-in-up">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-brand-600">{project.projectNumber}</span>
                <Pill>{PM_PHASE_LABELS[project.phase]}</Pill>
                <Pill>{project.workType === 'mitigation' ? 'Mitigation' : 'Construction'}</Pill>
                {project.lossType && <Pill>{project.lossType}</Pill>}
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">{project.name}</h1>
              <p className="mt-1 text-sm text-ink-600">
                {[project.customerName, project.addressLine1, project.city, project.region]
                  .filter(Boolean)
                  .join(' · ') || 'No customer details'}
              </p>
              {project.claimNumber && (
                <p className="mt-1 text-xs text-ink-500">
                  {project.carrier ? `${project.carrier} · ` : ''}Claim {project.claimNumber}
                  {project.adjusterName ? ` · ${project.adjusterName}` : ''}
                </p>
              )}
            </div>
            <HealthPill health={analysis.health} />
          </div>

          {/* Why it's scored that way */}
          {analysis.health.reasons.length > 0 && (
            <Card className="mt-6" title="What is dragging on this job">
              <ul className="space-y-1.5">
                {analysis.health.reasons.map((r) => (
                  <li key={r.text} className="flex items-start gap-2 text-sm text-ink-700">
                    <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-400" />
                    {r.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Stats */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Open tasks"
              value={openTasks.length}
              tone={analysis.schedule.overdueTasks.length > 0 ? 'warning' : 'neutral'}
              hint={
                analysis.schedule.overdueTasks.length > 0
                  ? `${analysis.schedule.overdueTasks.length} overdue`
                  : 'None overdue'
              }
            />
            <StatTile
              label="Crew on site"
              value={data.assignments.length}
              tone={data.assignments.length === 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              label="Equipment"
              value={data.placements.length}
              tone={analysis.drying.equipmentStillOnDriedProject ? 'warning' : 'neutral'}
              hint={analysis.drying.equipmentStillOnDriedProject ? 'Job is dry — pull it' : undefined}
            />
            <StatTile
              label="Days running"
              value={daysSince(project.createdAt)}
              tone={analysis.schedule.overrunDays !== null ? 'critical' : 'neutral'}
              hint={
                analysis.schedule.overrunDays !== null
                  ? `${analysis.schedule.overrunDays} past target`
                  : analysis.schedule.daysUntilTarget !== null
                    ? `${analysis.schedule.daysUntilTarget} to target`
                    : undefined
              }
            />
          </div>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <Card className="mt-6" title="Flagged on this job">
              <div className="space-y-3">
                {data.alerts.map((a) => (
                  <div key={a.id} className="border-l-2 border-line pl-3">
                    <SeverityTag severity={a.severity} />
                    <p className="mt-1 text-sm text-ink-900">{a.title}</p>
                    {a.detail && <p className="mt-0.5 text-sm text-ink-600">{a.detail}</p>}
                    {a.suggestedAction && (
                      <p className="mt-1 text-sm text-brand-700">→ {a.suggestedAction}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Drying */}
          {analysis.drying.isDrying && (
            <Card
              className="mt-6"
              title="Drying"
              action={
                <span className="text-xs text-ink-500">
                  Day {analysis.drying.daysDrying} · {analysis.drying.areasAtGoal}/
                  {analysis.drying.openAreas} at goal
                </span>
              }
            >
              {analysis.drying.equipment.sufficient === false && (
                <p className="mb-4 rounded-lg glass-card px-3 py-2 text-sm text-ink-700">
                  <span className="pm-warning font-medium">Under-equipped.</span>{' '}
                  {analysis.drying.equipment.shortfallNote}
                </p>
              )}

              {analysis.drying.areas.length === 0 ? (
                <EmptyState>
                  No drying areas recorded. Without a dry standard there is nothing to measure
                  against.
                </EmptyState>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  {analysis.drying.areas.map((area) => (
                    <div key={area.areaId} className="rounded-lg glass-card p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-medium text-ink-900">{area.label}</h3>
                        <span className="text-xs text-ink-500">{area.material}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">{stateLabel(area.state)}</p>

                      <div className="mt-3">
                        <DryingSparkline
                          points={area.trend.daily}
                          goalPct={area.dryGoalPct}
                          state={area.state}
                        />
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <dt className="text-ink-500">Last reading</dt>
                        <dd className="text-right tabular-nums text-ink-700">
                          {area.hoursSinceReading === null ? '—' : `${area.hoursSinceReading}h ago`}
                        </dd>
                        <dt className="text-ink-500">To go</dt>
                        <dd className="text-right tabular-nums text-ink-700">
                          {area.remainingPct === null
                            ? '—'
                            : area.remainingPct <= 0
                              ? 'At goal'
                              : `${area.remainingPct.toFixed(1)} pts`}
                        </dd>
                        <dt className="text-ink-500">Projected</dt>
                        <dd className="text-right tabular-nums text-ink-700">
                          {area.projectedDaysToGoal === null
                            ? 'Not drying'
                            : area.projectedDaysToGoal === 0
                              ? 'Done'
                              : `${area.projectedDaysToGoal} day(s)`}
                        </dd>
                      </dl>
                    </div>
                  ))}
                </div>
              )}

              {analysis.drying.ambient && (
                <p className="mt-4 text-xs text-ink-500">
                  Inside {analysis.drying.ambient.temperatureF}°F /{' '}
                  {analysis.drying.ambient.humidityPct}% RH · {analysis.drying.ambient.gpp} GPP ·
                  dew point {analysis.drying.ambient.dewPointF}°F
                  {analysis.drying.outside &&
                    ` · outside ${analysis.drying.outside.gpp} GPP`}
                </p>
              )}
            </Card>
          )}

          {/* Tasks */}
          <Card
            className="mt-6"
            title={`Work (${openTasks.length} open)`}
            action={<span className="text-xs text-ink-500">{doneTasks.length} done</span>}
          >
            {openTasks.length === 0 ? (
              <EmptyState>Nothing outstanding.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3">
                    <button
                      onClick={() => void toggleTask(task)}
                      aria-label={`Mark “${task.title}” done`}
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded glass-card transition hover:border-brand-300"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink-800">{task.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                        {task.source !== 'manual' && (
                          <span className="text-brand-600">
                            {task.source === 'playbook' ? 'standard step' : 'flagged by the agent'}
                          </span>
                        )}
                        {task.dueAt && <span>{dueLabel(task.dueAt)}</span>}
                        {task.status === 'blocked' && (
                          <span className="pm-warning">blocked: {task.blockedReason}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Documentation */}
          <Card
            className="mt-6"
            title="Documentation"
            action={
              analysis.compliance.invoiceReady ? (
                <span className="pm-good inline-flex items-center gap-1.5 text-xs font-medium">
                  <CheckIcon width={14} height={14} />
                  <span className="text-ink-700">Ready to invoice</span>
                </span>
              ) : (
                <span className="text-xs text-ink-500">
                  {analysis.compliance.missingBlocking.length} blocking
                </span>
              )
            }
          >
            <Meter
              label="Complete"
              pct={analysis.compliance.completionPct}
              tone={analysis.compliance.invoiceReady ? 'good' : analysis.compliance.blockingInvoiceNow ? 'critical' : 'brand'}
            />

            <ul className="mt-4 divide-y divide-line">
              {data.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-800">
                      {doc.label}
                      {doc.isBlocking && <span className="ml-2 text-xs text-ink-500">required</span>}
                    </p>
                    {doc.note && <p className="truncate text-xs text-ink-500">{doc.note}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <DocumentState status={doc.status} />
                    {doc.status === 'missing' && (
                      <button
                        onClick={() => void setDocument(doc, 'provided')}
                        className="rounded-lg glass-card px-2.5 py-1 text-xs text-ink-700 transition hover:bg-paper-100"
                      >
                        Have it
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* Milestones */}
          {analysis.compliance.milestones.length > 0 && (
            <Card className="mt-6" title="Dates we owe someone">
              <ul className="divide-y divide-line">
                {analysis.compliance.milestones.map((m) => (
                  <li key={m.milestone.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm text-ink-800">{m.milestone.label}</p>
                      <p className="text-xs text-ink-500">
                        {new Date(m.milestone.dueAt).toLocaleDateString()} · {m.milestone.kind}
                      </p>
                    </div>
                    {m.state === 'done' ? (
                      <span className="pm-good inline-flex items-center gap-1.5 text-xs">
                        <CheckIcon width={14} height={14} />
                        <span className="text-ink-600">Done</span>
                      </span>
                    ) : m.state === 'overdue' ? (
                      <SeverityTag severity="critical" />
                    ) : m.state === 'due_soon' ? (
                      <SeverityTag severity="warn" />
                    ) : (
                      <span className="text-xs text-ink-500">Upcoming</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Drafted updates */}
          <Card
            className="mt-6"
            title="Messages"
            action={
              <div className="flex gap-1.5">
                {(['customer', 'adjuster'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => void draft(a)}
                    disabled={busy}
                    className="rounded-lg glass-card px-2.5 py-1 text-xs text-ink-700 transition hover:bg-paper-100 disabled:opacity-60"
                  >
                    Draft for {a}
                  </button>
                ))}
              </div>
            }
          >
            {data.updates.length === 0 ? (
              <EmptyState>
                Nothing drafted. The agent writes; you read it, edit it, and send it yourself —
                nothing here goes out on its own.
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {data.updates.map((u) => (
                  <li key={u.id} className="rounded-lg glass-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                        {u.audience} · {u.status}
                      </span>
                      {u.status === 'draft' && (
                        <button
                          onClick={() => void api.pmUpdateDraft(u.id, 'approved').then(load)}
                          className="rounded-lg glass-card px-2.5 py-1 text-xs text-ink-700 transition hover:bg-paper-100"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                    {u.subject && <p className="mt-1.5 text-sm font-medium text-ink-900">{u.subject}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{u.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Readings — the table view of the sparklines above */}
          {data.readings.length > 0 && (
            <Card className="mt-6" title={`Reading log (${data.readings.length})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="pb-2 pr-4 font-medium">When</th>
                      <th className="pb-2 pr-4 font-medium">Area</th>
                      <th className="pb-2 pr-4 font-medium">Kind</th>
                      <th className="pb-2 pr-4 text-right font-medium">Moisture</th>
                      <th className="pb-2 pr-4 text-right font-medium">Temp</th>
                      <th className="pb-2 pr-4 text-right font-medium">RH</th>
                      <th className="pb-2 text-right font-medium">GPP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.readings.slice(0, 60).map((r) => (
                      <tr key={r.id} className="text-ink-700">
                        <td className="py-2 pr-4 whitespace-nowrap text-xs text-ink-500">
                          {new Date(r.takenAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {data.areas.find((a) => a.id === r.areaId)?.label ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-xs">{r.kind}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {r.moisturePct?.toFixed(1) ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {r.temperatureF?.toFixed(0) ?? '—'}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {r.humidityPct?.toFixed(0) ?? '—'}
                        </td>
                        <td className="py-2 text-right tabular-nums">{r.gpp?.toFixed(1) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </main>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function DocumentState({ status }: { status: PmDocument['status'] }) {
  if (status === 'provided') {
    return (
      <span className="pm-good inline-flex items-center gap-1.5 text-xs">
        <CheckIcon width={14} height={14} />
        <span className="text-ink-600">Have it</span>
      </span>
    );
  }
  if (status === 'waived') return <span className="text-xs text-ink-500">Waived</span>;
  if (status === 'rejected') return <SeverityTag severity="warn" />;
  return <span className="text-xs text-ink-500">Missing</span>;
}

function stateLabel(state: string): string {
  switch (state) {
    case 'goal_met':
      return 'At its dry standard';
    case 'signed_off':
      return 'Signed off';
    case 'stalled':
      return 'Stalled — not dropping';
    case 'wetter':
      return 'Getting wetter';
    case 'no_readings':
      return 'Never measured';
    default:
      return 'Drying';
  }
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function dueLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (diff < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'due today';
  return `due in ${days}d`;
}
