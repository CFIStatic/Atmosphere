import { useState } from 'react';
import type { JobSuggestion } from '../../lib/api';
import { SparkIcon } from '../icons';

/**
 * One suggested piece of work: what, why now, and one-tap Approve. Edit lets
 * the person change what Chat will be asked before approving.
 */
export function SuggestionCard({
  suggestion,
  showJob = false,
  onApprove,
  onDismiss,
}: {
  suggestion: JobSuggestion;
  showJob?: boolean;
  onApprove: (s: JobSuggestion, prompt: string | null) => Promise<void>;
  onDismiss: (s: JobSuggestion) => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(suggestion.prompt);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'approve' | 'dismiss') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'approve') await onApprove(suggestion, editing && prompt.trim() !== suggestion.prompt ? prompt.trim() : null);
      else await onDismiss(suggestion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
      setBusy(null);
    }
  }

  return (
    <article
      className="rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-3"
      data-testid="suggestion-card"
      data-kind={suggestion.kind}
    >
      <div className="flex items-start gap-2.5">
        <SparkIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        <div className="min-w-0 flex-1">
          {showJob && suggestion.jobTitle ? (
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-500">{suggestion.jobTitle}</p>
          ) : null}
          <h3 className="text-sm font-semibold text-ink-900">{suggestion.title}</h3>
          {suggestion.detail ? <p className="mt-0.5 text-[13px] text-ink-700">{suggestion.detail}</p> : null}
          {suggestion.reason ? <p className="mt-0.5 text-[12px] text-ink-500">{suggestion.reason}</p> : null}
          {editing ? (
            <label className="mt-2 block">
              <span className="text-[12px] font-medium text-ink-600">What Chat will be asked</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={4000}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink-900"
                data-testid="suggestion-prompt"
              />
            </label>
          ) : null}
          {error ? <p className="mt-1 text-[12px] text-red-700" role="alert">{error}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run('approve')}
              disabled={busy !== null || (editing && !prompt.trim())}
              className="rounded-lg bg-brand-600 px-3 py-1 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              data-testid="suggestion-approve"
            >
              {busy === 'approve' ? 'Starting…' : 'Approve'}
            </button>
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy !== null}
                className="rounded-lg border border-line bg-white px-3 py-1 text-[13px] font-medium text-ink-800 hover:bg-paper-100 disabled:opacity-50"
                data-testid="suggestion-edit"
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void run('dismiss')}
              disabled={busy !== null}
              className="px-2 py-1 text-[13px] font-medium text-ink-500 hover:text-ink-800 disabled:opacity-50"
              data-testid="suggestion-dismiss"
            >
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
