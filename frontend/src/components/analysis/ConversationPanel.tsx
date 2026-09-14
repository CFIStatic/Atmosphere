import { useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import type { ConversationQuotedFact, ProofConversation } from '../../lib/api';

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
      conversation.transcriptText?.trim(),
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
  testId,
}: {
  title: string;
  items: ConversationQuotedFact[];
  onSeek?: (seconds: number) => void;
  showOwner?: boolean;
  testId?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-3" data-testid={testId}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</p>
      <ul className="mt-2 space-y-2.5">
        {items.map((item) => {
          const seekable = item.tSec != null && Number.isFinite(item.tSec) && item.tSec >= 0;
          const body = (
            <span className="min-w-0 space-y-1">
              <span className="block text-[13px] leading-relaxed text-ink-800">{item.text}</span>
              {showOwner && item.owner ? (
                <span className="inline-block rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                  {item.owner}
                </span>
              ) : null}
              {item.quote ? (
                <span className="block text-[11px] italic leading-relaxed text-ink-500">
                  Exact: “{item.quote}”
                </span>
              ) : null}
              {item.confidence != null && Number.isFinite(item.confidence) ? (
                <span className="block text-[10px] tabular-nums text-ink-400">
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
                  className="flex w-full items-start gap-2.5 rounded px-1 py-1 text-left hover:bg-paper-100/80"
                >
                  <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                    {eventClock(item.tSec!)}
                  </span>
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 px-1 py-1">
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

function glancePoints(c: ProofConversation): string[] {
  const points: string[] = [];
  const push = (text: string | null | undefined) => {
    const t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (points.some((p) => p.toLowerCase() === key)) return;
    points.push(t);
  };

  for (const moment of (c.conversationKeyMoments ?? []).slice(0, 4)) {
    push(moment.text);
  }
  for (const item of asFacts(c.conversationAgreementFacts, c.conversationAgreements).slice(0, 2)) {
    push(item.text);
  }
  for (const item of (c.conversationRefusals ?? []).slice(0, 2)) {
    push(item.text);
  }
  for (const item of (c.conversationActionItems ?? []).slice(0, 2)) {
    const owner = item.owner ? ` (${item.owner})` : '';
    push(`${item.text}${owner}`);
  }
  for (const item of (c.conversationCommitments ?? []).slice(0, 2)) {
    const owner = item.owner ? ` — ${item.owner}` : '';
    push(`${item.text}${owner}`);
  }
  return points.slice(0, 4);
}

/**
 * Office Analysis conversation — progressive disclosure:
 * Glance (default) → Scan (who / topics / decisions / next) → denser detail on expand.
 * Exact transcript + evidence log live in FullEvidence, not here.
 * Silent films render nothing (no fake talk).
 */
export function ConversationPanel({
  conversation,
  onSeek,
}: {
  conversation?: ProofConversation | null;
  onSeek?: (seconds: number) => void;
  /** @deprecated Playhead sync belongs on Full evidence / transcript. */
  activeAtSeconds?: number | null;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [turnsOpen, setTurnsOpen] = useState(false);
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
  const points = glancePoints(c);

  const hasScan =
    rooms.length > 0 ||
    keyMoments.length > 0 ||
    agreementFacts.length > 0 ||
    refusals.length > 0 ||
    commitments.length > 0 ||
    actionItems.length > 0 ||
    concernFacts.length > 0;

  const hasMoreDetail =
    money.length > 0 ||
    insurance.length > 0 ||
    scope.length > 0 ||
    changeOrders.length > 0 ||
    safety.length > 0 ||
    questions.length > 0 ||
    contradictions.length > 0 ||
    turns.length > 0;

  return (
    <div
      className="mt-3 rounded-lg border border-line/80 bg-paper-50/50 px-3.5 py-3.5"
      data-testid="conversation-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Conversation</p>
        {c.conversationSource === 'llm' ? (
          <p className="text-[10px] text-ink-400">
            Model brief{c.conversationModel ? ` · ${c.conversationModel}` : ''}
          </p>
        ) : c.conversationSource === 'deterministic' ? (
          <p className="text-[10px] text-ink-400">Offline extract</p>
        ) : null}
      </div>

      <section className="mt-2" data-testid="analysis-glance" aria-label="Glance">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">Glance</p>
        {brief ? (
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-900" data-testid="conversation-brief">
            {brief}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
            Conversation on the mic — open Scan for who, decisions, and next steps.
          </p>
        )}
        {points.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="analysis-glance-points">
            {points.map((point) => (
              <li key={point} className="flex gap-2 text-[12.5px] leading-snug text-ink-700">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-400" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {hasScan ? (
        <section className="mt-4 border-t border-line/60 pt-3" data-testid="analysis-scan" aria-label="Scan">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">Scan</p>
          {rooms.length > 0 ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-600" data-testid="analysis-scan-topics">
              Topics / rooms: {rooms.join(', ')}
            </p>
          ) : null}

          {keyMoments.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                What was said
              </p>
              <ol className="mt-2 divide-y divide-line/50" data-testid="conversation-key-moments">
                {keyMoments.map((moment) => {
                  const seekable =
                    moment.tSec != null && Number.isFinite(moment.tSec) && moment.tSec >= 0;
                  const row = (
                    <>
                      <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                        {seekable ? eventClock(moment.tSec!) : '—'}
                      </span>
                      <span className="min-w-0 space-y-1">
                        <span className="inline-block rounded-full bg-ink-900/90 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-paper-50">
                          {moment.label}
                        </span>
                        <span className="block text-[13px] leading-relaxed text-ink-800">
                          {moment.text}
                        </span>
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
                          className="flex w-full items-start gap-2.5 px-1 py-2.5 text-left hover:bg-paper-100/80"
                        >
                          {row}
                        </button>
                      ) : (
                        <div className="flex items-start gap-2.5 px-1 py-2.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          <FactList
            title="Decisions"
            items={[...agreementFacts, ...refusals]}
            onSeek={onSeek}
            testId="analysis-scan-decisions"
          />
          <FactList
            title="Next steps"
            items={[...actionItems, ...commitments]}
            onSeek={onSeek}
            showOwner
            testId="analysis-scan-next"
          />
          <FactList title="Concerns" items={concernFacts} onSeek={onSeek} testId="analysis-scan-concerns" />
        </section>
      ) : null}

      {hasMoreDetail ? (
        <details
          className="mt-3"
          data-testid="conversation-more-details"
          open={moreOpen}
          onToggle={(event) => setMoreOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            More conversation detail
          </summary>
          {moreOpen ? (
            <>
              <FactList title="Money & deductible" items={money} onSeek={onSeek} />
              <FactList title="Insurance & adjuster" items={insurance} onSeek={onSeek} />
              <FactList title="Scope changes" items={scope} onSeek={onSeek} />
              <FactList title="Change orders" items={changeOrders} onSeek={onSeek} />
              <FactList title="Safety" items={safety} onSeek={onSeek} />
              <FactList title="Unresolved questions" items={questions} onSeek={onSeek} />
              <FactList title="Contradictions" items={contradictions} onSeek={onSeek} />
              {turns.length > 0 ? (
                <details
                  className="mt-3"
                  data-testid="conversation-turns-details"
                  open={turnsOpen}
                  onToggle={(event) => setTurnsOpen((event.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    Full turns ({turns.length})
                  </summary>
                  {turnsOpen ? (
                    <ol className="mt-2 divide-y divide-line/50" data-testid="conversation-turns">
                      {turns.map((turn) => {
                        const seekable = turn.tSec != null && Number.isFinite(turn.tSec) && turn.tSec >= 0;
                        const body = (
                          <>
                            <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                              {seekable ? eventClock(turn.tSec!) : '—'}
                            </span>
                            <span className="min-w-0 space-y-1">
                              <span
                                className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500"
                                data-testid="turn-speaker"
                              >
                                {turn.speakerLabel}
                              </span>
                              {'\n'}
                              <span className="block text-[13px] leading-relaxed text-ink-800">{turn.text}</span>
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
                                className="flex w-full items-start gap-2.5 px-1 py-2.5 text-left hover:bg-paper-100/80"
                              >
                                {body}
                              </button>
                            ) : (
                              <div className="flex items-start gap-2.5 px-1 py-2.5">{body}</div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </details>
              ) : null}
            </>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export { hasTalk as conversationHasTalk };
