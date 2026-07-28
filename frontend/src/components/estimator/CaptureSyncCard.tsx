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
 * Capture apps — pull MICA Dash and Outlook drying reports into the estimate.
 *
 * Crews already document the dry-out in those tools. This card syncs them so
 * the estimate updates itself when new visits land, instead of waiting for
 * someone to retype numbers.
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
  /** Sources to seed the job snapshot when syncing before a save. */
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
  const [sources, setSources] = useState<CaptureSourceKind[]>(['mica_dash', 'outlook']);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importKind, setImportKind] = useState<CaptureSourceKind>('mica_dash');

  useEffect(() => {
    let cancelled = false;
    api
      .captureStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function sync() {
    if (!jobId) {
      setError('Build and save an estimate first so capture sync has a job to update.');
      return;
    }
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.captureSync(jobId, {
        sources,
        claimNumber,
        autoRebuild: true,
        save: true,
        ...baseline,
      });
      onSynced(result);
      setNotice(summarize(result));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Capture sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function importFile(file: File) {
    if (!jobId) {
      setError('Build and save an estimate first so an import has a job to update.');
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

  function toggle(kind: CaptureSourceKind) {
    setSources((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">Capture apps</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Pull drying visits from MICA Dash and Outlook. New reports modify the estimate
            automatically — equipment days, dry rooms, under-equipment flags.
          </p>
        </div>
        {status && (
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            {status.mode}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {([
          ['mica_dash', 'MICA Dash'],
          ['outlook', 'Outlook reports'],
        ] as const).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            onClick={() => toggle(kind)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              sources.includes(kind)
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-200'
                : 'border-white/10 text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {status && (
        <p className="mt-2 text-[11px] text-gray-600">
          {status.note}
          {status.mode === 'live' &&
            ` · MICA ${status.configured.micaDash ? 'ready' : 'not configured'} · Outlook ${
              status.configured.outlook ? 'ready' : 'not configured'
            }`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing || busy || !jobId || sources.length === 0}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
        >
          {syncing && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          {syncing ? 'Syncing…' : 'Sync & update estimate'}
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
          Choose file
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
        <p className="mt-2 text-xs text-amber-300">
          Save the estimate once — then capture sync can update it on its own when Dash or Outlook
          land new visits.
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
    parts.push(
      result.saved ? 'estimate saved' : 'estimate rebuilt',
    );
    if (result.estimate.equipmentPlan) {
      parts.push(
        `plan ${result.estimate.equipmentPlan.airMoversRequired} movers / ${result.estimate.equipmentPlan.dehu.unitsRequired} dehu`,
      );
    }
  }
  return parts.join(' · ');
}
