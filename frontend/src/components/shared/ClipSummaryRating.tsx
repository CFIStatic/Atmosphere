import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ClipSummaryFeedback, ClipSummaryFeedbackReason } from '../../lib/api';

const REASONS: Array<{ id: ClipSummaryFeedbackReason; label: string }> = [
  { id: 'wrong', label: 'Wrong' },
  { id: 'missing', label: 'Missed something' },
  { id: 'made_up', label: 'Made something up' },
  { id: 'unclear', label: 'Hard to follow' },
  { id: 'other', label: 'Something else' },
];

const CHIP =
  'inline-flex items-center gap-1 rounded-full border border-line bg-paper-0 px-2.5 py-0.5 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900 disabled:opacity-35';

const ICON =
  'relative inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-paper-100 hover:text-ink-900 disabled:opacity-35';

const CORRECTION_MAX = 4000;

/**
 * A clip's AI summary with thumbs up / down and "Fix it". The fix is saved next
 * to the AI text (the clip's own summary never changes) and, for workspaces
 * that turned on "Help improve Atmosphere's AI", becomes training data.
 * Office members only.
 */
export function ClipSummaryRating({
  summary,
  feedback,
  onRate,
}: {
  summary: string;
  feedback: ClipSummaryFeedback | null;
  onRate: (
    rating: 1 | -1 | 0,
    extra?: { reason?: ClipSummaryFeedbackReason | null; correctedText?: string | null },
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [draft, setDraft] = useState('');
  const up = feedback?.rating === 1;
  const down = feedback?.rating === -1;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  function openFix() {
    setDraft(feedback?.correctedText ?? summary);
    setFixing(true);
  }

  return (
    <section className="rounded-lg border border-line/80 bg-paper-0/60 px-3 py-2.5" data-testid="clip-summary">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">AI summary</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-900" data-testid="clip-summary-text">
            {summary}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            data-testid="clip-summary-up"
            aria-label={up ? 'Remove thumbs up' : 'Good summary'}
            aria-pressed={up}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setFixing(false);
                await onRate(up ? 0 : 1);
              })
            }
            className={`${ICON} ${up ? 'bg-brand-50 text-brand-700' : ''}`}
          >
            <ThumbsUp size={14} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="clip-summary-down"
            aria-label={down ? 'Remove thumbs down' : 'Bad summary'}
            aria-pressed={down}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (down) {
                  setFixing(false);
                  await onRate(0);
                } else {
                  await onRate(-1);
                  openFix();
                }
              })
            }
            className={`${ICON} ${down ? 'bg-danger-50 text-danger-600' : ''}`}
          >
            <ThumbsDown size={14} aria-hidden />
          </button>
        </div>
      </div>

      {down ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="clip-summary-reasons">
          <span className="text-[11px] text-ink-500">What was wrong?</span>
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              aria-pressed={feedback?.reason === r.id}
              onClick={() =>
                void run(() => onRate(-1, { reason: r.id, correctedText: feedback?.correctedText ?? null }))
              }
              className={`${CHIP} ${feedback?.reason === r.id ? 'border-brand-300 bg-brand-50' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {fixing ? (
        <form
          className="mt-2 space-y-1.5"
          data-testid="clip-summary-fix"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await onRate(feedback?.rating ?? -1, {
                reason: feedback?.reason ?? null,
                correctedText: draft.trim() || null,
              });
              setFixing(false);
            });
          }}
        >
          <label className="block text-[11px] text-ink-500" htmlFor="clip-summary-fix-text">
            Write what the summary should say. Your fix is saved with this video; the original stays as filed.
          </label>
          <textarea
            id="clip-summary-fix-text"
            value={draft}
            maxLength={CORRECTION_MAX}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-lg border border-line bg-paper-0 px-2.5 py-2 text-[13px] text-ink-900 outline-hidden focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1 text-[12px] font-semibold text-ink-900 hover:bg-brand-700 disabled:opacity-50"
            >
              Save fix
            </button>
            <button
              type="button"
              onClick={() => setFixing(false)}
              className="rounded-lg px-2 py-1 text-[12px] text-ink-600 hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : feedback?.correctedText ? (
        <div className="mt-2 rounded-md bg-brand-50/60 px-2.5 py-2" data-testid="clip-summary-correction">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-700">Your fix</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-800">{feedback.correctedText}</p>
          <button
            type="button"
            onClick={openFix}
            className="mt-1 text-[11px] font-medium text-brand-700 hover:underline"
          >
            Edit fix
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="clip-summary-fix-open"
          onClick={openFix}
          className="mt-1.5 text-[11px] font-medium text-ink-500 hover:text-ink-900"
        >
          Fix it
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-danger-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
