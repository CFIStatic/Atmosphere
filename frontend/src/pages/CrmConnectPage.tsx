import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  api,
  ApiError,
  type CrmConnections,
  type CrmSyncStatus,
  type CrmSyncSystem,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useT } from '../lib/i18n';

type ProviderId = CrmSyncSystem | 'salesforce' | 'atmosphere';

type ProviderCard = {
  id: ProviderId;
  name: string;
  blurb: string;
  method: 'native' | 'api_key' | 'oauth';
  depth?: string;
};

const PROVIDERS: ProviderCard[] = [
  {
    id: 'atmosphere',
    name: 'Atmosphere native',
    blurb: 'Title, claim #, address, and notes — edit in the job file or Ask.',
    method: 'native',
  },
  {
    id: 'jobnimbus',
    name: 'JobNimbus',
    blurb: 'Pull and push jobs & notes with a Bearer API key.',
    method: 'api_key',
    depth: 'Deepest',
  },
  {
    id: 'acculynx',
    name: 'AccuLynx',
    blurb: 'Connect with an API key, then pull jobs into Atmosphere.',
    method: 'api_key',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    blurb: 'Authorise in Salesforce. We never see your password.',
    method: 'oauth',
  },
  {
    id: 'servicetitan',
    name: 'ServiceTitan',
    blurb: 'Connect with an API key, then pull jobs into Atmosphere.',
    method: 'api_key',
  },
];

/**
 * Connect CRM — scaffold for JobNimbus, AccuLynx, Salesforce, ServiceTitan,
 * plus Atmosphere native fields. OAuth/API login may be stubbed when env is unset.
 */
export function CrmConnectPage() {
  useFeatureTimer('crm_connect');
  const t = useT();
  const outlet = useOutletContext<{ chrome?: string } | null>();
  const inShell = outlet?.chrome === 'operations';

  const [sync, setSync] = useState<CrmSyncStatus | null>(null);
  const [crm, setCrm] = useState<CrmConnections | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [keyDraft, setKeyDraft] = useState<Partial<Record<CrmSyncSystem, string>>>({});
  const [openKey, setOpenKey] = useState<CrmSyncSystem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [syncStatus, connections] = await Promise.all([
        api.crmSyncStatus(),
        api.crmConnections(),
      ]);
      setSync(syncStatus);
      setCrm(connections);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load CRM connections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function syncRow(system: CrmSyncSystem) {
    return sync?.systems.find((s) => s.system === system) ?? null;
  }

  function salesforceConnected() {
    return Boolean(crm?.connected.some((c) => c.system === 'salesforce'));
  }

  async function connectApiKey(system: CrmSyncSystem, e: FormEvent) {
    e.preventDefault();
    const apiKey = (keyDraft[system] ?? '').trim();
    if (!apiKey) return;
    setBusy(system);
    setNotice(null);
    setError(null);
    try {
      await api.connectCrmSync({ system, apiKey });
      setOpenKey(null);
      setKeyDraft((d) => ({ ...d, [system]: '' }));
      setNotice(`${PROVIDERS.find((p) => p.id === system)?.name ?? system} connected.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnectSync(system: CrmSyncSystem) {
    setBusy(system);
    setNotice(null);
    setError(null);
    try {
      await api.disconnectCrmSync(system);
      setNotice(`${PROVIDERS.find((p) => p.id === system)?.name ?? system} disconnected.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  async function pullSync(system: CrmSyncSystem) {
    setBusy(system);
    setNotice(null);
    setError(null);
    try {
      const { summary } = await api.runCrmSync(system);
      setNotice(
        `Pulled from ${PROVIDERS.find((p) => p.id === system)?.name ?? system}: ${summary.created} new, ${summary.updated} updated, ${summary.conflicts} conflicts.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not pull jobs.');
    } finally {
      setBusy(null);
    }
  }

  async function connectSalesforce() {
    setBusy('salesforce');
    setNotice(null);
    setError(null);
    try {
      const { url } = await api.connectSalesforce();
      if (url) {
        window.location.assign(url);
        return;
      }
      setNotice('Salesforce OAuth is scaffolded — configure Salesforce env to go live.');
    } catch (err) {
      // Scaffold: env often unset; show honest message instead of raw 500.
      setNotice(
        err instanceof ApiError
          ? err.message
          : 'Salesforce OAuth is scaffolded — configure Salesforce env to go live.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function disconnectSalesforce() {
    setBusy('salesforce');
    setNotice(null);
    setError(null);
    try {
      await api.disconnectSalesforce();
      setNotice('Salesforce disconnected.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect Salesforce.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={inShell ? 'mx-auto max-w-3xl' : 'mx-auto max-w-3xl px-4 py-8'}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          {t('crm.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{t('crm.subtitle')}</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper-0 shadow-sm">
          {PROVIDERS.map((provider) => {
            if (provider.id === 'atmosphere') {
              return (
                <div
                  key={provider.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5"
                  data-testid="crm-card-atmosphere"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink-900">{provider.name}</h2>
                      <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                        Live
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{provider.blurb}</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="rounded-full border border-line bg-paper-50 px-3 py-1.5 text-xs font-semibold text-ink-400"
                  >
                    Always on
                  </button>
                </div>
              );
            }

            if (provider.id === 'salesforce') {
              const connected = salesforceConnected();
              const sfBusy = busy === 'salesforce';
              return (
                <div
                  key={provider.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-5"
                  data-testid="crm-card-salesforce"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink-900">{provider.name}</h2>
                      <span className="rounded-full border border-line bg-paper-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        {connected ? 'Connected' : 'OAuth'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{provider.blurb}</p>
                    {crm && !crm.salesforceConfigured && (
                      <p className="mt-1 text-xs text-ink-400">
                        Scaffold — Salesforce env not configured yet.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {connected ? (
                      <button
                        type="button"
                        disabled={sfBusy}
                        onClick={() => void disconnectSalesforce()}
                        className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper-100"
                      >
                        {sfBusy ? '…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={sfBusy}
                        onClick={() => void connectSalesforce()}
                        className="rounded-full border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                      >
                        {sfBusy ? '…' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const system = provider.id as CrmSyncSystem;
            const row = syncRow(system);
            const connected = Boolean(row?.connected);
            const isBusy = busy === system;
            const showForm = openKey === system;

            return (
              <div
                key={provider.id}
                className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5"
                data-testid={`crm-card-${system}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink-900">{provider.name}</h2>
                      <span
                        className={
                          connected
                            ? 'rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800'
                            : 'rounded-full border border-line bg-paper-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500'
                        }
                      >
                        {connected ? 'Connected' : provider.depth ?? 'API key'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{provider.blurb}</p>
                    {connected && row?.accountLabel && (
                      <p className="mt-1 text-xs text-ink-400">{row.accountLabel}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {connected ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void pullSync(system)}
                          className="rounded-full border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                        >
                          {isBusy ? '…' : 'Pull'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void disconnectSync(system)}
                          className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper-100"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setOpenKey(showForm ? null : system)}
                        className="rounded-full border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
                {showForm && !connected && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => void connectApiKey(system, e)}
                  >
                    <label className="min-w-[200px] flex-1 text-xs font-medium text-ink-700">
                      API key
                      <input
                        type="password"
                        autoComplete="off"
                        value={keyDraft[system] ?? ''}
                        onChange={(e) =>
                          setKeyDraft((d) => ({ ...d, [system]: e.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
                        placeholder={`${provider.name} API key`}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={isBusy || !(keyDraft[system] ?? '').trim()}
                      className="rounded-full border border-brand-700 bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {isBusy ? '…' : 'Add'}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(error || notice) && (
        <p
          className={`mt-4 text-sm ${error ? 'text-danger-700' : 'text-ink-600'}`}
          role="status"
        >
          {error ?? notice}
        </p>
      )}
    </div>
  );
}
