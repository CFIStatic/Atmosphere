import { useState } from 'react';
import { api } from '../../lib/api';
import { downloadBlob } from '../../lib/downloadBlob';

/**
 * Download the insurer/GC/homeowner PDF proof pack for this job file
 * (optional single work date).
 */
export function DownloadProofPackButton({
  jobId,
  workDate,
  label = 'Download report',
}: {
  jobId: string;
  workDate?: string | null;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.jobProofPackPdf(jobId, workDate ?? undefined);
      downloadBlob(filename, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the report.');
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
        data-testid="download-proof-pack"
        className="rounded-lg border border-line bg-ink-900 px-2.5 py-1 text-[11px] font-semibold text-paper-0 transition hover:bg-ink-800 disabled:opacity-50"
      >
        {busy ? 'Preparing PDF…' : label}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
