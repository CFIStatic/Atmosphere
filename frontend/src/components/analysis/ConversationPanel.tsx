import { eventClock } from '../../lib/downloadJson';
import type { ConversationQuotedFact, ProofConversation } from '../../lib/api';
import { VerbatimTranscript } from './VerbatimTranscript';

function hasTalk(conversation: ProofConversation | null | undefined): boolean {
  if (!conversation) return false;
  return Boolean(
    conversation.conversationExecutiveSummary ||
      conversation.conversationSummary ||
      conversation.conversationKeyMoments?.length ||
      conversation.conversationTurns?.length ||
      conversation.conversationAgreements?.length ||
      conversation.conversationConcerns?.length ||
      conversation.conversationCommitments?.length ||
      conversation.conversationActionItems?.length ||
      conversation.conversationRefusals?.length ||
      conversation.conversationRooms?.length ||
      conversation.conversationDetails?.length ||
      conversation.transcriptSegments?.length ||
      conversation.transcriptText?.trim() ||
      conversation.conversationPeople?.length,
  );
}

function asFacts(
  rich: ConversationQuotedFact[] | undefined,
  plain: string[] | undefined,
): ConversationQuotedFact[] {
  if (rich?.length) return rich;
  return (plain ?? []).map((text) => ({ text, tSec: null, quote: text }));
}

function FactList({
  title,
  items,
  onSeek,
  showOwner,
}: {
  title: string;
  items: ConversationQuotedFact[];
  onSeek?: (seconds: number) => void;
  showOwner?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</p>
      <ul className="mt-1 space-y-1.5">
        {items.map((item) => {
          const seekable = item.tSec != null && Number.isFinite(item.tSec) && item.tSec >= 0;
          const body = (
            <span className="min-w-0">
              <span className="text-[12.5px] leading-snug text-ink-800">{item.text}</span>
              {showOwner && item.owner ? (
                <span className="ml-1.5 rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                  {item.owner}
                </span>
              ) : null}
              {item.quote ? (
                <span className="mt-0.5 block text-[11px] italic leading-snug text-ink-500">
                  Exact: “{item.quote}”
                </span>
              ) : null}
              {item.confidence != null && Number.isFinite(item.confidence) ? (
                <span className="mt-0.5 block text-[10px] tabular-nums text-ink-400">
                  Confidence {Math.round(item.confidence * 100)}%
                </span>
              ) : null}
            </span>
          );
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
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2 px-0.5 py-0.5">
                  <span className="w-10 shrink-0 font-mono text-[11px] text-ink-400">—</span>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Office Analysis “Conversation” — intelligent brief: executive summary,
 * key moments, grounded agreements / refusals / promises. Silent films
 * render nothing (no fake talk).
 */
export function ConversationPanel({
  conversation,
  onSeek,
}: {
  conversation?: ProofConversation | null;
  onSeek?: (seconds: number) => void;
}) {
  if (!hasTalk(conversation)) return null;
  const c = conversation!;

  const brief = c.conversationExecutiveSummary || c.conversationSummary;
  const keyMoments = c.conversationKeyMoments ?? [];
  const agreementFacts = asFacts(c.conversationAgreementFacts, c.conversationAgreements);
  const concernFacts = asFacts(c.conversationConcernFacts, c.conversationConcerns);
  const commitments = c.conversationCommitments ?? [];
  const refusals = c.conversationRefusals ?? [];
  const actionItems = c.conversationActionItems ?? [];
  const money = c.conversationMoneyTalk ?? [];
  const insurance = c.conversationInsurance ?? [];
  const scope = c.conversationScopeChanges ?? [];
  const changeOrders = c.conversationChangeOrders ?? [];
  const safety = c.conversationSafety ?? [];
  const questions = c.conversationUnresolvedQuestions ?? [];
  const contradictions = c.conversationContradictions ?? [];
  const turns = c.conversationTurns ?? [];
  const rooms = c.conversationRooms ?? [];

  return (
    <div
      className="mt-3 rounded-lg border border-line/80 bg-paper-50/50 px-3 py-3"
      data-testid="conversation-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Conversation</p>
        {c.conversationSource === 'llm' ? (
          <p className="text-[10px] text-ink-400">Model brief{c.conversationModel ? ` · ${c.conversationModel}` : ''}</p>
        ) : c.conversationSource === 'deterministic' ? (
          <p className="text-[10px] text-ink-400">Offline extract</p>
        ) : null}
      </div>

      {brief && (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-900" data-testid="conversation-brief">
          {brief}
        </p>
      )}
      {rooms.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-500">Rooms & scope mentioned: {rooms.join(', ')}</p>
      )}

      {(c.conversationPeople?.length ?? 0) > 0 && (
        <div className="mt-2.5" data-testid="conversation-people">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">People</p>
          <ul className="mt-1 space-y-1.5">
            {c.conversationPeople!.map((person) => {
              const seek =
                person.firstSeenSec != null && Number.isFinite(person.firstSeenSec)
                  ? person.firstSeenSec
                  : null;
              const body = (
                <span className="min-w-0">
                  <span className="text-[12.5px] font-medium leading-snug text-ink-900">{person.label}</span>
                  {person.role ? (
                    <span className="ml-1.5 rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                      {person.role}
                    </span>
                  ) : null}
                  {person.talking ? (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                      speaking
                    </span>
                  ) : (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-400">present</span>
                  )}
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-700">{person.evidence}</span>
                  {person.quote ? (
                    <span className="mt-0.5 block text-[11px] italic leading-snug text-ink-500">
                      Exact: “{person.quote}”
                    </span>
                  ) : null}
                </span>
              );
              return (
                <li key={`${person.label}|${person.firstSeenSec ?? ''}|${person.evidence.slice(0, 24)}`}>
                  {seek != null ? (
                    <button
                      type="button"
                      data-at={seek}
                      onClick={() => onSeek?.(seek)}
                      className="flex w-full items-start gap-2 rounded px-0.5 py-0.5 text-left hover:bg-paper-100/80"
                    >
                      <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                        {eventClock(seek)}
                      </span>
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-0.5 py-0.5">
                      <span className="w-10 shrink-0 font-mono text-[11px] text-ink-400">—</span>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {keyMoments.length > 0 && (
        <div className="mt-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">Key moments</p>
          <ol className="mt-1 divide-y divide-line/60" data-testid="conversation-key-moments">
            {keyMoments.map((moment) => {
              const seekable = moment.tSec != null && Number.isFinite(moment.tSec) && moment.tSec >= 0;
              const row = (
                <>
                  <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                    {seekable ? eventClock(moment.tSec!) : '—'}
                  </span>
                  <span className="min-w-0">
                    <span className="mr-1.5 inline-block rounded-full bg-ink-900/90 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-paper-50">
                      {moment.label}
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-800">{moment.text}</span>
                    {moment.quote ? (
                      <span className="mt-0.5 block text-[11px] italic text-ink-500">“{moment.quote}”</span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li key={`${moment.tSec}|${moment.label}|${moment.text}`}>
                  {seekable ? (
                    <button
                      type="button"
                      data-at={moment.tSec!}
                      onClick={() => onSeek?.(moment.tSec!)}
                      className="flex w-full items-start gap-2 px-0.5 py-1.5 text-left hover:bg-paper-100/80"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-0.5 py-1.5">{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <FactList title="Agreements & approvals" items={agreementFacts} onSeek={onSeek} />
      <FactList title="Refusals" items={refusals} onSeek={onSeek} />
      <FactList title="Promises" items={commitments} onSeek={onSeek} showOwner />
      <FactList title="Concerns & objections" items={concernFacts} onSeek={onSeek} />
      <FactList title="Money & deductible" items={money} onSeek={onSeek} />
      <FactList title="Insurance & adjuster" items={insurance} onSeek={onSeek} />
      <FactList title="Scope changes" items={scope} onSeek={onSeek} />
      <FactList title="Change orders" items={changeOrders} onSeek={onSeek} />
      <FactList title="Safety" items={safety} onSeek={onSeek} />
      <FactList title="Action items" items={actionItems} onSeek={onSeek} showOwner />
      <FactList title="Unresolved questions" items={questions} onSeek={onSeek} />
      <FactList title="Contradictions" items={contradictions} onSeek={onSeek} />

      <VerbatimTranscript
        segments={c.transcriptSegments}
        transcriptText={c.transcriptText}
        onSeek={onSeek}
      />

      {turns.length > 0 && (
        <details className="mt-3" data-testid="conversation-turns-details">
          <summary className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            Full turns ({turns.length})
          </summary>
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
        </details>
      )}
    </div>
  );
}

export { hasTalk as conversationHasTalk };
