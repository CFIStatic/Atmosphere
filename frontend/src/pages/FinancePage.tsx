import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  formatMoneyCents,
  type FinanceAlert,
  type FinanceConnection,
  type FinanceEngineResult,
  type FinanceOverview,
  type FinanceBrief,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import {
  Card,
  EmptyState,
  Meter,
  Pill,
  SeverityTag,
  StatTile,
} from '../components/pm/primitives';

/**
 * Financial Agent cockpit for the CEO, CFO, and accountants.
 *
 * Ordered the way a morning goes: cash and risk first, then alerts, then job
 * cost and the connections that feed the picture. Bank and books links are
 * observe-only — the agent reports what is happening; it does not move money.
 */

type Tab = 'alerts' | 'jobs' | 'connections';

export function FinancePage() {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('alerts');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<FinanceEngineResult | null>(null);
  const [brief, setBrief] = useState<FinanceBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const [newConn, setNewConn] = useState({
    label: '',
    kind: 'accounting' as 'bank' | 'accounting',
    provider: 'quickbooks',
    accessPath: 'api',
    credentialRef: '',
  });

  const load = useCallback(async () => {
    try {
      setData(await api.financeOverview());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the financial board.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runEngine = useCallback(
    async (silent = false) => {
      if (!silent) setRunning(true);
      try {
        const { result } = await api.financeRun();
        if (!silent) setLastRun(result);
        await load();
      } catch (err) {
        if (!silent) {
          setError(err instanceof ApiError ? err.message : 'The financial pass failed.');
        }
      } finally {
        if (!silent) setRunning(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void runEngine(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBrief(refresh = false) {
    setBriefLoading(true);
    try {
      const { brief: b } = await api.financeBrief(refresh);
      setBrief(b);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the CFO brief.');
    } finally {
      setBriefLoading(false);
    }
  }

  async function actOnAlert(alert: FinanceAlert, status: string, snoozeHours?: number) {
    setData((prev) =>
      prev ? { ...prev, alerts: prev.alerts.filter((a) => a.id !== alert.id) } : prev,
    );
    try {
      await api.financeAlertAction(alert.id, status, snoozeHours);
    } catch {
      await load();
    }
  }

  async function addConnection() {
    if (!data?.canManage) return;
    setConnecting(true);
    try {
      await api.financeCreateConnection({
        label: newConn.label.trim() || (data.providers[newConn.provider] ?? newConn.provider),
        kind: newConn.kind,
        provider: newConn.provider,
        accessPath: newConn.accessPath,
        accessMode: 'read_only',
        credentialRef: newConn.credentialRef.trim() || null,
        config:
          newConn.provider === 'quickbooks'
            ? { realmId: '', baseUrl: 'https://quickbooks.api.intuit.com' }
            : {},
      });
      setNewConn({
        label: '',
        kind: 'accounting',
        provider: 'quickbooks',
        accessPath: 'api',
        credentialRef: '',
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the connection.');
    } finally {
      setConnecting(false);
    }
  }

  async function syncConnection(c: FinanceConnection) {
    setSyncingId(c.id);
    try {
      await api.financeSyncConnection(c.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed.');
    } finally {
      setSyncingId(null);
    }
  }

  const openAlerts = useMemo(
    () => (data?.alerts ?? []).filter((a) => a.status === 'open' || a.status === 'acknowledged'),
    [data],
  );

  const providerOptions = useMemo(() => {
    if (!data?.providers) return [];
    return Object.entries(data.providers).filter(([key]) => {
      if (newConn.kind === 'bank') return ['plaid', 'bank_portal', 'manual'].includes(key);
      return !['plaid', 'bank_portal'].includes(key);
    });
  }, [data, newConn.kind]);

  if (!data && !error) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="border-b border-line bg-paper-0/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <div className="flex items-center gap-4">
            <Logo />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Financial Agent
              </p>
              <p className="text-sm text-ink-600">CFO desk · observe the books, cost the jobs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadBrief(Boolean(brief))}
              disabled={briefLoading}
              className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60"
            >
              {briefLoading ? 'Writing…' : brief ? 'Refresh brief' : 'CFO brief'}
            </button>
            <button
              type="button"
              onClick={() => void runEngine(false)}
              disabled={running}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-card transition hover:bg-brand-700 disabled:opacity-60"
            >
              {running ? 'Checking…' : 'Run now'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Cash on hand"
                value={formatMoneyCents(data.health.cashCents)}
                hint={`Floor ${formatMoneyCents(data.health.cashFloorCents)}`}
              />
              <StatTile
                label="Open AR"
                value={formatMoneyCents(data.health.openArCents)}
                hint={`${data.counts.warn + data.counts.critical} aging alerts`}
              />
              <StatTile
                label="Job cost to date"
                value={formatMoneyCents(data.health.totalCostCents)}
                hint={
                  data.health.marginPct !== null
                    ? `Blended margin ${data.health.marginPct.toFixed(1)}%`
                    : 'No contracts yet'
                }
              />
              <StatTile
                label="Connections"
                value={String(data.counts.connections)}
                hint="Read-only bank & books"
              />
            </section>

            <p className="mt-3 text-xs text-ink-500">
              Bank and accounting links are observe-only. The agent can see balances and activity;
              it does not move money or post entries without an accountant approving a draft.
            </p>

            {brief && (
              <Card className="mt-6">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                  CFO brief · {brief.forDate}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-ink-900">
                  {brief.headline ?? 'Morning brief'}
                </h2>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
                  {brief.body}
                </pre>
              </Card>
            )}

            {lastRun && (
              <p className="mt-4 text-xs text-ink-500">
                Last pass: {lastRun.findings} finding(s) · {lastRun.jobsEvaluated} job(s) ·{' '}
                {lastRun.durationMs}ms
              </p>
            )}

            <div className="mt-8 flex gap-2 border-b border-line">
              {(
                [
                  ['alerts', `Alerts (${openAlerts.length})`],
                  ['jobs', `Job cost (${data.jobs.length})`],
                  ['connections', `Connections (${data.connections.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                    tab === key
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'alerts' && (
              <div className="mt-4 space-y-3">
                {openAlerts.length === 0 ? (
                  <EmptyState>
                    Nothing urgent on the books. AR, cash, job cost, and connection freshness all
                    clear against your thresholds.
                  </EmptyState>
                ) : (
                  openAlerts.map((alert) => (
                    <Card key={alert.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityTag severity={alert.severity} />
                          <Pill>{alert.category}</Pill>
                        </div>
                        <p className="mt-2 font-medium text-ink-900">{alert.title}</p>
                        {alert.detail && (
                          <p className="mt-1 text-sm text-ink-600">{alert.detail}</p>
                        )}
                        {alert.suggestedAction && (
                          <p className="mt-2 text-sm text-ink-800">
                            <span className="font-medium">Next:</span> {alert.suggestedAction}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void actOnAlert(alert, 'acknowledged')}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                        >
                          Ack
                        </button>
                        <button
                          type="button"
                          onClick={() => void actOnAlert(alert, 'snoozed', 24)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                        >
                          Snooze 24h
                        </button>
                        <button
                          type="button"
                          onClick={() => void actOnAlert(alert, 'resolved')}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                        >
                          Resolve
                        </button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}

            {tab === 'jobs' && (
              <div className="mt-4 overflow-x-auto">
                {data.jobs.length === 0 ? (
                  <EmptyState>
                    No jobs to cost yet. When CRM jobs carry contract and invoice amounts — and
                    labor is logged — rollups appear here.
                  </EmptyState>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Job</th>
                        <th className="px-3 py-2 font-medium">Contract</th>
                        <th className="px-3 py-2 font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Margin</th>
                        <th className="px-3 py-2 font-medium">Open AR</th>
                        <th className="px-3 py-2 font-medium">Aging</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.jobs.map((job) => (
                        <tr key={job.jobId} className="border-b border-line/70">
                          <td className="px-3 py-3">
                            <p className="font-medium text-ink-900">
                              {job.jobNumber != null ? `#${job.jobNumber} · ` : ''}
                              {job.title}
                            </p>
                            <p className="text-xs text-ink-500">
                              Labor {formatMoneyCents(job.laborCents)} · Mat{' '}
                              {formatMoneyCents(job.materialsCents)} · Eqp{' '}
                              {formatMoneyCents(job.equipmentCents)}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-ink-800">
                            {formatMoneyCents(job.contractCents)}
                          </td>
                          <td className="px-3 py-3 text-ink-800">
                            {formatMoneyCents(job.costCents)}
                            {job.contractCents && job.contractCents > 0 ? (
                              <div className="mt-1 w-36">
                                <Meter
                                  label="Burn"
                                  pct={Math.min(100, (job.costCents / job.contractCents) * 100)}
                                />
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-ink-800">
                            {job.marginPct !== null ? `${job.marginPct.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-3 text-ink-800">
                            {formatMoneyCents(job.openArCents)}
                          </td>
                          <td className="px-3 py-3 text-ink-800">
                            {job.agingDays !== null ? `${job.agingDays}d` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === 'connections' && (
              <div className="mt-4 space-y-4">
                {data.connections.map((c) => (
                  <Card key={c.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">{c.label}</p>
                        <Pill>{c.kind}</Pill>
                        <Pill>{data.providers[c.provider] ?? c.provider}</Pill>
                        <Pill>{c.accessMode.replace('_', '-')}</Pill>
                        <Pill>{c.status}</Pill>
                      </div>
                      <p className="mt-1 text-sm text-ink-600">
                        via {c.accessPath}
                        {c.lastSyncAt
                          ? ` · last sync ${new Date(c.lastSyncAt).toLocaleString()}`
                          : ' · never synced'}
                      </p>
                      {c.lastError && (
                        <p className="mt-1 text-sm text-red-700">{c.lastError}</p>
                      )}
                    </div>
                    {data.canManage && (
                      <button
                        type="button"
                        disabled={syncingId === c.id}
                        onClick={() => void syncConnection(c)}
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-60"
                      >
                        {syncingId === c.id ? 'Syncing…' : 'Sync now'}
                      </button>
                    )}
                  </Card>
                ))}

                {data.accounts.length > 0 && (
                  <Card>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      Observed accounts
                    </p>
                    <ul className="mt-3 divide-y divide-line">
                      {data.accounts.map((a) => (
                        <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                          <span className="text-ink-800">
                            {a.name}{' '}
                            <span className="text-ink-500">({a.accountType})</span>
                          </span>
                          <span className="font-medium text-ink-900">
                            {formatMoneyCents(a.balanceCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {data.canManage ? (
                  <Card>
                    <p className="text-sm font-semibold text-ink-900">Connect books or bank</p>
                    <p className="mt-1 text-sm text-ink-600">
                      QuickBooks / Intuit, Xero, Wave, or a bank portal — always read-only unless
                      you later approve a draft write.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-ink-700">
                        Label
                        <input
                          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2"
                          value={newConn.label}
                          onChange={(e) => setNewConn((s) => ({ ...s, label: e.target.value }))}
                          placeholder="Operating checking / QuickBooks Online"
                        />
                      </label>
                      <label className="text-sm text-ink-700">
                        Kind
                        <select
                          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2"
                          value={newConn.kind}
                          onChange={(e) =>
                            setNewConn((s) => ({
                              ...s,
                              kind: e.target.value as 'bank' | 'accounting',
                              provider:
                                e.target.value === 'bank' ? 'bank_portal' : 'quickbooks',
                            }))
                          }
                        >
                          <option value="accounting">Accounting software</option>
                          <option value="bank">Bank account</option>
                        </select>
                      </label>
                      <label className="text-sm text-ink-700">
                        Provider
                        <select
                          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2"
                          value={newConn.provider}
                          onChange={(e) => setNewConn((s) => ({ ...s, provider: e.target.value }))}
                        >
                          {providerOptions.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-ink-700">
                        Credential ref (env name)
                        <input
                          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2"
                          value={newConn.credentialRef}
                          onChange={(e) =>
                            setNewConn((s) => ({
                              ...s,
                              credentialRef: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
                            }))
                          }
                          placeholder="QBO_ACCESS_TOKEN"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={connecting}
                      onClick={() => void addConnection()}
                      className="mt-4 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {connecting ? 'Saving…' : 'Add read-only connection'}
                    </button>
                  </Card>
                ) : (
                  <p className="text-sm text-ink-500">
                    Ask an accountant, office manager, or the organization owner to connect the
                    bank or QuickBooks.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
