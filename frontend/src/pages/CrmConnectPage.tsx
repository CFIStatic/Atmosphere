import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, ApiError, type CrmAgentSystem, type CrmCredentialStatusRow } from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useT } from '../lib/i18n';

type ProviderCard = {
  id: CrmAgentSystem;
  name: string;
  blurb: string;
};

const PROVIDERS: ProviderCard[] = [
  {
    id: 'jobnimbus',
    name: 'JobNimbus',
    blurb: 'An Atmosphere agent signs in with your JobNimbus login to pull and update jobs, contacts, and claims.',
  },
  {
    id: 'acculynx',
    name: 'AccuLynx',
    blurb: 'An Atmosphere agent signs in with your AccuLynx login to pull and update jobs, contacts, and claims.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    blurb: 'An Atmosphere agent signs in with your Salesforce login to pull and update jobs, contacts, and claims.',
  },
  {
    id: 'servicetitan',
    name: 'ServiceTitan',
    blurb: 'An Atmosphere agent signs in with your ServiceTitan login to pull and update jobs, contacts, and claims.',
  },
];

type Draft = { username: string; password: string; notes: string };

const emptyDraft = (): Draft => ({ username: '', password: '', notes: '' });

/**
 * Connect CRM — username/password credentials for agent login into
 * JobNimbus, AccuLynx, Salesforce, and ServiceTitan. No API-key / OAuth UX
 * and no Atmosphere-native row on this page.
 */
export function CrmConnectPage() {
  useFeatureTimer('crm_connect');
  const t = useT();
  const outlet = useOutletContext<{ chrome?: string } | null>();
  const inShell = outlet?.chrome === 'operations';

  const [systems, setSystems] = useState<CrmCredentialStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CrmAgentSystem | null>(null);
  const [openForm, setOpenForm] = useState<CrmAgentSystem | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<CrmAgentSystem, Draft>>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const status = await api.crmCredentialStatus();
      setSystems(status.systems ?? []);
    } catch (err) {
      // Healthy empty state when the API is briefly unavailable — never show
      // a stray orange "Not found" from a removed legacy path.
      if (err instanceof ApiError && (err.status === 404 || /not found/i.test(err.message))) {
        setSystems(
          PROVIDERS.map((p) => ({
            system: p.id,
            connected: false,
            username: null,
            notes: null,
            status: null,
            lastVerifiedAt: null,
            lastError: null,
            connectedAt: null,
          })),
        );
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load CRM connections.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function rowFor(system: CrmAgentSystem): CrmCredentialStatusRow | undefined {
    return systems.find((s) => s.system === system);
  }

  function draftFor(system: CrmAgentSystem): Draft {
    return drafts[system] ?? emptyDraft();
  }

  function setDraft(system: CrmAgentSystem, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [system]: { ...draftFor(system), ...patch } }));
  }

  async function connect(system: CrmAgentSystem, e: FormEvent) {
    e.preventDefault();
    const draft = draftFor(system);
    const username = draft.username.trim();
    const password = draft.password;
    if (!username || !password) return;
    setBusy(system);
    setNotice(null);
    setError(null);
    try {
      const result = await api.connectCrmCredentials({
        system,
        username,
        password,
        notes: draft.notes.trim() || null,
      });
      setOpenForm(null);
      setDrafts((d) => ({ ...d, [system]: emptyDraft() }));
      const name = PROVIDERS.find((p) => p.id === system)?.name ?? system;
      setNotice(
        result.verify?.summary
          ? `${name} connected. ${result.verify.summary}`
          : `${name} connected.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(system: CrmAgentSystem) {
    setBusy(system);
    setNotice(null);
    setError(null);
    try {
      await api.disconnectCrmCredentials(system);
      setNotice(`${PROVIDERS.find((p) => p.id === system)?.name ?? system} disconnected.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
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
            const row = rowFor(provider.id);
            const connected = Boolean(row?.connected);
            const isBusy = busy === provider.id;
            const showForm = openForm === provider.id;
            const draft = draftFor(provider.id);

            return (
              <div
                key={provider.id}
                className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5"
                data-testid={`crm-card-${provider.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink-900">{provider.name}</h2>
                      {connected ? (
                        <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                          Connected
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{provider.blurb}</p>
                    {connected && row?.username ? (
                      <p className="mt-1 text-xs text-ink-600">
                        Signed in as <span className="font-medium">{row.username}</span>
                      </p>
                    ) : null}
                    {connected && row?.lastError ? (
                      <p className="mt-1 text-xs text-ink-400">{row.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {connected ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void disconnect(provider.id)}
                        className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-paper-100"
                      >
                        {isBusy ? '…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setOpenForm(showForm ? null : provider.id)}
                        className="rounded-full border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {showForm && !connected ? (
                  <form
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    onSubmit={(e) => void connect(provider.id, e)}
                    data-testid={`crm-form-${provider.id}`}
                  >
                    <label className="text-xs font-medium text-ink-700">
                      Username
                      <input
                        type="text"
                        name="username"
                        autoComplete="username"
                        value={draft.username}
                        onChange={(e) => setDraft(provider.id, { username: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
                        placeholder={`${provider.name} username or email`}
                        required
                      />
                    </label>
                    <label className="text-xs font-medium text-ink-700">
                      Password
                      <input
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        value={draft.password}
                        onChange={(e) => setDraft(provider.id, { password: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
                        placeholder="Password"
                        required
                      />
                    </label>
                    <label className="text-xs font-medium text-ink-700 sm:col-span-2">
                      Notes <span className="font-normal text-ink-400">(optional)</span>
                      <input
                        type="text"
                        name="notes"
                        value={draft.notes}
                        onChange={(e) => setDraft(provider.id, { notes: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900"
                        placeholder="e.g. office login, sandbox"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <button
                        type="submit"
                        disabled={isBusy || !draft.username.trim() || !draft.password}
                        className="rounded-full border border-brand-700 bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {isBusy ? '…' : 'Save & connect'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setOpenForm(null)}
                        className="rounded-full border border-line bg-paper-0 px-3 py-2 text-xs font-semibold text-ink-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
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
