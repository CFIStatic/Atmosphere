import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import type { AskPinnedAnswer } from '../../lib/api';
import { MentionText } from '../mentions/MentionText';

function plain(answer: string): string {
  return answer
    .replace(/⟦\/?artifact⟧/g, '')
    .replace(/⟦[^⟧]*⟧/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

/** Answers pinned to this job, shown to everyone in the company at the top of Chat. */
export function AskPinnedAnswers({
  pins,
  focusQuestionId,
  onUnpin,
  onCopyLink,
}: {
  pins: AskPinnedAnswer[];
  /** Opened from a shared link: expand and scroll to this pin. */
  focusQuestionId?: string | null;
  onUnpin: (questionId: string) => void;
  onCopyLink: (questionId: string) => void;
}) {
  // Until the person toggles, a shared link's pin is shown open (pins arrive after the first render).
  const focusPinned = Boolean(focusQuestionId && pins.some((p) => p.questionId === focusQuestionId));
  const [openChoice, setOpen] = useState<boolean | null>(null);
  const [expandedChoice, setExpanded] = useState<string | null | undefined>(undefined);
  const open = openChoice ?? focusPinned;
  const expanded = expandedChoice === undefined ? (focusPinned ? (focusQuestionId ?? null) : null) : expandedChoice;
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!focusPinned) return;
    const id = window.requestAnimationFrame(() => focusRef.current?.scrollIntoView?.({ block: 'nearest' }));
    return () => window.cancelAnimationFrame(id);
  }, [focusPinned]);
  if (!pins.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-line bg-paper-0" data-testid="ask-pinned">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-semibold text-ink-700"
      >
        <Pin size={13} aria-hidden />
        Pinned answers ({pins.length})
        {open ? <ChevronDown size={14} className="ml-auto" aria-hidden /> : <ChevronRight size={14} className="ml-auto" aria-hidden />}
      </button>
      {open ? (
        <ul className="divide-y divide-line border-t border-line">
          {pins.map((pin) => {
            const isOpen = expanded === pin.questionId;
            return (
              <li
                key={pin.id}
                ref={pin.questionId === focusQuestionId ? focusRef : undefined}
                className={`px-3 py-2 ${pin.questionId === focusQuestionId ? 'bg-brand-50' : ''}`}
                data-testid="ask-pinned-item"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : pin.questionId)}
                  aria-expanded={isOpen}
                  className="w-full text-left text-[13px] font-medium text-ink-900"
                >
                  <MentionText text={pin.question} />
                </button>
                <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700 ${isOpen ? '' : 'line-clamp-2'}`}>{plain(pin.answer)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                  <span>
                    Pinned{pin.pinnedBy ? ` by ${pin.pinnedBy}` : ''} · {new Date(pin.pinnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <button type="button" className="font-medium text-ink-600 hover:text-ink-900" onClick={() => onCopyLink(pin.questionId)}>
                    Copy link
                  </button>
                  <button type="button" className="font-medium text-ink-600 hover:text-danger-600" onClick={() => onUnpin(pin.questionId)}>
                    Unpin
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
