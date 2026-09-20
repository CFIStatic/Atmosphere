import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  api,
  ApiError,
  type AskThread,
  type ProofQuestion,
  type ProofResponse,
  type SharedJobRecord,
} from '../lib/api';
import { onAskHistoryAction, publishAskHistory } from '../lib/askHistoryBridge';
import {
  buildJobFileDossier,
  hasMicOnFile,
  hasVideoOnFile,
  jobFileSuggestions,
  latestFilmedDate,
  turnsFromQuestions,
  type JobFileTurn,
} from '../lib/jobFileAsk';
import {
  analysisEventsFromProofs,
  eventsForGrounded,
  seekTargetFromAnswer,
  splitAnswerCites,
} from '../lib/askSeek';
import { parseAskProseBlocks, type AskInline } from '../lib/askProse';
import { extractAskSources, type AskSourceChip } from '../lib/askSources';
import { useJobFileFocus } from '../lib/jobFileFocus';
import { useVideoSeek } from '../lib/videoSeek';
import { SpinnerIcon } from './icons';

/**
 * Artificial typing hold removed for ultra-low-latency Ask.
 * Kept as 0 so existing imports/tests keep compiling.
 */
export const ASK_MIN_TYPING_MS = 0;

export async function waitOutAskHold(startedAt: number, holdMs = ASK_MIN_TYPING_MS): Promise<void> {
  const remaining = holdMs - (Date.now() - startedAt);
  if (remaining <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, remaining);
  });
}

function AskCiteSpans({
  text,
  events,
  onSeek,
}: {
  text: string;
  events: number[];
  onSeek: (atSeconds: number) => void;
}) {
  const parts = splitAnswerCites(text, events);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'cite' && part.atSeconds != null ? (
          <button
            key={`${part.atSeconds}-${index}`}
            type="button"
            data-testid="ask-cite"
            data-at={String(part.atSeconds)}
            onClick={() => onSeek(part.atSeconds!)}
            className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
          >
            {part.text}
          </button>
        ) : (
          <span key={`t-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}


function AskSourceChips({
  sources,
  onOpen,
}: {
  sources: AskSourceChip[];
  onOpen: (source: AskSourceChip) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ask-source-chips">
      {sources.map((source) => (
        <button
          key={source.id}
          type="button"
          data-testid="ask-source-chip"
          data-source-id={source.id}
          onClick={() => onOpen(source)}
          className="rounded-full border border-line bg-paper-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"
        >
          {source.label}
        </button>
      ))}
    </div>
  );
}

function AskInlineNodes({
  nodes,
  events,
  onSeek,
}: {
  nodes: AskInline[];
  events: number[];
  onSeek: (atSeconds: number) => void;
}) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === 'text') {
          return <AskCiteSpans key={`t-${index}`} text={node.text} events={events} onSeek={onSeek} />;
        }
        if (node.kind === 'bold') {
          return (
            <strong key={`b-${index}`} className="font-semibold text-ink-900">
              <AskInlineNodes nodes={node.children} events={events} onSeek={onSeek} />
            </strong>
          );
        }
        return (
          <em key={`i-${index}`} className="italic text-ink-700">
            <AskInlineNodes nodes={node.children} events={events} onSeek={onSeek} />
          </em>
        );
      })}
    </>
  );
}

function AskAnswerBody({
  text,
  events,
  onSeek,
  sources,
  onOpenSource,
}: {
  text: string;
  events: number[];
  onSeek: (atSeconds: number) => void;
  sources: AskSourceChip[];
  onOpenSource: (source: AskSourceChip) => void;
}) {
  const { body } = extractAskSources(text);
  const blocks = parseAskProseBlocks(body);
  if (!blocks.length) {
    return (
      <>
        <p className="leading-relaxed">{body || text}</p>
        <AskSourceChips sources={sources} onOpen={onOpenSource} />
      </>
    );
  }
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed" data-testid="ask-answer-body">
      {blocks.map((block, bi) =>
        block.kind === 'list' ? (
          block.ordered ? (
            <ol key={`l-${bi}`} className="list-decimal space-y-1.5 pl-5 marker:text-ink-500">
              {block.items.map((item, ii) => (
                <li key={`i-${bi}-${ii}`} className="pl-0.5">
                  <AskInlineNodes nodes={item} events={events} onSeek={onSeek} />
                </li>
              ))}
            </ol>
          ) : (
            <ul key={`l-${bi}`} className="list-disc space-y-1.5 pl-5 marker:text-ink-500">
              {block.items.map((item, ii) => (
                <li key={`i-${bi}-${ii}`} className="pl-0.5">
                  <AskInlineNodes nodes={item} events={events} onSeek={onSeek} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <p key={`p-${bi}`} className="whitespace-pre-wrap">
            <AskInlineNodes nodes={block.children} events={events} onSeek={onSeek} />
          </p>
        ),
      )}
      <AskSourceChips sources={sources} onOpen={onOpenSource} />
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TypingDots() {
  return (
    <span className="gpt-typing inline-flex items-center gap-1 rounded-full bg-paper-0 px-3 py-2 ring-1 ring-line">
      <span />
      <span />
      <span />
    </span>
  );
}

export type JobAskFn = (
  question: string,
  opts?: { threadId?: string | null },
) => Promise<{
  answer: string;
  groundedOn: number;
  model?: string | null;
  question?: ProofQuestion | null;
  threadId?: string | null;
}>;

/**
 * Ask the clips from inside a job profile — not a full-page chat shell.
 *
 * The parent can pass the file it already loaded so the page and this panel
 * do not fetch the record twice. A guest share passes `ask` so the token
 * door is used instead of the office session.
 */
export function JobAskPanel({
  jobId,
  file,
  fill = false,
  ask: askFn,
  loadQuestions,
  loadThreads,
  createThread,
  renameThread,
}: {
  jobId: string;
  file?: { record: SharedJobRecord | null; proofs: ProofResponse | null };
  /** Fill a docked column instead of sitting as a card with a capped thread. */
  fill?: boolean;
  ask?: JobAskFn;
  loadQuestions?: (threadId?: string | null) => Promise<{ questions: ProofQuestion[] }>;
  loadThreads?: () => Promise<{ threads: AskThread[] }>;
  createThread?: (title?: string) => Promise<{ thread: AskThread }>;
  renameThread?: (threadId: string, title: string) => Promise<{ thread: AskThread }>;
}) {
  const [ownRecord, setOwnRecord] = useState<SharedJobRecord | null>(null);
  const [ownProofs, setOwnProofs] = useState<ProofResponse | null>(null);
  const [turns, setTurns] = useState<JobFileTurn[]>([]);
  const [threads, setThreads] = useState<AskThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  const activeThreadIdRef = useRef<string | null>(null);
  const { seek } = useVideoSeek();
  const { focus: focusJobFile } = useJobFileFocus();
  const record = file ? file.record : ownRecord;
  const proofs = file ? file.proofs : ownProofs;
  const preloaded = file !== undefined;

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    publishAskHistory({ jobId, threads, activeThreadId });
  }, [jobId, threads, activeThreadId]);

  async function loadThreadMessages(threadId: string | null) {
    if (!threadId) {
      if (loadQuestions) {
        const next = await loadQuestions(null).catch(() => ({ questions: [] as ProofQuestion[] }));
        return turnsFromQuestions(next.questions);
      }
      return [] as JobFileTurn[];
    }
    try {
      if (loadQuestions) {
        const next = await loadQuestions(threadId).catch(() => ({ questions: [] as ProofQuestion[] }));
        return turnsFromQuestions(next.questions);
      }
      const next = await api.proofQuestions(jobId, { threadId });
      return turnsFromQuestions(next.questions);
    } catch {
      return [] as JobFileTurn[];
    }
  }

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    setActiveThreadId(null);
    setThreads([]);
    setTurns([]);
    Promise.all([
      preloaded ? Promise.resolve(record) : api.sharedJob(jobId).catch(() => null),
      preloaded ? Promise.resolve(proofs) : api.jobProofs(jobId).catch(() => null),
      (loadThreads
        ? loadThreads().catch(() => ({ threads: [] as AskThread[] }))
        : askFn
          ? Promise.resolve({ threads: [] as AskThread[] })
          : (api.askThreads?.(jobId) ?? Promise.resolve({ threads: [] as AskThread[] })).catch(
              () => ({ threads: [] as AskThread[] }),
            )),
    ])
      .then(async ([nextRecord, nextProofs, threadRes]) => {
        if (n !== seq.current) return;
        if (!preloaded) {
          setOwnRecord(nextRecord);
          setOwnProofs(nextProofs);
        }
        let nextThreads = threadRes?.threads ?? [];
        if (!nextThreads.length) {
          try {
            const created = createThread
              ? await createThread()
              : askFn
                ? null
                : await api.createAskThread(jobId);
            if (created) nextThreads = [created.thread];
          } catch {
            nextThreads = [];
          }
        }
        setThreads(nextThreads);
        const firstId = nextThreads[0]?.id ?? null;
        setActiveThreadId(firstId);
        if (firstId) {
          const msgs = await loadThreadMessages(firstId);
          if (n !== seq.current) return;
          setTurns(msgs);
        } else if (loadQuestions) {
          const legacy = await loadQuestions(null).catch(() => ({ questions: [] as ProofQuestion[] }));
          if (n !== seq.current) return;
          setTurns(turnsFromQuestions(legacy.questions));
        }
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record/proofs are the preloaded snapshot
  }, [jobId, preloaded]);

  useEffect(() => {
    return onAskHistoryAction((action) => {
      if (action.jobId !== jobId) return;
      if (action.type === 'new-chat') {
        void (async () => {
          try {
            const created = createThread
              ? await createThread()
              : askFn
                ? null
                : await api.createAskThread(jobId);
            if (created) {
              setThreads((prev) => [created.thread, ...prev.filter((t) => t.id !== created.thread.id)]);
              setActiveThreadId(created.thread.id);
              setTurns([]);
              setError(null);
              inputRef.current?.focus();
            } else {
              setActiveThreadId(null);
              setTurns([]);
            }
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not start a new chat.');
          }
        })();
        return;
      }
      if (action.type === 'select-thread') {
        void (async () => {
          setActiveThreadId(action.threadId);
          setLoading(true);
          setError(null);
          try {
            const msgs = await loadThreadMessages(action.threadId);
            setTurns(msgs);
          } finally {
            setLoading(false);
            inputRef.current?.focus();
          }
        })();
      }

      if (action.type === 'rename-thread') {
        void (async () => {
          const nextTitle = action.title.trim();
          if (!nextTitle) return;
          try {
            const renamed = renameThread
              ? await renameThread(action.threadId, nextTitle)
              : await api.renameAskThread(jobId, action.threadId, nextTitle);
            setThreads((prev) =>
              prev.map((th) => (th.id === renamed.thread.id ? renamed.thread : th)),
            );
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not rename this chat.');
          }
        })();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, askFn]);

  const analysisEvents = useMemo(() => analysisEventsFromProofs(proofs), [proofs]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, asking]);

  const dossier = useMemo(
    () =>
      buildJobFileDossier({
        proofs,
        messages: record?.messages ?? [],
        facts: record?.brief?.facts ?? null,
        scope: record?.scope ?? null,
      }),
    [proofs, record],
  );
  const suggestions = jobFileSuggestions({
    hasMic: hasMicOnFile(proofs),
    hasVideo: hasVideoOnFile(proofs),
    latestDate: latestFilmedDate(proofs),
    beats: dossier,
  });
  function openAskSource(source: AskSourceChip) {
    if (source.workDate || source.section === 'videos') {
      seek({
        atSeconds: 0,
        workDate: source.workDate,
      });
    }
    if (source.section) {
      focusJobFile({ section: source.section, workDate: source.workDate });
    }
  }

  function seekCite(turn: JobFileTurn, atSeconds: number) {
    const scoped = eventsForGrounded(analysisEvents, turn.groundedIds, proofs?.videos);
    const owner = scoped.find((event) => event.atSeconds === atSeconds);
    const target = seekTargetFromAnswer({
      answer: turn.content,
      events: analysisEvents,
      groundedIds: turn.groundedIds,
      videos: proofs?.videos,
    });
    seek({
      atSeconds,
      proofId: owner?.proofId ?? target?.proofId,
      workDate: owner?.workDate ?? target?.workDate,
      phase: owner?.phase ?? target?.phase,
    });
  }

  async function ask(textRaw: string) {
    const text = textRaw.trim();
    if (!text || asking) return;
    setAsking(true);
    setDraft('');
    setError(null);
    const now = new Date().toISOString();
    const pendingId = `local-${now}`;
    const streamId = `${pendingId}-a`;
    setTurns((prev) => [...prev, { id: pendingId, role: 'user', content: text, at: now }]);
    let sawFirstToken = false;
    try {
      let res: {
        answer: string;
        groundedOn: number;
        model?: string | null;
        question?: ProofQuestion | null;
        threadId?: string | null;
      };
      const threadOpts = { threadId: activeThreadIdRef.current };
      if (askFn) {
        res = await askFn(text, threadOpts);
      } else {
        try {
          res = await api.askAboutProofsStream(
            jobId,
            text,
            {
              onToken: (delta) => {
                if (!sawFirstToken) {
                  sawFirstToken = true;
                  setAsking(false);
                }
                // Accumulate from the last assistant stream bubble.
                setTurns((prev) => {
                  const existing = prev.find((turn) => turn.id === streamId);
                  const next = (existing?.content ?? '') + delta;
                  const without = prev.filter((turn) => turn.id !== streamId);
                  return [
                    ...without,
                    { id: streamId, role: 'assistant' as const, content: next, at: now },
                  ];
                });
              },
            },
            threadOpts,
          );
        } catch {
          // Stream unavailable — fall back to the classic JSON Ask.
          res = await api.askAboutProofs(jobId, text, threadOpts);
        }
      }
      if (res.threadId && res.threadId !== activeThreadIdRef.current) {
        setActiveThreadId(res.threadId);
      }
      // Refresh thread titles after first message auto-title.
      if (loadThreads) {
        void loadThreads().then((r) => setThreads(r.threads)).catch(() => {});
      } else if (!askFn) {
        void api.askThreads(jobId).then((r) => setThreads(r.threads)).catch(() => {});
      }
      setTurns((prev) => [
        ...prev.filter((turn) => turn.id !== pendingId && turn.id !== streamId),
        {
          id: res.question?.id ? `${res.question.id}-q` : pendingId,
          role: 'user',
          content: text,
          at: res.question?.created_at ?? now,
        },
        {
          id: res.question?.id ? `${res.question.id}-a` : streamId,
          role: 'assistant',
          content: res.answer,
          groundedOn: res.groundedOn,
          groundedIds: res.question?.grounded_on,
          model: res.model ?? res.question?.model,
          at: res.question?.created_at ?? now,
        },
      ]);
      const target = seekTargetFromAnswer({
        answer: res.answer,
        events: analysisEvents,
        groundedIds: res.question?.grounded_on,
        videos: proofs?.videos,
      });
      if (target) seek(target);
    } catch (err) {
      setTurns((prev) => prev.filter((turn) => turn.id !== pendingId && turn.id !== streamId));
      setError(err instanceof ApiError ? err.message : 'Could not answer that from the file.');
    } finally {
      setAsking(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  }

  return (
    <section
      className={
        fill
          ? 'flex h-full min-h-0 flex-1 flex-col bg-paper-50'
          : 'flex min-h-[28rem] flex-col rounded-xl glass-card'
      }
      aria-label="Ask this job"
      data-testid="job-ask-panel"
    >
      <div
        ref={scrollerRef}
        className={
          fill
            ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4'
            : 'max-h-[28rem] flex-1 overflow-y-auto px-5 py-4'
        }
      >
        {loading && turns.length === 0 ? (
          <p className="flex items-center gap-2 py-10 text-sm text-ink-500">
            <SpinnerIcon className="animate-spin" width={14} height={14} />
            Reading the clips…
          </p>
        ) : turns.length === 0 && !asking ? (
          <div>
            <p className="text-sm text-ink-600">
              Forgot something? Ask what happened on site or what the homeowner said.
            </p>
            {suggestions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-full border border-line bg-paper-0 px-3 py-1.5 text-left text-sm text-ink-700 transition hover:bg-paper-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-4">
            {turns.map((turn) => (
              <li
                key={turn.id}
                className={turn.role === 'user' ? 'flex justify-end' : 'flex items-start gap-2.5'}
              >
                <div
                  className={
                    turn.role === 'user'
                      ? 'max-w-[85%] rounded-2xl bg-ink-900 px-3.5 py-2 text-sm text-paper-0'
                      : 'max-w-[85%] rounded-2xl bg-paper-0 px-3.5 py-2 text-sm text-ink-800 shadow-card'
                  }
                >
                  {turn.role === 'assistant' ? (
                    <AskAnswerBody
                      text={turn.content}
                      events={analysisEvents
                        .filter((event) =>
                          !turn.groundedIds?.length
                            ? true
                            : turn.groundedIds.some(
                                (id) =>
                                  id === event.proofId ||
                                  id === `${event.workDate}:${event.phase}` ||
                                  id === `${event.workDate}:clip`,
                              ),
                        )
                        .map((event) => event.atSeconds)}
                      onSeek={(atSeconds) => seekCite(turn, atSeconds)}
                      sources={extractAskSources(turn.content).sources}
                      onOpenSource={openAskSource}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                  )}
                  {turn.role === 'assistant' && turn.groundedOn != null && turn.groundedOn > 0 && (
                    <p className="mt-1.5 text-[11px] text-ink-400">From this job file</p>
                  )}
                </div>
              </li>
            ))}
            {asking && (
              <li className="flex items-start gap-2.5">
                <TypingDots />
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-3">
        {error && <p className="mb-2 text-xs text-danger-700">{error}</p>}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask what you forgot…"
            disabled={asking}
            className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
          />
          <button
            type="submit"
            disabled={asking || !draft.trim()}
            aria-label="Ask this job"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-35"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </section>
  );
}
