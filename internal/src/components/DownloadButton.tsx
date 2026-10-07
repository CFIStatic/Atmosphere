import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportFilename, type ExportSheet } from '../lib/excel';

/**
 * The one Download control on every table and chart. `sheets` is called on
 * click, so it can fetch every row (not just the page on screen) and always
 * reflects the filters in effect at that moment.
 */
export function DownloadButton({
  table,
  label,
  sheets,
  disabled,
}: {
  /** File slug: atmosphere-<table>-YYYY-MM-DD.xlsx */
  table: string;
  /** What is being downloaded, for screen readers: "monthly detail". */
  label: string;
  sheets: () => ExportSheet[] | Promise<ExportSheet[]>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const [data, writer] = await Promise.all([Promise.resolve(sheets()), import('../lib/excelWriter')]);
      writer.saveWorkbook(exportFilename(table), data);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not build the Excel file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-[11.5px] text-danger-600">
          {error}
        </span>
      )}
      <button
        type="button"
        className="btn-quiet"
        onClick={() => void run()}
        disabled={disabled || busy}
        aria-label={`Download ${label} as Excel`}
        title={`Download ${label} as Excel (.xlsx)`}
        data-testid="download-xlsx"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>{busy ? 'Preparing…' : 'Download'}</span>
      </button>
    </span>
  );
}
