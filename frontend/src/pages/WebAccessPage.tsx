import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  type Verification,
  type WebConnection,
  type WebRun,
  type WebRunKind,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { VerificationPanel } from '../components/VerificationPanel';
import { SpinnerIcon, CheckIcon } from '../components/icons';

/**
 * Web Access — the organization's connected websites, and the tasks the AI
 * performs in them.
 *
 * Two things happen on this page: connecting a site (once, by someone who has
 * the login), and running a task against it (often, by anyone on the team).
 * A run is asynchronous — a browser session takes minutes — so starting one
 * hands back a run to poll rather than a result to display.
 */

const inputClass =
  'w-full rounded-lg glass-card px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-700';

const STATUS_STYLES: Record<WebConnection['status'], string> = {
  verified: 'border-success-200 bg-success-50 text-success-600',
  failed: 'border-danger-200 bg-danger-50 text-danger-700',
  unverified: 'border-line bg-paper-0 text-ink-700',
};

const STATUS_LABELS: Record<WebConnection['status'], string> = {
  verified: 'Sign-in verified',
  failed: 'Sign-in failed',
  unverified: 'Not tested',
};

const RUN_STATUS_STYLES: Record<WebRun['status'], string> = {
  queued: 'border-line bg-paper-0 text-ink-700',
  running: 'border-brand-200 bg-brand-500/10 text-brand-700',
  succeeded: 'border-success-200 bg-success-50 text-success-600',
  failed: 'border-danger-200 bg-danger-50 text-danger-700',
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** The form for connecting a new site. */
function ConnectForm({ onConnected }: { onConnected: (connection: WebConnection) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLabel('');
    setSiteUrl('');
    setLoginUrl('');
    setUsername('');
    setPassword('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { connection } = await api.createWebConnection({
        label: label.trim(),
        siteUrl: siteUrl.trim(),
        loginUrl: loginUrl.trim() || undefined,
        username: username.trim(),
        password,
      });
      onConnected(connection);
      reset();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not save that connection.'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500"
      >
        Connect a site
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl glass-card p-5"
    >
      <h3 className="text-base font-semibold text-ink-900">Connect a site</h3>
      <p className="mt-1 text-sm text-ink-600">
        Everyone in your organization can run tasks against this site. The password is
        encrypted before it is stored and is never shown again.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="label" className={labelClass}>
            Name
          </label>
          <input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme Carrier Portal"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="siteUrl" className={labelClass}>
            Site address
          </label>
          <input
            id="siteUrl"
            type="url"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://portal.example.com"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="username" className={labelClass}>
            Username
          </label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="loginUrl" className={labelClass}>
            Sign-in page <span className="text-ink-500">(optional)</span>
          </label>
          <input
            id="loginUrl"
            type="url"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            placeholder="https://portal.example.com/login"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-ink-500">
            Only needed when the sign-in form is not on the site's landing page.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
        >
          {saving && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          {saving ? 'Saving…' : 'Save connection'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg glass-card px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One connected site, with its test and remove controls. */
function ConnectionRow({
  connection,
  onChanged,
  onRemoved,
}: {
  connection: WebConnection;
  onChanged: (connection: WebConnection) => void;
  onRemoved: (id: string) => void;
}) {
  const [busy, setBusy] = useState<'verify' | 'delete' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function verify() {
    setBusy('verify');
    setNote(null);
    try {
      const result = await api.verifyWebConnection(connection.id);
      setNote(result.ok ? 'Signed in successfully.' : (result.reason ?? 'Sign-in failed.'));
      onChanged({
        ...connection,
        status: result.ok ? 'verified' : 'failed',
        lastVerifiedAt: result.ok ? new Date().toISOString() : connection.lastVerifiedAt,
        lastError: result.ok ? null : (result.reason ?? null),
      });
    } catch (err) {
      setNote(errorMessage(err, 'Could not test this connection.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api.deleteWebConnection(connection.id);
      onRemoved(connection.id);
    } catch (err) {
      setNote(errorMessage(err, 'Could not remove this connection.'));
      setBusy(null);
    }
  }

  return (
    <li className="bg-paper-0 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">{connection.label}</p>
          <p className="truncate text-xs text-ink-500">
            {connection.siteUrl} · {connection.username}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[connection.status]}`}
          >
            {STATUS_LABELS[connection.status]}
          </span>
          <button
            onClick={verify}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg glass-card px-3 py-1.5 text-xs font-medium text-ink-800 transition hover:bg-paper-100 disabled:opacity-60"
          >
            {busy === 'verify' && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            Test sign-in
          </button>
          <button
            onClick={remove}
            disabled={busy !== null}
            className="rounded-lg glass-card px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-danger-50 hover:text-danger-700 disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      </div>

      {(note ?? connection.lastError) && (
        <p className="mt-2 text-xs text-ink-600">{note ?? connection.lastError}</p>
      )}
    </li>
  );
}

/** The result of a finished run: its summary, records, and step trace. */
function RunDetail({ run }: { run: WebRun }) {
  const [showSteps, setShowSteps] = useState(false);
  const records = run.result?.records ?? [];

  return (
    <div className="mt-3 space-y-3">
      {run.result?.summary && <p className="text-sm text-ink-700">{run.result.summary}</p>}
      {run.error && !run.result?.summary && <p className="text-sm text-danger-700">{run.error}</p>}

      {records.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <pre className="max-h-72 overflow-auto bg-paper-50 p-3 text-xs text-ink-700">
            {JSON.stringify(records, null, 2)}
          </pre>
        </div>
      )}

      {run.steps.length > 0 && (
        <div>
          <button
            onClick={() => setShowSteps((v) => !v)}
            className="text-xs font-medium text-brand-600 transition hover:text-brand-700"
          >
            {showSteps ? 'Hide' : 'Show'} the {run.steps.length} steps it took
          </button>
          {showSteps && (
            <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
              {run.steps.map((step) => (
                <li key={step.index} className="text-xs text-ink-600">
                  <span className="font-mono text-ink-500">{step.action}</span> — {step.detail}
                  {step.error && <span className="text-danger-700"> ({step.error})</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function WebAccessPage() {
  const [connections, setConnections] = useState<WebConnection[] | null>(null);
  const [runs, setRuns] = useState<WebRun[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // Latest check per run. Fetched for the whole page in one request rather than
  // one per run, since the list is already bounded to the recent runs.
  const [verifications, setVerifications] = useState<Map<string, Verification>>(new Map());

  const [connectionId, setConnectionId] = useState('');
  const [kind, setKind] = useState<WebRunKind>('pull');
  const [instruction, setInstruction] = useState('');
  const [dataText, setDataText] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Runs outlive the request that starts them, so the page polls whichever
  // runs are still in flight and stops as soon as none are.
  const pollTimer = useRef<number | null>(null);

  /**
   * Reloads the checks. The list comes back newest first, so keeping the first
   * entry seen for each run leaves the map holding the most recent pass.
   */
  const refreshVerifications = useCallback(async () => {
    try {
      const { verifications } = await api.getVerifications();
      setVerifications(() => {
        const next = new Map<string, Verification>();
        for (const verification of verifications) {
          if (!next.has(verification.runId)) next.set(verification.runId, verification);
        }
        return next;
      });
    } catch {
      // The verifier may be switched off on this server; the page still works.
    }
  }, []);

  useEffect(() => {
    api
      .webAccessStatus()
      .then(({ enabled }) => setEnabled(enabled))
      .catch(() => setEnabled(false));

    api
      .getWebConnections()
      .then(({ connections }) => {
        setConnections(connections);
        setConnectionId((current) => current || (connections[0]?.id ?? ''));
      })
      .catch(() => setConnections([]));

    api
      .getWebRuns()
      .then(({ runs }) => setRuns(runs))
      .catch(() => setRuns([]));

    void refreshVerifications();
  }, [refreshVerifications]);

  const refreshActiveRuns = useCallback(async () => {
    const active = runs.filter((run) => run.status === 'queued' || run.status === 'running');

    if (active.length > 0) {
      const updated = await Promise.all(
        active.map((run) =>
          api
            .getWebRun(run.id)
            .then(({ run }) => run)
            .catch(() => null),
        ),
      );

      setRuns((current) =>
        current.map((run) => updated.find((fresh) => fresh?.id === run.id) ?? run),
      );
    }

    await refreshVerifications();
  }, [runs, refreshVerifications]);

  useEffect(() => {
    const hasActiveRun = runs.some((run) => run.status === 'queued' || run.status === 'running');
    // A check is queued the moment a run reports success, so the page keeps
    // polling past the run's own finish to watch the verifier catch up.
    const hasActiveCheck = [...verifications.values()].some(
      (verification) => verification.status === 'queued' || verification.status === 'running',
    );
    // The check is queued just after the run row is written, so for a moment a
    // finished run has no check to poll for and the two conditions above are
    // both false. Stopping there would leave a verified run showing as never
    // checked until the page is reloaded. Keep watching briefly after a run
    // lands, bounded so old runs on a server with the verifier switched off do
    // not poll forever.
    const settling = runs.some(
      (run) =>
        run.status === 'succeeded' &&
        !verifications.has(run.id) &&
        run.finishedAt !== null &&
        Date.now() - new Date(run.finishedAt).getTime() < 60_000,
    );

    if (!hasActiveRun && !hasActiveCheck && !settling) {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }
    pollTimer.current = window.setInterval(() => void refreshActiveRuns(), 3000);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [runs, verifications, refreshActiveRuns]);

  async function startRun(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // The data box is free-form JSON; catching the parse here gives a better
    // message than the server's schema error would.
    let data: unknown;
    if (kind === 'push' && dataText.trim()) {
      try {
        data = JSON.parse(dataText);
      } catch {
        setError('The data to enter is not valid JSON.');
        return;
      }
    }

    setStarting(true);
    try {
      const { run } = await api.startWebRun({
        connectionId,
        kind,
        instruction: instruction.trim(),
        data,
      });
      setRuns((current) => [run, ...current]);
      setInstruction('');
      setDataText('');
    } catch (err) {
      setError(errorMessage(err, 'Could not start that run.'));
    } finally {
      setStarting(false);
    }
  }

  const connectionName = (id: string) =>
    connections?.find((connection) => connection.id === id)?.label ?? 'Removed connection';

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 sm:px-10">
        <Logo />
        <Link
          to="/dashboard"
          className="rounded-lg glass-card px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
        >
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-600">Web Access</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-900">
            Let Atmosphere work in your other systems
          </h1>
          <p className="mt-2 max-w-2xl text-ink-600">
            Connect a carrier portal, supplier site, or vendor dashboard once. From then on you
            can ask Atmosphere to sign in, pull data back out, or enter data for you — and read
            back every step it took.
          </p>

          {enabled === false && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-600"
            >
              Web Access is not configured on this server yet. An administrator needs to set
              <code className="mx-1 rounded bg-paper-0 px-1.5 py-0.5 font-mono text-xs">WEB_ACCESS_KEY</code>
              and
              <code className="mx-1 rounded bg-paper-0 px-1.5 py-0.5 font-mono text-xs">ANTHROPIC_API_KEY</code>
              before connections can be used.
            </div>
          )}

          {/* Connected sites */}
          <section className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink-900">Connected sites</h2>
              {connections !== null && connections.length > 0 && (
                <ConnectForm
                  onConnected={(connection) => {
                    setConnections((current) => [connection, ...(current ?? [])]);
                    setConnectionId((current) => current || connection.id);
                  }}
                />
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              {connections === null ? (
                <div className="grid place-items-center py-10 text-brand-600">
                  <SpinnerIcon className="animate-spin" width={22} height={22} />
                </div>
              ) : connections.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-ink-600">No sites connected yet.</p>
                  <div className="mt-4 flex justify-center">
                    <ConnectForm
                      onConnected={(connection) => {
                        setConnections((current) => [connection, ...(current ?? [])]);
                        setConnectionId((current) => current || connection.id);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {connections.map((connection) => (
                    <ConnectionRow
                      key={connection.id}
                      connection={connection}
                      onChanged={(updated) =>
                        setConnections(
                          (current) =>
                            current?.map((c) => (c.id === updated.id ? updated : c)) ?? null,
                        )
                      }
                      onRemoved={(id) =>
                        setConnections((current) => current?.filter((c) => c.id !== id) ?? null)
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Ask for a task */}
          {connections !== null && connections.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink-900">Run a task</h2>
              <form
                onSubmit={startRun}
                className="mt-4 rounded-xl glass-card p-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="connection" className={labelClass}>
                      Site
                    </label>
                    <select
                      id="connection"
                      value={connectionId}
                      onChange={(e) => setConnectionId(e.target.value)}
                      className={inputClass}
                    >
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="kind" className={labelClass}>
                      What should it do?
                    </label>
                    <select
                      id="kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as WebRunKind)}
                      className={inputClass}
                    >
                      <option value="pull">Pull data out</option>
                      <option value="push">Enter data in</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="instruction" className={labelClass}>
                    Task
                  </label>
                  <textarea
                    id="instruction"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    rows={3}
                    required
                    placeholder={
                      kind === 'pull'
                        ? 'List every open claim with its number, insured name, and amount.'
                        : 'Add an inspection note to claim C-1002 and mark it in progress.'
                    }
                    className={inputClass}
                  />
                </div>

                {kind === 'push' && (
                  <div className="mt-4">
                    <label htmlFor="data" className={labelClass}>
                      Data to enter <span className="text-ink-500">(optional, JSON)</span>
                    </label>
                    <textarea
                      id="data"
                      value={dataText}
                      onChange={(e) => setDataText(e.target.value)}
                      rows={4}
                      placeholder={'[{ "claim": "C-1002", "note": "Inspection completed" }]'}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={starting || !connectionId || enabled === false}
                  className="mt-5 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
                >
                  {starting && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                  {starting ? 'Starting…' : 'Start run'}
                </button>
              </form>
            </section>
          )}

          {/* History */}
          {runs.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ink-900">Recent runs</h2>
              <ul className="mt-4 space-y-3">
                {runs.map((run) => {
                  const inFlight = run.status === 'queued' || run.status === 'running';
                  return (
                    <li
                      key={run.id}
                      className="rounded-xl glass-card px-5 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900">{run.instruction}</p>
                          <p className="text-xs text-ink-500">
                            {connectionName(run.connectionId)} ·{' '}
                            {run.kind === 'pull' ? 'Pulling data' : 'Entering data'}
                          </p>
                        </div>
                        <span
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${RUN_STATUS_STYLES[run.status]}`}
                        >
                          {inFlight && <SpinnerIcon className="animate-spin" width={12} height={12} />}
                          {run.status === 'succeeded' && <CheckIcon width={12} height={12} />}
                          {run.status === 'queued'
                            ? 'Queued'
                            : run.status === 'running'
                              ? 'Working'
                              : run.status === 'succeeded'
                                ? 'Done'
                                : 'Failed'}
                        </span>
                      </div>
                      {!inFlight && <RunDetail run={run} />}

                      {/* A run that reported success is a claim, not a result.
                          The check below is what turns it into one. */}
                      {run.status === 'succeeded' && (
                        <VerificationPanel
                          runId={run.id}
                          verification={verifications.get(run.id) ?? null}
                          onStarted={() => void refreshVerifications()}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
