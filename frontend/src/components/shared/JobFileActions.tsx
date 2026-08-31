import { useEffect, useState, type FormEvent } from 'react';
import { api, type SharedJobSummary } from '../../lib/api';
import { jobFileDeleteNameMatches, suggestedDuplicateTitle } from '../../lib/jobFileCopy';
import { SpinnerIcon } from '../icons';

/**
 * Rename, duplicate, or delete the open job file.
 *
 * A duplicate is a new folder with the same site, brief, and scope. Clips
 * and invites stay on the original — those are the record, not a template.
 * Delete requires typing the file name. That cannot be undone from here.
 */

type Mode = 'rename' | 'duplicate' | 'delete' | null;

export function JobFileActions({
  jobId,
  title,
  onRenamed,
  onDuplicated,
  onDeleted,
  onShare,
}: {
  jobId: string;
  title: string;
  onRenamed: (title: string) => void;
  onDuplicated: (created: { jobId: string; title: string; summary: SharedJobSummary }) => void;
  onDeleted?: () => void;
  onShare: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = mode === 'delete';
  const nameMatches = jobFileDeleteNameMatches(title, draft);

  useEffect(() => {
    if (mode === 'rename') setDraft(title);
    if (mode === 'duplicate') setDraft(suggestedDuplicateTitle(title));
    if (mode === 'delete') setDraft('');
    setError(null);
  }, [mode, title]);

  function close() {
    if (busy) return;
    setMode(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (deleting) {
      if (!nameMatches) {
        setError('Type the file name exactly as it appears on the dashboard.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await api.deleteJobFile(jobId, title);
        setMode(null);
        onDeleted?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete that job file.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const next = draft.trim();
    if (next.length < 2) {
      setError('Enter a name for this job file.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'rename') {
        const res = await api.renameJobFile(jobId, next);
        onRenamed(res.job.title);
      } else if (mode === 'duplicate') {
        const res = await api.duplicateJobFile(jobId, next);
        onDuplicated({
          jobId: res.job.id,
          title: res.job.title,
          summary: res.jobFile,
        });
      }
      setMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that job file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('rename')}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink-700 transition hover:bg-paper-50"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setMode('duplicate')}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink-700 transition hover:bg-paper-50"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onShare}
          className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 transition hover:bg-ink-800"
        >
          Share
        </button>
        <button
          type="button"
          onClick={() => setMode('delete')}
          className="rounded-lg border border-danger-200 px-3.5 py-2 text-sm font-semibold text-danger-600 transition hover:bg-danger-50"
        >
          Delete
        </button>
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <form
            onSubmit={(event) => void submit(event)}
            className="w-full max-w-md rounded-xl border border-line bg-paper-0 p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-file-action-title"
          >
            <h2 id="job-file-action-title" className="text-base font-semibold text-ink-900">
              {mode === 'rename'
                ? 'Rename this job file'
                : mode === 'duplicate'
                  ? 'Duplicate this job file'
                  : 'Delete this job file'}
            </h2>
            {deleting ? (
              <>
                <p className="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                  This cannot be undone. The file leaves the dashboard. Footage and the record stay
                  in the vault, but you cannot open them from here again.
                </p>
                <p className="mt-3 text-sm text-ink-600">
                  Type <span className="font-semibold text-ink-900">{title}</span> to confirm you
                  want to delete this job file.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-600">
                {mode === 'rename'
                  ? 'The name is what shows on the dashboard and in the library.'
                  : 'Creates a new job file with the same site, brief, and scope. Footage and people stay on the original.'}
              </p>
            )}
            <label className="mt-4 block text-xs font-medium text-ink-600">
              {deleting ? 'File name' : 'Name'}
              <input
                className="glass-field mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-ink-900"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                required={!deleting}
                minLength={deleting ? undefined : 2}
                maxLength={200}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={deleting ? title : undefined}
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-600 hover:text-ink-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || (deleting && !nameMatches)}
                className={
                  deleting
                    ? 'inline-flex items-center gap-2 rounded-lg bg-danger-600 px-3.5 py-2 text-sm font-semibold text-paper-0 hover:bg-danger-700 disabled:opacity-60'
                    : 'inline-flex items-center gap-2 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 hover:bg-ink-800 disabled:opacity-60'
                }
              >
                {busy ? <SpinnerIcon className="animate-spin" width={14} /> : null}
                {mode === 'rename' ? 'Save name' : mode === 'duplicate' ? 'Create copy' : 'Delete permanently'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
