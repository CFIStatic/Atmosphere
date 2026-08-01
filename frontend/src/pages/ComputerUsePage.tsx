import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  PLATFORM_LABELS,
  QUALITY_LABELS,
  api,
  type CaptureQuality,
  type ComputerAgent,
  type ComputerRun,
  type ComputerStatus,
  type RunEvent,
  type RunStreamMessage,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { CheckIcon, SpinnerIcon } from '../components/icons';

/**
 * The Computer Use console.
 *
 * Three things have to be true before a task can run — a key is connected, a
 * computer is online, and the operator has said what to do — so the page is
 * built as those three panels and tells you plainly which one is missing.
 *
 * While a run is going, the screenshot Claude just looked at is the primary
 * thing on screen. Watching the actual screen is what makes an agent that
 * controls a real machine trustworthy rather than alarming, and it is how an
 * operator knows when to hit Stop.
 */

type TranscriptItem =
  | { kind: 'text'; id: number; text: string }
  | { kind: 'thinking'; id: number; text: string }
  | { kind: 'action'; id: number; summary: string; ok: boolean; error?: string }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'status'; id: number; message: string };

export function ComputerUsePage() {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  // Both start empty and are filled from the server's defaults on first load,
  // so a deployment that prefers a cheaper model or smaller screenshots is the
  // setting an operator sees rather than something the UI quietly overrides.
  const [model, setModel] = useState<string>('');
  const [quality, setQuality] = useState<CaptureQuality | ''>('');

  const [run, setRun] = useState<ComputerRun | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenSize, setScreenSize] = useState<{ width: number; height: number } | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const nextId = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  const agents = status?.agents ?? [];
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const isRunning = run !== null && (run.status === 'starting' || run.status === 'running');

  /* ------------------------------ status load ----------------------------- */

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.computerStatus();
      setStatus(next);
      setLoadError(null);
      setModel((current) => current || next.defaults.model);
      setQuality((current) => current || next.defaults.quality);
      setSelectedAgentId((current) => {
        if (current && next.agents.some((a) => a.id === current)) return current;
        return next.agents[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load computer use.');
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    // Computers come and go as people start and stop the agent; a slow poll
    // keeps the list honest without a second socket just for presence.
    const timer = setInterval(() => void refreshStatus(), 8000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  /* --------------------------- live event stream --------------------------- */

  useEffect(() => {
    if (!run) return;
    const source = new EventSource(api.runEventsUrl(run.id), { withCredentials: true });

    source.onmessage = (message) => {
      const payload = JSON.parse(message.data) as RunStreamMessage;
      if (payload.type === 'summary') {
        setRun(payload.run);
        return;
      }
      applyEvent(payload);
    };

    // The browser retries an SSE connection on its own; there is nothing useful
    // to do on error beyond not spamming the console.
    source.onerror = () => undefined;

    return () => source.close();
    // Only the run id matters — re-subscribing on every status tick would drop
    // and rebuild the stream several times a minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  function applyEvent(event: RunEvent) {
    switch (event.type) {
      case 'screenshot':
        if (event.image) {
          setScreenshot(`data:image/png;base64,${event.image}`);
          setScreenSize({ width: event.width, height: event.height });
        }
        return;

      case 'text':
      case 'thinking':
        // Deltas arrive token by token; merging into the trailing bubble is
        // what makes it read as writing rather than as a list of fragments.
        setTranscript((items) => {
          const last = items[items.length - 1];
          if (last && last.kind === event.type) {
            const merged = { ...last, text: last.text + event.text };
            return [...items.slice(0, -1), merged];
          }
          nextId.current += 1;
          return [...items, { kind: event.type, id: nextId.current, text: event.text }];
        });
        return;

      case 'action':
        setTranscript((items) => {
          nextId.current += 1;
          return [
            ...items,
            {
              kind: 'action',
              id: nextId.current,
              summary: event.summary,
              ok: event.ok,
              error: event.error,
            },
          ];
        });
        return;

      case 'error':
        setTranscript((items) => {
          nextId.current += 1;
          return [...items, { kind: 'error', id: nextId.current, message: event.message }];
        });
        return;

      case 'status':
        if (event.status === 'running') return; // the header already says so
        setTranscript((items) => {
          nextId.current += 1;
          return [
            ...items,
            { kind: 'status', id: nextId.current, message: statusMessage(event.status, event.message) },
          ];
        });
        return;

      default:
        return;
    }
  }

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript.length]);

  /* ---------------------------- idle live preview -------------------------- */

  useEffect(() => {
    if (!selectedAgentId || isRunning) return;
    let cancelled = false;

    const grab = async () => {
      if (document.hidden) return;
      try {
        const frame = await api.getAgentScreen(selectedAgentId);
        if (cancelled) return;
        setScreenshot(`data:image/png;base64,${frame.image}`);
        setScreenSize({ width: frame.width, height: frame.height });
      } catch {
        // The computer may have gone offline between polls; the agents list
        // will catch up on its own tick.
      }
    };

    void grab();
    const timer = setInterval(() => void grab(), 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedAgentId, isRunning]);

  /* -------------------------------- actions -------------------------------- */

  async function handleStart() {
    if (!selectedAgentId || !instruction.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const { run: started } = await api.startRun({
        agentId: selectedAgentId,
        instruction: instruction.trim(),
        model: model || undefined,
        quality: quality || undefined,
      });
      setTranscript([]);
      nextId.current = 0;
      setRun(started);
      setInstruction('');
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : 'Could not start the task.');
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!run) return;
    try {
      const { run: stopped } = await api.stopRun(run.id);
      setRun(stopped);
    } catch {
      /* the stream will report the real state */
    }
  }

  const credentialConnected = status?.credential.connected ?? false;
  const canStart =
    credentialConnected && !!selectedAgent && !selectedAgent.busy && instruction.trim().length > 0 && !isRunning;

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 sm:px-10">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 sm:inline">
            Computer Use
          </span>
        </div>
        <Link
          to="/dashboard"
          className="rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
        >
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        {loadError && <Banner tone="error">{loadError}</Banner>}

        {status && !credentialConnected && (
          <ApiKeyCard onConnected={refreshStatus} />
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ---------------- main column ---------------- */}
          <section className="space-y-6">
            <ScreenPanel
              agent={selectedAgent}
              screenshot={screenshot}
              screenSize={screenSize}
              run={run}
              onStop={handleStop}
            />

            <div className="rounded-2xl border border-line bg-paper-0 p-5">
              <label htmlFor="instruction" className="text-sm font-medium text-ink-800">
                What should Claude do on {selectedAgent ? selectedAgent.name : 'this computer'}?
              </label>
              <textarea
                id="instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canStart) void handleStart();
                }}
                rows={3}
                disabled={isRunning}
                placeholder="Open the invoices folder, and tell me which files are older than 30 days."
                className="mt-2 w-full resize-y rounded-xl border border-line bg-paper-0 px-4 py-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-60"
              />

              {startError && <p className="mt-2 text-sm text-danger-700">{startError}</p>}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-500">
                  {isRunning
                    ? 'Claude is working. You can stop it at any time.'
                    : 'Claude sees a screenshot, then clicks and types on the real machine.'}
                </p>
                <button
                  onClick={() => void handleStart()}
                  disabled={!canStart || starting}
                  className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {starting && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                  {starting ? 'Starting…' : 'Start task'}
                </button>
              </div>
            </div>

            <Transcript items={transcript} run={run} endRef={transcriptEnd} />
          </section>

          {/* ---------------- side column ---------------- */}
          <aside className="space-y-6">
            <ComputersPanel
              agents={agents}
              selectedId={selectedAgentId}
              onSelect={setSelectedAgentId}
              onPaired={refreshStatus}
            />

            <SettingsPanel
              status={status}
              model={model}
              quality={quality}
              onModel={setModel}
              onQuality={setQuality}
              onCredentialChange={refreshStatus}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------- components ------------------------------- */

function Banner({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-danger-200 bg-danger-50 text-danger-700'
      : 'border-brand-200 bg-brand-50 text-brand-700';
  return <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

/** The first-run gate: nothing works until a key is connected. */
function ApiKeyCard({ onConnected }: { onConnected: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setSaving(true);
    setError(null);
    try {
      await api.connectAnthropicKey(apiKey.trim());
      setApiKey('');
      await onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 p-6">
      <h2 className="text-lg font-semibold text-ink-900">Connect your Anthropic API key</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        This is the only setup step. The key is encrypted before it is stored, is never sent back to
        this browser, and pays for the models that drive your computers. Create one at{' '}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-ink-900"
        >
          console.anthropic.com
        </a>
        .
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && apiKey.trim()) void connect();
          }}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-xl border border-line bg-paper-0 px-4 py-3 font-mono text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
        />
        <button
          onClick={() => void connect()}
          disabled={saving || apiKey.trim().length < 20}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-brand-500 disabled:opacity-40"
        >
          {saving && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          Connect
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger-700">{error}</p>}
    </section>
  );
}

function ScreenPanel({
  agent,
  screenshot,
  screenSize,
  run,
  onStop,
}: {
  agent: ComputerAgent | null;
  screenshot: string | null;
  screenSize: { width: number; height: number } | null;
  run: ComputerRun | null;
  onStop: () => void;
}) {
  const isRunning = run !== null && (run.status === 'starting' || run.status === 'running');

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              isRunning ? 'animate-pulse bg-success-600' : agent ? 'bg-brand-500' : 'bg-ink-400'
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">
              {agent ? agent.name : 'No computer selected'}
            </p>
            <p className="truncate text-xs text-ink-500">
              {agent
                ? `${PLATFORM_LABELS[agent.platform] ?? agent.platform} · ${agent.screen.width}×${agent.screen.height}` +
                  (screenSize ? ` · seen as ${screenSize.width}×${screenSize.height}` : '')
                : 'Add a computer to get started'}
            </p>
          </div>
        </div>

        {isRunning && (
          <button
            onClick={onStop}
            className="shrink-0 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2 text-sm font-semibold text-danger-700 transition hover:bg-danger-50"
          >
            Stop
          </button>
        )}
      </div>

      <div className="relative grid aspect-video place-items-center bg-paper-100">
        {screenshot ? (
          <img
            src={screenshot}
            alt={
              agent
                ? `Live screen of ${agent.name}`
                : 'Live screen of the selected computer'
            }
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="px-6 text-center text-sm text-ink-400">
            {agent
              ? 'Waiting for the first frame…'
              : 'Run the agent on a computer and it will appear here.'}
          </p>
        )}
      </div>
    </section>
  );
}

function Transcript({
  items,
  run,
  endRef,
}: {
  items: TranscriptItem[];
  run: ComputerRun | null;
  endRef: React.RefObject<HTMLDivElement>;
}) {
  if (!run && items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line bg-paper-0">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-medium text-ink-800">Activity</h2>
        {run && (
          <p className="text-xs text-ink-500">
            {run.steps} step{run.steps === 1 ? '' : 's'} ·{' '}
            {(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens
          </p>
        )}
      </div>

      <div className="max-h-[28rem] space-y-3 overflow-y-auto px-5 py-4">
        {items.map((item) => (
          <TranscriptRow key={item.id} item={item} />
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'text':
      return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{item.text}</p>;

    case 'thinking':
      return (
        <p className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm italic leading-relaxed text-ink-500">
          {item.text}
        </p>
      );

    case 'action':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              item.ok ? 'bg-brand-500' : 'bg-danger-600'
            }`}
            aria-hidden
          />
          <span className={item.ok ? 'text-ink-600' : 'text-danger-700'}>
            {item.summary}
            {item.error && <span className="text-danger-700"> — {item.error}</span>}
          </span>
        </div>
      );

    case 'error':
      return (
        <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {item.message}
        </p>
      );

    case 'status':
      return (
        <p className="flex items-center gap-2 text-sm font-medium text-success-600">
          <CheckIcon width={14} height={14} />
          {item.message}
        </p>
      );

    default:
      return null;
  }
}

function ComputersPanel({
  agents,
  selectedId,
  onSelect,
  onPaired,
}: {
  agents: ComputerAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPaired: () => Promise<void>;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  // A paired computer shows up in the list on its own; clearing the code when
  // that happens is the acknowledgement the operator is waiting for.
  const agentCount = agents.length;
  const countAtMint = useRef(agentCount);
  useEffect(() => {
    if (code && agentCount > countAtMint.current) {
      setCode(null);
      void onPaired();
    }
  }, [agentCount, code, onPaired]);

  async function mint() {
    setMinting(true);
    try {
      const result = await api.createPairingCode();
      countAtMint.current = agentCount;
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    } finally {
      setMinting(false);
    }
  }

  const command = useMemo(
    () => `npx atmosphere-agent --server ${window.location.origin} --code ${code ?? ''}`,
    [code],
  );

  return (
    <section className="rounded-2xl border border-line bg-paper-0 p-5">
      <h2 className="text-sm font-medium text-ink-800">Computers</h2>

      {agents.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">
          None connected. Add one below to let Claude work on it.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {agents.map((agent) => {
            const selected = agent.id === selectedId;
            return (
              <li key={agent.id}>
                <button
                  onClick={() => onSelect(agent.id)}
                  aria-pressed={selected}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    selected
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-line bg-paper-50 hover:bg-paper-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink-900">{agent.name}</span>
                    {agent.busy && (
                      <span className="shrink-0 rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-600">
                        busy
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-500">
                    {PLATFORM_LABELS[agent.platform] ?? agent.platform} · {agent.screen.width}×
                    {agent.screen.height}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {code ? (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs text-ink-600">
            On the computer you want to add, install Node 18+ and run:
          </p>
          <code className="mt-2 block break-all rounded-lg bg-paper-0 px-3 py-2 font-mono text-xs text-brand-700">
            {command}
          </code>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-ink-500">
              Code expires {expiresAt ? new Date(expiresAt).toLocaleTimeString() : 'shortly'}.
            </p>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(command).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs font-medium text-ink-800 transition hover:bg-paper-100"
            >
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => void mint()}
          disabled={minting}
          className="mt-4 w-full rounded-xl border border-line bg-paper-0 px-4 py-2.5 text-sm font-medium text-ink-800 transition hover:bg-paper-100 disabled:opacity-50"
        >
          {minting ? 'Generating…' : 'Add a computer'}
        </button>
      )}
    </section>
  );
}

function SettingsPanel({
  status,
  model,
  quality,
  onModel,
  onQuality,
  onCredentialChange,
}: {
  status: ComputerStatus | null;
  model: string;
  quality: CaptureQuality | '';
  onModel: (value: string) => void;
  onQuality: (value: CaptureQuality) => void;
  onCredentialChange: () => Promise<void>;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  if (!status) return null;

  const { credential } = status;

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-paper-0 p-5">
      <h2 className="text-sm font-medium text-ink-800">Settings</h2>

      <div>
        <label htmlFor="model" className="text-xs font-medium text-ink-600">
          Model
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => onModel(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none"
        >
          {status.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="quality" className="text-xs font-medium text-ink-600">
          Screenshot quality
        </label>
        <select
          id="quality"
          value={quality}
          onChange={(e) => onQuality(e.target.value as CaptureQuality)}
          className="mt-1 w-full rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none"
        >
          {(Object.keys(QUALITY_LABELS) as CaptureQuality[]).map((key) => (
            <option key={key} value={key}>
              {QUALITY_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-line pt-4">
        <p className="text-xs font-medium text-ink-600">Anthropic API key</p>
        {credential.connected ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-ink-700">
              {credential.hint}
              {credential.source === 'server' && (
                <span className="ml-2 font-sans text-[11px] text-ink-500">(server default)</span>
              )}
            </span>
            {credential.source === 'organization' && (
              <button
                onClick={() => {
                  setDisconnecting(true);
                  void api
                    .disconnectAnthropicKey()
                    .then(onCredentialChange)
                    .finally(() => setDisconnecting(false));
                }}
                disabled={disconnecting}
                className="shrink-0 text-xs font-medium text-ink-600 underline underline-offset-2 transition hover:text-danger-700 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-500">Not connected.</p>
        )}
      </div>

      <p className="border-t border-line pt-4 text-[11px] leading-relaxed text-ink-500">
        Claude controls the real machine, and a task stops automatically after{' '}
        {status.limits.maxSteps} steps or {Math.round(status.limits.runTimeoutMs / 60000)} minutes.
        Close the agent on that computer to revoke access immediately.
      </p>
    </section>
  );
}

function statusMessage(status: ComputerRun['status'], message?: string): string {
  switch (status) {
    case 'completed':
      return 'Task finished.';
    case 'stopped':
      return message ?? 'Stopped.';
    case 'failed':
      return message ?? 'The task failed.';
    default:
      return message ?? status;
  }
}
