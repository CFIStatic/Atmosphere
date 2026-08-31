import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  api,
  ApiError,
  type ProofQuestion,
  type ProofResponse,
  type SharedJobRecord,
} from '../lib/api';
import {
  buildJobFileDossier,
  fileKnowsCopy,
  hasMicOnFile,
  hasVideoOnFile,
  jobFileSuggestions,
  latestFilmedDate,
  turnsFromQuestions,
  type JobFileTurn,
} from '../lib/jobFileAsk';
import { SpinnerIcon } from './icons';

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

/**
 * Ask the clips from inside a job profile — not a full-page chat shell.
 *
 * The parent can pass the file it already loaded so the page and this panel
 * do not fetch the record twice.
 */
export function JobAskPanel({
  jobId,
  file,
  fill = false,
}: {
  jobId: string;
  file?: { record: SharedJobRecord | null; proofs: ProofResponse | null };
  /** Fill a docked column instead of sitting as a card with a capped thread. */
  fill?: boolean;
}) {
  const [ownRecord, setOwnRecord] = useState<SharedJobRecord | null>(null);
  const [ownProofs, setOwnProofs] = useState<ProofResponse | null>(null);
  const [turns, setTurns] = useState<JobFileTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  const record = file ? file.record : ownRecord;
  const proofs = file ? file.proofs : ownProofs;
  const preloaded = file !== undefined;

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    Promise.all([
      preloaded ? Promise.resolve(record) : api.sharedJob(jobId).catch(() => null),
      preloaded ? Promise.resolve(proofs) : api.jobProofs(jobId).catch(() => null),
      api.proofQuestions(jobId).catch(() => ({ questions: [] as ProofQuestion[] })),
    ])
      .then(([nextRecord, nextProofs, nextQuestions]) => {
        if (n !== seq.current) return;
        if (!preloaded) {
          setOwnRecord(nextRecord);
          setOwnProofs(nextProofs);
        }
        setTurns(turnsFromQuestions(nextQuestions.questions));
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
    // Reload when the job changes — not when the parent passes a new file object
    // for the same clips, or a typed answer disappears.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record/proofs are the preloaded snapshot
  }, [jobId, preloaded]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, asking]);

  const dossier = useMemo(
    () => buildJobFileDossier({ proofs, messages: record?.messages ?? [] }),
    [proofs, record],
  );
  const suggestions = jobFileSuggestions({
    hasMic: hasMicOnFile(proofs),
    hasVideo: hasVideoOnFile(proofs),
    latestDate: latestFilmedDate(proofs),
    beats: dossier,
  });
  const knows = fileKnowsCopy({
    clipCount: proofs?.videos?.length ?? 0,
    hasMic: hasMicOnFile(proofs),
    hasNotes: (record?.messages.length ?? 0) > 0,
  });

  async function ask(textRaw: string) {
    const text = textRaw.trim();
    if (!text || asking) return;
    setAsking(true);
    setDraft('');
    setError(null);
    const now = new Date().toISOString();
    const pendingId = `local-${now}`;
    setTurns((prev) => [...prev, { id: pendingId, role: 'user', content: text, at: now }]);
    try {
      const res = await api.askAboutProofs(jobId, text);
      setTurns((prev) => [
        ...prev.filter((turn) => turn.id !== pendingId),
        {
          id: res.question?.id ? `${res.question.id}-q` : pendingId,
          role: 'user',
          content: text,
          at: res.question?.created_at ?? now,
        },
        {
          id: res.question?.id ? `${res.question.id}-a` : `${pendingId}-a`,
          role: 'assistant',
          content: res.answer,
          groundedOn: res.groundedOn,
          at: res.question?.created_at ?? now,
        },
      ]);
    } catch (err) {
      setTurns((prev) => prev.filter((turn) => turn.id !== pendingId));
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
          ? 'flex min-h-0 flex-1 flex-col bg-paper-50'
          : 'flex min-h-[28rem] flex-col rounded-xl glass-card'
      }
      data-testid="job-ask-panel"
    >
      <div className="shrink-0 border-b border-line px-5 py-4">
        <h2 className="text-base font-semibold text-ink-900">Ask this job</h2>
        <p className="mt-0.5 text-xs text-ink-500">{knows}</p>
      </div>

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
            <p className="text-sm text-ink-600">Forgot something? Ask what happened on site or what the homeowner said.</p>
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
                  <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                  {turn.role === 'assistant' && turn.groundedOn != null && (
                    <p className="mt-1.5 text-[11px] text-ink-400">
                      From {turn.groundedOn} clip{turn.groundedOn === 1 ? '' : 's'} on this file
                    </p>
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
