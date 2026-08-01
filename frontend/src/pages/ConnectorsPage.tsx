import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  CONNECTOR_ACCESS_MODE_LABELS,
  CONNECTOR_CATEGORY_LABELS,
  type AppConnectorConnection,
  type ConnectAppConnectorInput,
  type ConnectorAccessMode,
  type ConnectorCatalogResponse,
  type ConnectorCategory,
  type ConnectorDefinition,
} from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';
import {
  BoltIcon,
  CheckIcon,
  GlobeIcon,
  MonitorIcon,
  PlugIcon,
  SpinnerIcon,
  ToolIcon,
} from '../components/icons';

/**
 * Connectors — curated third-party apps for restoration, roofing, and
 * contractor teams. Each app connects through Web Access (browser agent),
 * Computer Use (desktop agent), or an Estimator API adapter.
 */

const inputClass =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-700';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function ModeBadge({ mode }: { mode: ConnectorAccessMode }) {
  const Icon = mode === 'web' ? GlobeIcon : mode === 'computer' ? MonitorIcon : ToolIcon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper-100 px-2 py-0.5 text-xs font-medium text-ink-700">
      <Icon width={12} height={12} />
      {CONNECTOR_ACCESS_MODE_LABELS[mode]}
    </span>
  );
}

function isCategory(value: string | null, cats: ConnectorCategory[]): value is ConnectorCategory {
  return !!value && cats.includes(value as ConnectorCategory);
}

export function ConnectorsPage() {
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState<ConnectorCatalogResponse | null>(null);
  const [connections, setConnections] = useState<AppConnectorConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [connecting, setConnecting] = useState<ConnectorDefinition | null>(null);
  const [running, setRunning] = useState<AppConnectorConnection | null>(null);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, connectionsRes] = await Promise.all([
        api.getConnectorCatalog(all),
        api.getAppConnections(),
      ]);
      setCatalog(catalogRes);
      setConnections(connectionsRes.connections);
    } catch (err) {
      setError(errorMessage(err, 'Could not load connectors.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(showAll);
  }, [load, showAll]);

  const categories = catalog?.categories.map((c) => c.id) ?? [];
  const rawTab = params.get('tab');
  const activeTab: ConnectorCategory | 'connected' = rawTab === 'connected'
    ? 'connected'
    : isCategory(rawTab, categories)
      ? rawTab
      : categories[0] ?? 'restoration';

  function selectTab(tab: ConnectorCategory | 'connected') {
    setParams(tab === (categories[0] ?? 'restoration') ? {} : { tab }, { replace: false });
  }

  const connectedByKey = useMemo(() => {
    const map = new Map<string, AppConnectorConnection>();
    for (const connection of connections) map.set(connection.connectorKey, connection);
    return map;
  }, [connections]);

  const visibleConnectors = useMemo(() => {
    if (!catalog) return [];
    if (activeTab === 'connected') return [];
    return catalog.connectors.filter((c) => c.category === activeTab);
  }, [catalog, activeTab]);

  async function refreshConnections() {
    const { connections: next } = await api.getAppConnections();
    setConnections(next);
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Integrations"
        title="Connectors"
        description="Connect the tools your restoration, roofing, or contracting team already uses. Atmosphere reaches them through web access, a computer-use agent, or a direct API."
        action={
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded border-line text-brand-600 focus:ring-brand-200"
            />
            Show all industries
          </label>
        }
      />

      {loading && !catalog ? (
        <PanelSpinner label="Loading connectors" />
      ) : error && !catalog ? (
        <ErrorNote message={error} />
      ) : catalog ? (
        <>
          <nav
            aria-label="Connector categories"
            className="flex gap-2 overflow-x-auto border-b border-line pb-px"
          >
            <TabButton
              active={activeTab === 'connected'}
              onClick={() => selectTab('connected')}
              count={connections.length}
            >
              Connected
            </TabButton>
            {catalog.categories.map((category) => {
              const count = catalog.connectors.filter((c) => c.category === category.id).length;
              if (count === 0) return null;
              return (
                <TabButton
                  key={category.id}
                  active={activeTab === category.id}
                  onClick={() => selectTab(category.id)}
                  count={count}
                >
                  {category.label}
                </TabButton>
              );
            })}
          </nav>

          {!catalog.capabilities.webAccessEnabled && (
            <p className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-600">
              Web Access is not configured on this server, so browser-based connectors cannot sign
              in yet. Computer Use and API connectors still work.
            </p>
          )}

          {error && (
            <div className="mt-4">
              <ErrorNote message={error} />
            </div>
          )}

          <div className="mt-6">
            {activeTab === 'connected' ? (
              connections.length === 0 ? (
                <EmptyState
                  title="No apps connected yet"
                  hint="Pick a tab above and connect ServiceTitan, AccuLynx, Xactimate, or any website your team uses."
                />
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {connections.map((connection) => (
                    <ConnectedCard
                      key={connection.id}
                      connection={connection}
                      onRun={() => setRunning(connection)}
                      onRemoved={async () => {
                        await refreshConnections();
                      }}
                      onReconnect={() => {
                        const def =
                          connection.definition ??
                          catalog.connectors.find((c) => c.key === connection.connectorKey);
                        if (def) setConnecting(def);
                      }}
                    />
                  ))}
                </ul>
              )
            ) : visibleConnectors.length === 0 ? (
              <EmptyState
                title={`No ${CONNECTOR_CATEGORY_LABELS[activeTab]} apps for your industry`}
                hint="Turn on “Show all industries” to browse the full catalog."
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {visibleConnectors.map((def) => (
                  <CatalogCard
                    key={def.key}
                    definition={def}
                    connection={connectedByKey.get(def.key)}
                    capabilities={catalog.capabilities}
                    onConnect={() => setConnecting(def)}
                    onRun={(connection) => setRunning(connection)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {connecting && catalog && (
        <ConnectModal
          definition={connecting}
          existing={connectedByKey.get(connecting.key)}
          capabilities={catalog.capabilities}
          onClose={() => setConnecting(null)}
          onConnected={async () => {
            setConnecting(null);
            await refreshConnections();
            selectTab('connected');
          }}
        />
      )}

      {running && (
        <RunModal
          connection={running}
          onClose={() => setRunning(null)}
        />
      )}
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
        active
          ? 'border-brand-500 text-brand-700'
          : 'border-transparent text-ink-600 hover:text-ink-900'
      }`}
    >
      {children}
      {typeof count === 'number' && (
        <span
          className={`rounded-md px-1.5 py-0.5 text-xs ${
            active ? 'bg-brand-50 text-brand-700' : 'bg-paper-100 text-ink-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function CatalogCard({
  definition,
  connection,
  capabilities,
  onConnect,
  onRun,
}: {
  definition: ConnectorDefinition;
  connection?: AppConnectorConnection;
  capabilities: ConnectorCatalogResponse['capabilities'];
  onConnect: () => void;
  onRun: (connection: AppConnectorConnection) => void;
}) {
  const preferred = definition.accessModes[0];
  const modeBlocked =
    (preferred === 'web' && !capabilities.webAccessEnabled) ||
    (preferred === 'api' && !capabilities.estimatorCredentialStorageAvailable);

  return (
    <li className="flex flex-col rounded-xl border border-line bg-paper-0 p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
          <PlugIcon width={18} height={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink-900">{definition.name}</h2>
            {connection && (
              <span className="inline-flex items-center gap-1 rounded-md border border-success-200 bg-success-50 px-2 py-0.5 text-xs font-medium text-success-600">
                <CheckIcon width={12} height={12} />
                Connected
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-600">{definition.blurb}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {definition.accessModes.map((mode) => (
          <ModeBadge key={mode} mode={mode} />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={modeBlocked && !connection}
          className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-50"
        >
          {connection ? 'Reconnect' : 'Connect'}
        </button>
        {connection?.accessMode === 'web' && (
          <button
            type="button"
            onClick={() => onRun(connection)}
            className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
          >
            Run task
          </button>
        )}
        {connection?.accessMode === 'computer' && (
          <Link
            to="/computer-use"
            className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
          >
            Open Computer Use
          </Link>
        )}
        {connection?.accessMode === 'api' && (
          <Link
            to="/estimator"
            className="rounded-lg border border-line bg-paper-0 px-3.5 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
          >
            Open Estimator
          </Link>
        )}
      </div>
    </li>
  );
}

function ConnectedCard({
  connection,
  onRun,
  onRemoved,
  onReconnect,
}: {
  connection: AppConnectorConnection;
  onRun: () => void;
  onRemoved: () => void | Promise<void>;
  onReconnect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const name = connection.definition?.name ?? connection.label;

  async function disconnect() {
    setBusy(true);
    setNote(null);
    try {
      await api.deleteAppConnector(connection.id, true);
      await onRemoved();
    } catch (err) {
      setNote(errorMessage(err, 'Could not disconnect.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line bg-paper-0 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-900">{name}</h2>
          <p className="mt-1 text-sm text-ink-600">{connection.label}</p>
          <div className="mt-3">
            <ModeBadge mode={connection.accessMode} />
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md border border-success-200 bg-success-50 px-2 py-0.5 text-xs font-medium text-success-600">
          <CheckIcon width={12} height={12} />
          {connection.status === 'connected' ? 'Connected' : connection.status}
        </span>
      </div>

      {note && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {connection.accessMode === 'web' && (
          <button
            type="button"
            onClick={onRun}
            className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500"
          >
            Run task
          </button>
        )}
        {connection.accessMode === 'computer' && (
          <Link
            to="/computer-use"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500"
          >
            <BoltIcon width={14} height={14} />
            Run on computer
          </Link>
        )}
        {connection.accessMode === 'api' && (
          <Link
            to="/estimator"
            className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500"
          >
            Use in Estimator
          </Link>
        )}
        <button
          type="button"
          onClick={onReconnect}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
        >
          Reconnect
        </button>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={busy}
          className="rounded-lg px-3 py-2 text-sm text-ink-500 transition hover:text-danger-700 disabled:opacity-50"
        >
          {busy ? 'Removing…' : 'Disconnect'}
        </button>
      </div>
    </li>
  );
}

function ConnectModal({
  definition,
  existing,
  capabilities,
  onClose,
  onConnected,
}: {
  definition: ConnectorDefinition;
  existing?: AppConnectorConnection;
  capabilities: ConnectorCatalogResponse['capabilities'];
  onClose: () => void;
  onConnected: () => void | Promise<void>;
}) {
  const availableModes = definition.accessModes.filter((mode) => {
    if (mode === 'web') return capabilities.webAccessEnabled;
    if (mode === 'api') return capabilities.estimatorCredentialStorageAvailable;
    return true;
  });
  const fallbackModes = availableModes.length > 0 ? availableModes : definition.accessModes;

  const [accessMode, setAccessMode] = useState<ConnectorAccessMode>(
    existing?.accessMode && fallbackModes.includes(existing.accessMode)
      ? existing.accessMode
      : fallbackModes[0],
  );
  const [label, setLabel] = useState(existing?.label ?? definition.name);
  const [siteUrl, setSiteUrl] = useState(definition.siteUrl ?? '');
  const [loginUrl, setLoginUrl] = useState(definition.loginUrl ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: ConnectAppConnectorInput = {
        connectorKey: definition.key,
        accessMode,
        label: label.trim() || definition.name,
      };

      if (accessMode === 'web') {
        payload.siteUrl = siteUrl.trim();
        payload.loginUrl = loginUrl.trim() || undefined;
        payload.username = username.trim();
        payload.password = password;
      } else if (accessMode === 'api') {
        payload.apiKey = apiKey.trim() || undefined;
        payload.username = username.trim() || undefined;
        payload.password = password || undefined;
        payload.accountId = accountId.trim() || undefined;
        payload.baseUrl = siteUrl.trim() || undefined;
      }

      await api.connectAppConnector(payload);
      await onConnected();

      if (accessMode === 'computer') {
        navigate('/computer-use');
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not connect that app.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Connect ${definition.name}`} onClose={onClose}>
      <p className="text-sm text-ink-600">{definition.blurb}</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {fallbackModes.length > 1 && (
          <fieldset>
            <legend className={labelClass}>How should Atmosphere reach it?</legend>
            <div className="flex flex-wrap gap-2">
              {fallbackModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAccessMode(mode)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    accessMode === mode
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-line bg-paper-0 text-ink-700 hover:bg-paper-100'
                  }`}
                >
                  {CONNECTOR_ACCESS_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="connector-label" className={labelClass}>
            Display name
          </label>
          <input
            id="connector-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        {accessMode === 'web' && (
          <>
            <div>
              <label htmlFor="connector-site" className={labelClass}>
                Site address
              </label>
              <input
                id="connector-site"
                type="url"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://…"
                required
                className={inputClass}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="connector-user" className={labelClass}>
                  Username
                </label>
                <input
                  id="connector-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="connector-pass" className={labelClass}>
                  Password
                </label>
                <input
                  id="connector-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="connector-login" className={labelClass}>
                Sign-in page <span className="text-ink-500">(optional)</span>
              </label>
              <input
                id="connector-login"
                type="url"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-ink-500">
              The password is encrypted before it is stored and is never shown again. Everyone in
              your organization can run tasks against this site.
            </p>
          </>
        )}

        {accessMode === 'api' && (
          <>
            <div>
              <label htmlFor="connector-api-key" className={labelClass}>
                API key
              </label>
              <input
                id="connector-api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className={inputClass}
                placeholder="Paste an API key, or use username/password below"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="connector-api-user" className={labelClass}>
                  Username
                </label>
                <input
                  id="connector-api-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="connector-api-pass" className={labelClass}>
                  Password
                </label>
                <input
                  id="connector-api-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="connector-account" className={labelClass}>
                Account id <span className="text-ink-500">(optional)</span>
              </label>
              <input
                id="connector-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={inputClass}
              />
            </div>
          </>
        )}

        {accessMode === 'computer' && (
          <div className="rounded-lg border border-line bg-paper-100 px-3.5 py-3 text-sm text-ink-700">
            <p>
              Computer Use operates a paired machine. After connecting, open Computer Use, pair an
              agent if needed, and ask it to work in{' '}
              <span className="font-medium text-ink-900">
                {definition.computerAppHint ?? definition.name}
              </span>
              .
            </p>
            {definition.taskTemplates[0] && (
              <p className="mt-2 text-ink-600">
                Suggested first task: {definition.taskTemplates[0].label}.
              </p>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
          >
            {saving && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            {saving ? 'Connecting…' : existing ? 'Save connection' : 'Connect'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function RunModal({
  connection,
  onClose,
}: {
  connection: AppConnectorConnection;
  onClose: () => void;
}) {
  const templates = connection.definition?.taskTemplates ?? [];
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { run } = await api.startConnectorRun(connection.id, {
        templateId: templateId || undefined,
        instruction: instruction.trim() || undefined,
      });
      setStartedRunId(run.id);
    } catch (err) {
      setError(errorMessage(err, 'Could not start that task.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Run a task in ${connection.label}`} onClose={onClose}>
      {startedRunId ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-700">
            Task queued. The browser agent is signing in and working through the steps — follow
            progress on Web Access.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate('/web-access')}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500"
            >
              Open Web Access
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {templates.length > 0 && (
            <div>
              <label htmlFor="run-template" className={labelClass}>
                Suggested task
              </label>
              <select
                id="run-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className={inputClass}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label} ({template.kind})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="run-instruction" className={labelClass}>
              Extra context <span className="text-ink-500">(optional)</span>
            </label>
            <textarea
              id="run-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="Claim number, insured name, what to change…"
              className={inputClass}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
            >
              {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
              {busy ? 'Starting…' : 'Start task'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper-0 p-5 shadow-lift sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-ink-500 transition hover:bg-paper-100 hover:text-ink-800"
          >
            Close
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
