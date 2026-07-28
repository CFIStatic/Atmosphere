import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  timeAgo,
  type CrmCatalogEntry,
  type IntegrationSource,
  type SyncResult,
} from '../lib/api';
import { AppShell, PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { RefreshIcon, SpinnerIcon, PlusIcon, CheckIcon, GlobeIcon } from '../components/icons';

type Tab = 'connections' | 'catalog';

/**
 * Integrations — connect any CRM, pull contacts onto the map, push notes back.
 *
 * Catalog presets cover Dash, Luxor, Salesforce, HubSpot, JobNimbus, Encircle,
 * plus a generic REST connector and CSV for systems without an API.
 */
export function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>('connections');
  const [sources, setSources] = useState<IntegrationSource[]>([]);
  const [catalog, setCatalog] = useState<CrmCatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Record<string, SyncResult>>({});
  const [connecting, setConnecting] = useState<CrmCatalogEntry | null>(null);
  const [form, setForm] = useState({
    label: '',
    baseUrl: '',
    apiKey: '',
    username: '',
    password: '',
    securityToken: '',
    accountId: '',
    instanceUrl: '',
    sandbox: true,
  });
  const [csvSourceId, setCsvSourceId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');
  const [pushSourceId, setPushSourceId] = useState<string | null>(null);
  const [pushForm, setPushForm] = useState({
    subject: 'Atmosphere check-in',
    body: '',
    externalId: '',
  });

  const load = useCallback(async () => {
    try {
      const [src, cat] = await Promise.all([api.listIntegrationSources(), api.integrationCatalog()]);
      setSources(src.sources);
      setCatalog(cat.systems);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load integrations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openConnect(entry: CrmCatalogEntry) {
    setConnecting(entry);
    setForm({
      label: entry.name,
      baseUrl: typeof entry.defaultConfig.baseUrl === 'string' ? entry.defaultConfig.baseUrl : '',
      apiKey: '',
      username: '',
      password: '',
      securityToken: '',
      accountId: '',
      instanceUrl: '',
      sandbox: entry.supportsSandbox,
    });
    setTab('catalog');
  }

  async function submitConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!connecting) return;
    setBusy('connect');
    try {
      const credentials: Record<string, string> = {};
      if (form.apiKey) credentials.apiKey = form.apiKey;
      if (form.username) credentials.username = form.username;
      if (form.password) credentials.password = form.password;
      if (form.securityToken) credentials.securityToken = form.securityToken;
      if (form.accountId) credentials.accountId = form.accountId;
      if (form.instanceUrl) credentials.instanceUrl = form.instanceUrl;
      if (form.baseUrl) credentials.baseUrl = form.baseUrl;

      await api.connectCrm({
        system: connecting.id,
        label: form.label || connecting.name,
        sandbox: form.sandbox,
        baseUrl: form.baseUrl || undefined,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      });
      setConnecting(null);
      setTab('connections');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect CRM.');
    } finally {
      setBusy(null);
    }
  }

  async function syncAndPromote(id: string) {
    setBusy(`sync-${id}`);
    try {
      const res = await api.syncIntegrationSource(id, { promote: true });
      setLastSync((m) => ({ ...m, [id]: res.sync }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  }

  async function promoteOnly(id: string) {
    setBusy(`promote-${id}`);
    try {
      await api.promoteIntegrationSource(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Promote failed.');
    } finally {
      setBusy(null);
    }
  }

  async function importCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvSourceId) return;
    setBusy('csv');
    try {
      await api.importIntegrationCsv(csvSourceId, {
        entityType: 'contact',
        csv: csvText,
        idColumn: 'id',
        promote: true,
      });
      setCsvText('');
      setCsvSourceId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'CSV import failed.');
    } finally {
      setBusy(null);
    }
  }

  async function pushNote(e: React.FormEvent) {
    e.preventDefault();
    if (!pushSourceId) return;
    setBusy('push');
    try {
      await api.pushToIntegration(pushSourceId, {
        operation: 'create_note',
        subject: pushForm.subject,
        body: pushForm.body,
        externalId: pushForm.externalId || undefined,
      });
      setPushSourceId(null);
      setPushForm({ subject: 'Atmosphere check-in', body: '', externalId: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Push failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!sources && !error) {
    return (
      <AppShell>
        <PanelSpinner label="Loading integrations…" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Integrations"
        description="Connect Dash, Luxor, Salesforce, or any CRM — pull contacts onto your map, and push notes back."
        action={
          <Link
            to="/email-marketing"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-paper-100"
          >
            Open Email Marketing
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['connections', 'Connected CRMs'],
            ['catalog', 'Connect a CRM'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'connections' && (
        <section className="space-y-4">
          {sources.length === 0 ? (
            <EmptyState
              title="No CRMs connected yet"
              hint="Connect Dash, Luxor, Salesforce, HubSpot, JobNimbus, Encircle — or any REST/CSV system — from the catalog."
            />
          ) : (
            <ul className="space-y-3">
              {sources.map((source) => {
                const sync = lastSync[source.id];
                return (
                  <li
                    key={source.id}
                    className="rounded-xl border border-line bg-paper-0 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink-900">
                          {source.label}{' '}
                          <span className="text-xs font-normal uppercase tracking-wide text-ink-400">
                            {source.system}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-ink-500">
                          {source.direction} ·{' '}
                          {source.credentialConfigured
                            ? `credentials (${source.credentialStorage})`
                            : 'sandbox / no credentials'}
                          {source.lastSyncAt ? ` · synced ${timeAgo(source.lastSyncAt)}` : ' · never synced'}
                          {source.lastPromoteAt
                            ? ` · promoted ${timeAgo(source.lastPromoteAt)}`
                            : ''}
                          {!source.enabled ? ' · disabled' : ''}
                        </p>
                        {sync && (
                          <p className="mt-1 text-xs text-ink-600">
                            Last run: {sync.status} — {sync.stats.created} new,{' '}
                            {sync.stats.changed} changed, {sync.stats.unchanged} unchanged
                            {sync.error ? ` · ${sync.error}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {source.kind === 'rest' && (
                          <button
                            type="button"
                            disabled={busy === `sync-${source.id}`}
                            onClick={() => void syncAndPromote(source.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                          >
                            {busy === `sync-${source.id}` ? (
                              <SpinnerIcon width={14} height={14} className="animate-spin" />
                            ) : (
                              <RefreshIcon width={14} height={14} />
                            )}
                            Sync & promote
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy === `promote-${source.id}`}
                          onClick={() => void promoteOnly(source.id)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100 disabled:opacity-60"
                        >
                          Promote to CRM
                        </button>
                        {source.kind === 'csv' && (
                          <button
                            type="button"
                            onClick={() => setCsvSourceId(source.id)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                          >
                            Import CSV
                          </button>
                        )}
                        {(source.direction === 'push' || source.direction === 'bidirectional') && (
                          <button
                            type="button"
                            onClick={() => setPushSourceId(source.id)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-100"
                          >
                            Push note
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {csvSourceId && (
            <form onSubmit={importCsv} className="rounded-xl border border-line bg-paper-0 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-ink-900">Import CSV contacts</h3>
              <p className="text-xs text-ink-500">
                Include an <code>id</code> column plus name/email/address fields. Data is mirrored,
                then promoted into Atmosphere CRM.
              </p>
              <textarea
                required
                rows={8}
                className="w-full rounded-lg border border-line bg-paper-50 px-3 py-2 font-mono text-xs text-ink-900"
                placeholder={'id,firstName,lastName,email,city,region,latitude,longitude\n1,Ada,Lovelace,ada@example.com,Des Moines,IA,41.58,-93.62'}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy === 'csv'}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy === 'csv' ? 'Importing…' : 'Import & promote'}
                </button>
                <button
                  type="button"
                  onClick={() => setCsvSourceId(null)}
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {pushSourceId && (
            <form onSubmit={pushNote} className="rounded-xl border border-line bg-paper-0 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-ink-900">Push a note into the CRM</h3>
              <label className="block text-sm">
                <span className="text-ink-600">External contact id (optional)</span>
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                  value={pushForm.externalId}
                  onChange={(e) => setPushForm((f) => ({ ...f, externalId: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-600">Subject</span>
                <input
                  required
                  className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                  value={pushForm.subject}
                  onChange={(e) => setPushForm((f) => ({ ...f, subject: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-600">Body</span>
                <textarea
                  required
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                  value={pushForm.body}
                  onChange={(e) => setPushForm((f) => ({ ...f, body: e.target.value }))}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy === 'push'}
                  className="rounded-lg bg-ink-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy === 'push' ? 'Sending…' : 'Push to CRM'}
                </button>
                <button
                  type="button"
                  onClick={() => setPushSourceId(null)}
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {tab === 'catalog' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => openConnect(entry)}
                className={`rounded-xl border p-4 text-left transition ${
                  connecting?.id === entry.id
                    ? 'border-brand-400 bg-brand-50'
                    : 'border-line bg-paper-0 hover:bg-paper-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink-900">{entry.name}</p>
                  <GlobeIcon width={16} height={16} className="text-ink-400" />
                </div>
                <p className="mt-1 text-sm text-ink-600">{entry.blurb}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-ink-400">
                  {entry.direction} · {entry.kind}
                  {entry.supportsSandbox ? ' · sandbox' : ''}
                </p>
              </button>
            ))}
          </div>

          {connecting && (
            <form onSubmit={submitConnect} className="rounded-xl border border-line bg-paper-0 p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <PlusIcon width={16} height={16} />
                Connect {connecting.name}
              </h3>
              <label className="block text-sm">
                <span className="text-ink-600">Label</span>
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </label>
              {connecting.credentialFields.includes('baseUrl') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Base URL</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    placeholder="https://api.example.com"
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('instanceUrl') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Salesforce instance URL</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    placeholder="https://yourorg.my.salesforce.com"
                    value={form.instanceUrl}
                    onChange={(e) => setForm((f) => ({ ...f, instanceUrl: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('apiKey') && (
                <label className="block text-sm">
                  <span className="text-ink-600">API key / token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('accountId') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Account / company id</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('username') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Username</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('password') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Password</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                </label>
              )}
              {connecting.credentialFields.includes('securityToken') && (
                <label className="block text-sm">
                  <span className="text-ink-600">Security token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2"
                    value={form.securityToken}
                    onChange={(e) => setForm((f) => ({ ...f, securityToken: e.target.value }))}
                  />
                </label>
              )}
              {connecting.supportsSandbox && (
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={form.sandbox}
                    onChange={(e) => setForm((f) => ({ ...f, sandbox: e.target.checked }))}
                  />
                  Use sandbox demo data (no live vendor call)
                </label>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy === 'connect'}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy === 'connect' ? (
                    <SpinnerIcon width={15} height={15} className="animate-spin" />
                  ) : (
                    <CheckIcon width={15} height={15} />
                  )}
                  Connect {connecting.name}
                </button>
                <button
                  type="button"
                  onClick={() => setConnecting(null)}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-ink-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </AppShell>
  );
}
