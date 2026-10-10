import { useState } from 'react';
import {
  Clock,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquareText,
  ScanSearch,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { downloadBlob } from '../../lib/downloadBlob';

const CONTENTS: Array<{ icon: LucideIcon; title: string; detail: string }> = [
  { icon: FolderOpen, title: 'Job details', detail: 'Job number, property, claim and work type.' },
  {
    icon: Video,
    title: 'Every video and file',
    detail: 'AI title and summary, filmed and filed times, length, size, device and file digest.',
  },
  {
    icon: MessageSquareText,
    title: 'Transcripts',
    detail: 'Everything said, with speakers and timestamps.',
  },
  {
    icon: ScanSearch,
    title: 'Analysis results',
    detail: 'Checks, rooms, findings, decisions, next steps and key frames.',
  },
  { icon: Clock, title: 'Timeline', detail: 'What happened on the job, in order.' },
  {
    icon: ShieldCheck,
    title: 'Access and custody',
    detail: 'Who has access, who filed each file and every time it was opened.',
  },
];

function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Evidence report tab: one button that builds a PDF of the whole job
 * file and downloads it. The server records each download in the custody log.
 */
export function JobFileReport({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { blob, filename } = await api.jobProofPackPdf(jobId, undefined, viewerTimeZone());
      downloadBlob(filename, blob);
      setDone(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl glass-card px-5 py-8 sm:px-8 sm:py-10"
      data-job-section="evidence"
      data-testid="job-file-report"
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <FileText className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="mt-3 text-lg font-semibold text-ink-900">Evidence report</h2>
        <p className="mt-1 text-sm text-ink-500">
          One PDF with everything in this job file, ready to send to an insurer, contractor or homeowner.
        </p>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          data-testid="download-job-report"
          className="mt-6 flex min-w-[220px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          {busy ? 'Building report…' : 'Download report'}
        </button>
        {done && !busy && (
          <p role="status" className="mt-2 text-xs text-success-600">
            Downloaded {done}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>

      <ul className="mx-auto mt-8 grid max-w-3xl gap-x-6 gap-y-4 border-t border-line pt-6 sm:grid-cols-2">
        {CONTENTS.map(({ icon: Icon, title, detail }) => (
          <li key={title} className="flex gap-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink-900">{title}</p>
              <p className="text-xs text-ink-500">{detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] text-ink-400">
        Moments flagged as private in a video are left out. Each download is recorded in the job’s custody log.
      </p>
    </section>
  );
}
