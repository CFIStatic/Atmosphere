import { eventClock } from '../../lib/downloadJson';
import type { ProofConversation } from '../../lib/api';

function hasTalk(conversation: ProofConversation | null | undefined): boolean {
  if (!conversation) return false;
  return Boolean(
    conversation.conversationSummary ||
      conversation.conversationTurns?.length ||
      conversation.conversationAgreements?.length ||
      conversation.conversationConcerns?.length ||
      conversation.conversationCommitments?.length ||
      conversation.conversationActionItems?.length ||
      conversation.conversationRooms?.length ||
      conversation.conversationDetails?.length,
  );
}

function FactList({
  title,
  items,
  onSeek,
}: {
  title: string;
  items: Array<{ text: string; tSec?: number | null }>;
  onSeek?: (seconds: number) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => {
          const seekable = item.tSec != null && Number.isFinite(item.tSec) && item.tSec >= 0;
          return (
            <li key={`${title}|${item.tSec ?? ''}|${item.text}`}>
              {seekable ? (
                <button
                  type="button"
                  data-at={item.tSec!}
                  onClick={() => onSeek?.(item.tSec!)}
                  className="flex w-full items-start gap-2 rounded px-0.5 py-0.5 text-left hover:bg-paper-100/80"
                >
                  <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                    {eventClock(item.tSec!)}
                  </span>
                  <span className="text-[12.5px] leading-snug text-ink-800">{item.text}</span>
                </button>
              ) : (
                <p className="text-[12.5px] leading-snug text-ink-800">{item.text}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Office Analysis “Conversation” — what was said, by whom, when, plus
 * agreements / concerns. Silent films render nothing (no fake talk).
 */
export function ConversationPanel({
  conversation,
  onSeek,
}: {
  conversation?: ProofConversation | null;
  onSeek?: (seconds: number) => void;
}) {
  if (!hasTalk(conversation)) return null;

  const agreementFacts =
    conversation!.conversationAgreementFacts?.length
      ? conversation!.conversationAgreementFacts
      : (conversation!.conversationAgreements ?? []).map((text) => ({ text, tSec: null }));
  const concernFacts =
    conversation!.conversationConcernFacts?.length
      ? conversation!.conversationConcernFacts
      : (conversation!.conversationConcerns ?? []).map((text) => ({ text, tSec: null }));
  const commitments = conversation!.conversationCommitments ?? [];
  const actionItems = conversation!.conversationActionItems ?? [];
  const turns = conversation!.conversationTurns ?? [];
  const rooms = conversation!.conversationRooms ?? [];

  return (
    <div className="mt-3 rounded-lg border border-line/80 bg-paper-50/50 px-3 py-2.5" data-testid="conversation-panel">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Conversation</p>
      {conversation!.conversationSummary && (
        <p className="mt-1 text-[13px] leading-snug text-ink-800">{conversation!.conversationSummary}</p>
      )}
      {rooms.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-500">Rooms: {rooms.join(', ')}</p>
      )}
      <FactList title="Agreements" items={agreementFacts} onSeek={onSeek} />
      <FactList title="Commitments" items={commitments} onSeek={onSeek} />
      <FactList title="Concerns" items={concernFacts} onSeek={onSeek} />
      <FactList title="Action items" items={actionItems} onSeek={onSeek} />
      {turns.length > 0 && (
        <div className="mt-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">Turns</p>
          <ol className="mt-1 divide-y divide-line/60" data-testid="conversation-turns">
            {turns.map((turn) => {
              const seekable = turn.tSec != null && Number.isFinite(turn.tSec) && turn.tSec >= 0;
              const body = (
                <>
                  <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                    {seekable ? eventClock(turn.tSec!) : '—'}
                  </span>
                  <span className="min-w-0">
                    <span className="mr-1.5 inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                      {turn.speakerLabel}
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-800">{turn.text}</span>
                  </span>
                </>
              );
              return (
                <li key={`${turn.tSec}|${turn.speakerLabel}|${turn.text}`}>
                  {seekable ? (
                    <button
                      type="button"
                      data-at={turn.tSec!}
                      onClick={() => onSeek?.(turn.tSec!)}
                      className="flex w-full items-start gap-2 px-0.5 py-1.5 text-left hover:bg-paper-100/80"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-0.5 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

export { hasTalk as conversationHasTalk };
