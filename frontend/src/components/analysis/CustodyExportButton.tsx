import { useState } from 'react';
import { api, type ClipCustodyExport, type JobCustodyExport } from '../../lib/api';
import { downloadJson } from '../../lib/downloadJson';

export function CustodyExportButton({
  jobId,
  proofId,
  label = 'Export custody JSON',
}: {
  jobId: string;
  proofId?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (proofId) {
        const record: ClipCustodyExport = await api.evidenceCustodyExport(jobId, proofId);
        downloadJson(`custody-${record.clip.id}.json`, record);
      } else {
        const record: JobCustodyExport = await api.jobCustodyExport(jobId);
        downloadJson(`custody-job-${record.job.number ?? record.job.id}.json`, record);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export custody.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
      >
        {busy ? 'Exporting…' : label}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
