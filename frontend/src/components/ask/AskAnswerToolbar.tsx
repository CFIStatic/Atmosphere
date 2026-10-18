import { useState } from 'react';
import { Link2, Pin, PinOff, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { AskFeedback, AskFeedbackReason } from '../../lib/api';

const REASONS: Array<{ id: AskFeedbackReason; label: string }> = [
  { id: 'wrong', label: 'Wrong' },
  { id: 'incomplete', label: 'Incomplete' },
  { id: 'not_on_file', label: 'Not from the file' },
  { id: 'unclear', label: 'Hard to follow' },
  { id: 'other', label: 'Something else' },
];

const CHIP =
  'inline-flex items-center gap-1 rounded-full border border-line bg-paper-0 px-2.5 py-0.5 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900 disabled:opacity-35';

/** Icon-only, matching Copy and Regenerate in the answer row. Relative so the
 * screen-reader label stays inside the button instead of stretching the page. */
const ICON =
  'relative inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-paper-100 hover:text-ink-900 disabled:opacity-35';

/**
 * Rate, pin and share one stored answer. Office members only (the panel hides
 * it for share links and homeowners).
 */
export function AskAnswerToolbar({
  feedback,
  pinned,
  onRate,
  onPin,
  onCopyLink,
}: {
  feedback: AskFeedback | null;
  pinned: boolean;
  onRate: (rating: 1 | -1 | 0, reason?: AskFeedbackReason | null) => Promise<void> | void;
  onPin: (pin: boolean) => Promise<void> | void;
  onCopyLink: () => Promise<boolean> | boolean;
}) {
  const [askingWhy, setAskingWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const up = feedback?.rating === 1;
  const down = feedback?.rating === -1;
  return (
    <div className="contents">
      <button
        type="button"
        data-testid="ask-thumbs-up"
        aria-label={up ? 'Remove thumbs up' : 'Good answer'}
        aria-pressed={up}
        disabled={busy}
        onClick={() => void run(() => onRate(up ? 0 : 1))}
        className={`${ICON} ${up ? 'bg-brand-50 text-brand-700' : ''}`}
      >
        <ThumbsUp size={14} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="ask-thumbs-down"
        aria-label={down ? 'Remove thumbs down' : 'Bad answer'}
        aria-pressed={down}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (down) {
              setAskingWhy(false);
              await onRate(0);
            } else {
              await onRate(-1);
              setAskingWhy(true);
            }
          })
        }
        className={`${ICON} ${down ? 'bg-danger-50 text-danger-600' : ''}`}
      >
        <ThumbsDown size={14} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="ask-pin"
        aria-pressed={pinned}
        disabled={busy}
        onClick={() => void run(() => onPin(!pinned))}
        className={`${ICON} ${pinned ? 'text-brand-700' : ''}`}
        title={pinned ? 'Remove from the pinned answers on this job' : 'Pin to this job so the whole team sees it'}
      >
        {pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
        <span className="sr-only">{pinned ? 'Unpin' : 'Pin'}</span>
      </button>
      {pinned ? (
        <button
          type="button"
          data-testid="ask-copy-link"
          onClick={() =>
            void run(async () => {
              if (await onCopyLink()) {
                setLinkCopied(true);
                window.setTimeout(() => setLinkCopied(false), 2000);
              }
            })
          }
          className={ICON}
          title="Copy a link to this pinned answer for your team"
        >
          <Link2 size={14} aria-hidden />
          <span className="sr-only">{linkCopied ? 'Link copied' : 'Copy link'}</span>
        </button>
      ) : null}
      {askingWhy && down ? (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1.5" data-testid="ask-feedback-reasons">
          <span className="text-[11px] text-ink-500">What was wrong?</span>
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              aria-pressed={feedback?.reason === r.id}
              onClick={() =>
                void run(async () => {
                  await onRate(-1, r.id);
                  setAskingWhy(false);
                })
              }
              className={`${CHIP} ${feedback?.reason === r.id ? 'border-brand-300 bg-brand-50' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      {down && !askingWhy && feedback?.reason ? (
        <span className="text-[11px] text-ink-500" data-testid="ask-feedback-thanks">
          Thanks. This helps Chat get better.
        </span>
      ) : null}
    </div>
  );
}
