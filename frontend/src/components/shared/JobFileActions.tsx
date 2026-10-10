import { useEffect, useState, type FormEvent } from 'react';
import { api, type SharedJobSummary } from '../../lib/api';
import { suggestedDuplicateTitle } from '../../lib/jobFileCopy';
import { SpinnerIcon } from '../icons';
import { GlassModal } from './GlassModal';

/**
 * Rename or duplicate the open job file.
 *
 * A duplicate is a new folder with the same site, brief, and scope. Clips
 * and invites stay on the original — those are the record, not a template.
 * Product UI never deletes job files or evidence.
 */

type Mode = 'rename' | 'duplicate' | null;

function jobFileActionError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message.trim() : '';
  if (!raw || /^(forbidden|unauthorized|access denied|not allowed|blocked)$/i.test(raw)) {
    return fallback;
  }
  return raw;
}

export function JobFileActions({
  jobId,
  title,
  onRenamed,
  onDuplicated,
  onShare,
  compact = false,
}: {
  jobId: string;
  title: string;
  onRenamed: (title: string) => void;
  onDuplicated: (created: { jobId: string; title: string; summary: SharedJobSummary }) => void;
  onShare: () => void;
  /** Smaller buttons for the top bar. */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'rename') setDraft(title);
    if (mode === 'duplicate') setDraft(suggestedDuplicateTitle(title));
    setError(null);
  }, [mode, title]);

  function close() {
    if (busy) return;
    setMode(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      setError(jobFileActionError(err, 'Could not update that job file.'));
    } finally {
      setBusy(false);
    }
  }

  const pad = compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm';

  return (
    <>
      <div className={`flex flex-wrap items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <button
          type="button"
          onClick={() => setMode('rename')}
          className={`rounded-lg border border-line font-semibold text-ink-700 transition hover:bg-paper-50 ${pad}`}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setMode('duplicate')}
          className={`rounded-lg border border-line font-semibold text-ink-700 transition hover:bg-paper-50 ${pad}`}
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onShare}
          className={`rounded-lg bg-ink-900 font-semibold text-paper-0 transition hover:bg-ink-800 ${pad}`}
        >
          Share
        </button>
      </div>

      {mode && (
        <GlassModal
          title={mode === 'rename' ? 'Rename this job file' : 'Duplicate this job file'}
          description={
            mode === 'rename'
              ? 'The name is what shows on the dashboard and in the library.'
              : 'Creates a full copy: videos, transcripts, Chat, files, brief, scope and people. Share links are not copied, so invite people to the copy again.'
          }
          onClose={close}
          closeDisabled={busy}
        >
          <form onSubmit={(event) => void submit(event)}>
            <label className="block text-xs font-medium text-ink-700">
              Name
              <input
                className="glass-field mt-1.5 h-10 w-full rounded-lg px-3 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500/25"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                required
                minLength={2}
                maxLength={200}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger-600">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="h-9 rounded-lg px-3.5 text-sm font-medium text-ink-600 transition hover:bg-ink-900/5 hover:text-ink-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-sm transition hover:bg-ink-800 disabled:opacity-60"
              >
                {busy ? <SpinnerIcon className="animate-spin" width={14} /> : null}
                {mode === 'rename' ? 'Save name' : 'Create copy'}
              </button>
            </div>
          </form>
        </GlassModal>
      )}
    </>
  );
}
