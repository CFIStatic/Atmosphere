import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type JobSummary,
  type ProofQuestion,
  type ProofResponse,
  type SharedJobRecord,
} from '../lib/api';
import {
  buildJobFileDossier,
  fileKnowsCopy,
  hasMicOnFile,
  hasVideoOnFile,
  jobFileMatches,
  jobFileSuggestions,
  latestFilmedDate,
  siteLine,
  turnsFromQuestions,
  type JobFileTurn,
} from '../lib/jobFileAsk';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

/**
 * My jobs is the job file.
 *
 * Not a restoration dashboard. A file you open when you forgot something —
 * what a homeowner said, whether the tarp came off, what the last clip showed —
 * and ask. The answers come from the video analysis on the Dashboard.
 */

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
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

function FileMark() {
  return (
    <span
      className="grid h-11 w-11 place-items-center rounded-2xl bg-paper-0 text-ink-700 shadow-card"
      aria-hidden
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M7 3.5h7.2L19 8.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M14 3.5V8h5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 13h6M9 16.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function JobsPage() {
  useFeatureTimer('jobs');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedJob = searchParams.get('job');
  const requestedTitle = searchParams.get('title');

  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [record, setRecord] = useState<SharedJobRecord | null>(null);
  const [proofs, setProofs] = useState<ProofResponse | null>(null);
  const [turns, setTurns] = useState<JobFileTurn[]>([]);
  const [fileLoading, setFileLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getJobs({ status: 'all' })
      .then(({ jobs: next }) => {
        if (!cancelled) setJobs(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load job files.');
          setJobs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const listed = useMemo(() => (jobs ?? []).filter((job) => jobFileMatches(job, query)), [jobs, query]);
  const openJob = listed.find((job) => job.jobId === requestedJob) ?? jobs?.find((job) => job.jobId === requestedJob);
  const title = record?.job.title || openJob?.title || requestedTitle || 'Job file';

  useEffect(() => {
    if (!requestedJob) {
      setRecord(null);
      setProofs(null);
      setTurns([]);
      setFileLoading(false);
      return;
    }
    const seq = ++openSeq.current;
    setFileLoading(true);
    setError(null);
    Promise.all([
      api.sharedJob(requestedJob).catch(() => null),
      api.jobProofs(requestedJob).catch(() => null),
      api.proofQuestions(requestedJob).catch(() => ({ questions: [] as ProofQuestion[] })),
    ])
      .then(([nextRecord, nextProofs, nextQuestions]) => {
        if (seq !== openSeq.current) return;
        setRecord(nextRecord);
        setProofs(nextProofs);
        setTurns(turnsFromQuestions(nextQuestions.questions));
      })
      .finally(() => {
        if (seq === openSeq.current) setFileLoading(false);
      });
  }, [requestedJob]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, asking, requestedJob]);

  function openFile(job: JobSummary) {
    setSidebarOpen(false);
    setSearchParams({ job: job.jobId, title: job.title, number: String(job.jobNumber) }, { replace: true });
  }

  async function ask(textRaw: string) {
    const text = textRaw.trim();
    if (!text || asking) return;

    if (!requestedJob) {
      setDraft('');
      const matches = (jobs ?? []).filter((job) => jobFileMatches(job, text));
      if (matches.length === 1) {
        openFile(matches[0]);
        return;
      }
      setQuery(text);
      setSidebarOpen(true);
      return;
    }

    const jobId = requestedJob;
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
    clipCount: proofs?.videos.length ?? 0,
    hasMic: hasMicOnFile(proofs),
    hasNotes: (record?.messages.length ?? 0) > 0,
  });
  const empty = Boolean(requestedJob) && turns.length === 0 && !asking && !fileLoading;
  const site = siteLine(record);
  const recentFiles = (jobs ?? []).slice(0, 4);

  return (
    <div className="gpt-shell flex h-screen overflow-hidden" data-testid="job-file">
      <aside className={`gpt-sidebar ${sidebarOpen ? 'gpt-sidebar-open' : ''}`} aria-label="Job files">
        <div className="border-b border-line px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Files</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">I've already read them.</p>
          <label className="mt-3 block">
            <span className="sr-only">Find a job file</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a file…"
              className="w-full rounded-xl border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
            />
          </label>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {jobs === null ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-ink-500">
              <SpinnerIcon className="animate-spin" width={14} height={14} />
              Opening files…
            </p>
          ) : listed.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-500">
              {query ? 'No file matches that.' : 'No job files yet. Start a job, then come back here to ask.'}
            </p>
          ) : (
            listed.map((job) => (
              <button
                key={job.jobId}
                type="button"
                onClick={() => openFile(job)}
                className={`gpt-convo ${requestedJob === job.jobId ? 'gpt-convo-active' : ''}`}
              >
                <span className="gpt-convo-icon" aria-hidden>
                  {String(job.jobNumber).slice(-2)}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-ink-900">{job.title}</span>
                  <span className="block truncate text-xs text-ink-500">#{job.jobNumber}</span>
                </span>
              </button>
            ))
          )}
        </nav>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="gpt-sidebar-scrim lg:hidden"
          aria-label="Close job files"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="gpt-header shrink-0">
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-xs font-medium text-ink-700 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                Files
              </button>
              {requestedJob ? (
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
                  <p className="truncate text-xs text-ink-500">
                    {site ?? 'Job file'}
                    {openJob ? ` · #${openJob.jobNumber}` : ''}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-600">Pick a file, or just ask</p>
              )}
            </div>
            {requestedJob && (
              <Link
                to={`/job-progress?job=${encodeURIComponent(requestedJob)}`}
                className="shrink-0 text-xs font-medium text-ink-500 hover:text-ink-800"
              >
                Scope & proofs
              </Link>
            )}
          </div>
        </header>

        <div ref={scrollerRef} className="gpt-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {!requestedJob ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center px-2 text-center">
                <FileMark />
                <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
                  I forgot something — let me ask
                </h1>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">
                  Name the job. I've already read the clips — what happened on site, and what was said
                  on the mic.
                </p>
                {recentFiles.length > 0 && (
                  <div className="mt-8 flex max-w-lg flex-wrap justify-center gap-2">
                    {recentFiles.map((job) => (
                      <button
                        key={job.jobId}
                        type="button"
                        onClick={() => openFile(job)}
                        aria-label={`Ask about ${job.title}`}
                        className="gpt-suggest rounded-full border border-line bg-paper-0 px-4 py-2 text-sm text-ink-700 transition hover:bg-paper-50 hover:shadow-card"
                      >
                        {job.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : fileLoading && turns.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
                <SpinnerIcon className="animate-spin" width={14} height={14} />
                Reading the file…
              </p>
            ) : empty ? (
              <EmptyFile
                title={title}
                knows={knows}
                suggestions={suggestions}
                onSuggest={(s) => void ask(s)}
              />
            ) : (
              <ul className="space-y-5">
                {turns.map((turn) => (
                  <li
                    key={turn.id}
                    className={turn.role === 'user' ? 'flex justify-end' : 'flex items-start gap-3'}
                  >
                    {turn.role === 'assistant' && (
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper-0 text-ink-600 shadow-card">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M7 3.5h7.2L19 8.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <path d="M14 3.5V8h5" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                    )}
                    <div
                      className={
                        turn.role === 'user'
                          ? 'max-w-[85%] rounded-2xl bg-ink-900 px-4 py-2.5 text-sm text-white'
                          : 'max-w-[85%] rounded-2xl bg-paper-0 px-4 py-2.5 text-sm text-ink-800 shadow-card'
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
                  <li className="flex items-start gap-3">
                    <TypingDots />
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="gpt-composer shrink-0">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
            {error && <p className="mb-2 text-center text-xs text-danger-700">{error}</p>}
            <form onSubmit={onSubmit} className="gpt-input-shell">
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
                placeholder={
                  requestedJob ? 'Ask what you forgot…' : 'Name the job you forgot something about…'
                }
                disabled={asking}
                className="gpt-textarea"
              />
              <button
                type="submit"
                disabled={asking || !draft.trim()}
                aria-label={requestedJob ? 'Ask the job file' : 'Find a job file'}
                className="gpt-send"
              >
                <SendIcon />
              </button>
            </form>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              I answer from the clips on this file. If it isn't in them, I'll say so.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyFile({
  title,
  knows,
  suggestions,
  onSuggest,
}: {
  title: string;
  knows: string;
  suggestions: string[];
  onSuggest: (s: string) => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-2 text-center">
      <div className="gpt-empty-mark">
        <FileMark />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">{knows}</p>

      {suggestions.length > 0 && (
        <div className="mt-8 flex max-w-lg flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="gpt-suggest rounded-full border border-line bg-paper-0 px-4 py-2 text-sm text-ink-700 transition hover:bg-paper-50 hover:shadow-card"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
