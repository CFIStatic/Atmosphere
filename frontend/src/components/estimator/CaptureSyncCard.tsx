import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type CaptureSourceKind,
  type CaptureStatus,
  type CaptureSyncResult,
  type PhotoManifestEntry,
} from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Capture agent status.
 *
 * On an agent platform, MICA Dash and Outlook update estimates automatically.
 * This card shows whether the agent is alive and offers a rare manual nudge /
 * file import — not the primary workflow.
 */

export function CaptureSyncCard({
  jobId,
  claimNumber,
  baseline,
  onSynced,
  busy,
}: {
  jobId?: string | null;
  claimNumber?: string;
  baseline?: {
    docusketch?: unknown;
    mica?: unknown;
    photos?: PhotoManifestEntry[];
    notes?: string;
  };
  onSynced: (result: CaptureSyncResult) => void;
  busy?: boolean;
}) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importKind, setImportKind] = useState<CaptureSourceKind>('mica_dash');

  async function refreshStatus() {
    try {
      const next = await api.captureStatus();
      setStatus(next);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 60_000);
    return () => window.clearInterval(id);
  }, []);

  async function runAgent() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.runCaptureAgent({
        jobId: jobId ?? undefined,
        claimNumber,
        ...baseline,
      });
      if ('result' in response && response.result) {
        onSynced(response.result);
        setNotice(summarize(response.result));
      } else if ('pass' in response && response.pass) {
        setNotice(
          `Agent pass: ${response.pass.visitsImported} visit(s) imported, ${response.pass.jobsUpdated} estimate(s) updated.`,
        );
        if (jobId) {
          // Refresh this job via a targeted sync so the open estimate updates.
          const result = await api.captureSync(jobId, {
            claimNumber,
            autoRebuild: true,
            save: true,
            ...baseline,
          });
          onSynced(result);
        }
      }
      await refreshStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Capture agent failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function importFile(file: File) {
    if (!jobId) {
      setError('Save an estimate first so the agent has a job to update.');
      return;
    }
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      let payload: unknown = text;
      if (importKind === 'mica_dash' || file.name.endsWith('.json')) {
        payload = JSON.parse(text);
      } else {
        payload = {
          subject: file.name,
          body: text,
          receivedAt: new Date(file.lastModified).toISOString(),
          claimNumber,
        };
      }
      const result = await api.captureImport(jobId, {
        source: importKind,
        payload,
        claimNumber,
        autoRebuild: true,
        save: true,
        ...baseline,
      });
      onSynced(result);
      setNotice(summarize(result));
      await refreshStatus();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof SyntaxError
            ? 'That file is not valid JSON.'
            : 'Could not import the capture file.',
      );
    } finally {
      setSyncing(false);
    }
  }

  const agent = status?.agent;
  const last = agent?.lastPass;

  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">Capture agent</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Watches MICA Dash and Outlook automatically. When a drying report lands, the estimate
            updates itself — no sync click required.
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] uppercase tracking-wide ${
            agent?.enabled
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-white/5 text-gray-400'
          }`}
        >
          {agent?.enabled ? 'automatic' : 'disabled'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-gray-600">Interval</dt>
          <dd className="text-gray-300">
            {agent ? `every ${agent.intervalMinutes}m` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Last run</dt>
          <dd className="text-gray-300">
            {agent?.lastRunAt ? formatWhen(agent.lastRunAt) : 'waiting for first pass'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Last visits</dt>
          <dd className="text-gray-300">{last ? last.visitsImported : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Estimates updated</dt>
          <dd className="text-gray-300">{last ? last.jobsUpdated : '—'}</dd>
        </div>
      </dl>

      {status && (
        <p className="mt-2 text-[11px] text-gray-600">
          Sources: {(agent?.sources ?? ['mica_dash', 'outlook']).join(' · ')} · {status.mode}
          {status.mode === 'live' &&
            ` · MICA ${status.configured.micaDash ? 'ready' : 'not configured'} · Outlook ${
              status.configured.outlook ? 'ready' : 'not configured'
            }`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runAgent()}
          disabled={syncing || busy}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-xs text-gray-200 transition hover:bg-ink-600 disabled:opacity-50"
        >
          {syncing && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          {syncing ? 'Agent running…' : 'Run agent now'}
        </button>

        <select
          value={importKind}
          onChange={(e) => setImportKind(e.target.value as CaptureSourceKind)}
          className="rounded-lg border border-white/10 bg-ink-900 px-2 py-2 text-xs text-gray-300 outline-none"
        >
          <option value="mica_dash">Import MICA JSON</option>
          <option value="outlook">Import Outlook mail</option>
        </select>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={syncing || busy || !jobId}
          className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-xs text-gray-200 transition hover:bg-ink-600 disabled:opacity-50"
        >
          Push file to agent
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={importKind === 'mica_dash' ? 'application/json,.json' : '.txt,.eml,.html,.json'}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {!jobId && (
        <p className="mt-2 text-xs text-gray-500">
          Save an estimate once. After that the agent keeps it current as capture apps report.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {notice && !error && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
    </div>
  );
}

function summarize(result: CaptureSyncResult): string {
  const parts = [
    `Imported ${result.reportsImported} new visit${result.reportsImported === 1 ? '' : 's'}`,
  ];
  if (result.reportsSkipped) parts.push(`skipped ${result.reportsSkipped} already on file`);
  if (result.estimate) {
    parts.push(result.saved ? 'estimate saved' : 'estimate rebuilt');
    if (result.estimate.equipmentPlan) {
      parts.push(
        `plan ${result.estimate.equipmentPlan.airMoversRequired} movers / ${result.estimate.equipmentPlan.dehu.unitsRequired} dehu`,
      );
    }
  }
  return parts.join(' · ');
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
