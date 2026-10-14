/**
 * How one Chat answer is drawn: prose blocks, inline cites, quotes, source
 * chips, the steps-and-sources footer, follow-up buttons, and small icons.
 */
import { useState, type ReactNode } from 'react';
import { splitAnswerCites } from '../../lib/askSeek';
import {
  parseAskProseBlocks,
  splitAskArtifact,
  type AskInline,
  type AskProseBlock,
} from '../../lib/askProse';
import { sanitizeSpeakerProse } from '../../lib/speakerLabel';
import {
  extractAskSources,
  isDocumentQuoteSource,
  tidyQuoteClipTitle,
  type AskSourceChip,
} from '../../lib/askSources';
import { AskWebResults } from '../AskWebResults';
import { ComputerTaskCard } from '../computer/ComputerTaskCard';
import { type ComputerTaskView } from '../../lib/computer';
import { AskApprovalCard } from './AskApprovalCard';
import type { AskWebSource } from '../../lib/askWebSources';

export function AskCiteSpans({
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


export function AskQuoteList({
  quotes,
  onOpen,
}: {
  quotes: ReturnType<typeof extractAskSources>['quotes'];
  onOpen: (source: AskSourceChip) => void;
}) {
  if (!quotes.length) return null;
  return (
    <div className="mt-1.5 space-y-1" data-testid="ask-quotes">
      {quotes.map((quote) => (
        <button
          key={`${quote.sourceId}-${quote.text}`}
          type="button"
          data-testid="ask-quote"
          data-at={quote.atSeconds == null ? '' : String(quote.atSeconds)}
          data-proof-id={quote.proofId ?? ''}
          onClick={() =>
            onOpen({
              id: quote.sourceId as AskSourceChip['id'],
              label: quote.speaker,
              section: 'videos',
              proofId: quote.proofId,
              jobId: quote.jobId,
              atSeconds: quote.atSeconds ?? undefined,
            })
          }
          title={quoteAttribution(quote)}
          className="flex w-full items-baseline gap-3 rounded-md border border-line bg-paper-50 px-2.5 py-1 text-left leading-snug"
        >
          <span className="min-w-0 flex-1 text-[13px] text-ink-800">“{quote.text}”</span>
          <span className="max-w-[45%] shrink-0 truncate text-[10.5px] text-ink-500">
            {quoteAttribution(quote)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A document excerpt has no speaker: only clip quotes carry one. */
/** The message the app sends when Computer finishes; shown as a small note, not a bubble. */
export const COMPUTER_FINISHED_PREFIX = 'Computer finished:';

/** Questions the answer suggests asking next: one tap sends them. */
export function AskFollowUps({ questions, onPick }: { questions: string[]; onPick: (question: string) => void }) {
  if (!questions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ask-followups">
      {questions.slice(0, 3).map((q) => (
        <button
          key={q}
          type="button"
          data-testid="ask-followup"
          onClick={() => onPick(q)}
          className="rounded-lg border border-line bg-paper-0 px-2.5 py-1 text-left text-[13px] text-ink-700 transition hover:border-brand-200 hover:bg-paper-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

export function quoteAttribution(quote: ReturnType<typeof extractAskSources>['quotes'][number]): string {
  return [
    isDocumentQuoteSource(quote.sourceId) ? '' : quote.speaker,
    tidyQuoteClipTitle(quote.clipTitle),
    quote.atSeconds != null ? formatMomentClock(quote.atSeconds) : '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

export function formatMomentClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}


export function AskStepsSourcesBody({
  sources,
  webSources,
  actions,
  onOpenSource,
}: {
  sources: AskSourceChip[];
  webSources?: readonly AskWebSource[] | null;
  actions: ReturnType<typeof extractAskSources>['actions'];
  onOpenSource: (source: AskSourceChip) => void;
}) {
  const webCount = (webSources ?? []).length;
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-line bg-paper-50 p-2.5" data-testid="ask-steps-sources-body">
      {actions.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Steps</p>
          <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-[12px] text-ink-700">
            {actions.map((action, i) => (
              <li key={`${action.tool}-${i}`}>{action.label}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {sources.length || webCount ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sources</p>
          <div className="mt-1">
            <AskSourceChips sources={sources} onOpen={onOpenSource} />
            <AskWebResults sources={webSources} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Steps a reply took, minus the ones it already shows as cards (approvals, Computer tasks). */
export function answerStepActions(text: string) {
  return extractAskSources(text).actions.filter(
    (a) => a.tool !== 'start_computer_task' && !(a.path ?? '').startsWith('ask-approval:'),
  );
}

export const ANSWER_ICON_BUTTON =
  'relative inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-paper-100 hover:text-ink-900 disabled:opacity-35';

/**
 * One compact row under an answer: icon actions, a closed-by-default
 * Steps / Sources toggle, and next-step buttons (Make a punch list) on the right.
 * Steps and sources open underneath the row.
 */
export function AskAnswerFooter({
  text,
  sources,
  webSources,
  onOpenSource,
  children,
  trailing,
  below,
}: {
  text: string;
  sources: AskSourceChip[];
  webSources?: readonly AskWebSource[] | null;
  onOpenSource: (source: AskSourceChip) => void;
  children?: ReactNode;
  trailing?: ReactNode;
  below?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const actions = answerStepActions(text);
  const count = sources.length + (webSources ?? []).length + actions.length;
  return (
    <div className="mt-1.5" data-testid="ask-answer-footer">
      <div className="flex flex-wrap items-center gap-0.5">
        {children}
        {count ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-500 transition hover:bg-paper-100 hover:text-ink-800"
            aria-expanded={open}
            data-testid="ask-steps-sources-toggle"
          >
            {open ? 'Hide steps / sources' : `Steps / Sources (${count})`}
          </button>
        ) : null}
        {trailing ? <div className="ms-auto flex flex-wrap items-center gap-1.5">{trailing}</div> : null}
      </div>
      {open && count ? (
        <AskStepsSourcesBody sources={sources} webSources={webSources} actions={actions} onOpenSource={onOpenSource} />
      ) : null}
      {below}
    </div>
  );
}

export function AskSourceChips({
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

export function AskInlineNodes({
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
        if (node.kind === 'link') {
          return (
            <a
              key={`a-${index}`}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2"
            >
              {node.text}
            </a>
          );
        }
        if (node.kind === 'code') {
          return (
            <code
              key={`c-${index}`}
              className="rounded-sm bg-paper-100 px-1 py-px font-mono text-[0.9em] text-ink-900"
            >
              {node.text}
            </code>
          );
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

export function AskBlocks({
  blocks,
  events,
  onSeek,
}: {
  blocks: AskProseBlock[];
  events: number[];
  onSeek: (atSeconds: number) => void;
}) {
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.kind === 'heading') {
          const Tag = block.level === 3 ? 'h3' : 'h2';
          return (
            <Tag key={`h-${bi}`} className="text-[15px] font-semibold tracking-tight text-ink-900">
              <AskInlineNodes nodes={block.children} events={events} onSeek={onSeek} />
            </Tag>
          );
        }
        if (block.kind === 'code') {
          return (
            <pre
              key={`code-${bi}`}
              className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-paper-50 px-3 py-2 font-mono text-[13px] leading-snug text-ink-900"
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === 'table') {
          return (
            <div key={`tbl-${bi}`} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr>
                    {block.headers.map((cell, ci) => (
                      <th key={`th-${ci}`} className="border-b border-line px-2 py-1.5 font-semibold text-ink-500">
                        <AskInlineNodes nodes={cell} events={events} onSeek={onSeek} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={`tr-${ri}`}>
                      {row.map((cell, ci) => (
                        <td key={`td-${ri}-${ci}`} className="border-b border-line px-2 py-1.5 text-ink-800">
                          <AskInlineNodes nodes={cell} events={events} onSeek={onSeek} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === 'list') {
          return block.ordered ? (
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
          );
        }
        return (
          <p key={`p-${bi}`} className="whitespace-pre-wrap">
            <AskInlineNodes nodes={block.children} events={events} onSeek={onSeek} />
          </p>
        );
      })}
    </>
  );
}

export function AskArtifact({
  markdown,
  events,
  onSeek,
}: {
  markdown: string;
  events: number[];
  onSeek: (atSeconds: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-paper-50 px-3 py-2.5" data-testid="ask-artifact">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          data-testid="ask-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(markdown).then(() => {
              setCopied(true);
            });
          }}
          className="rounded-full border border-line bg-paper-0 px-2.5 py-0.5 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="space-y-2">
        <AskBlocks blocks={parseAskProseBlocks(markdown)} events={events} onSeek={onSeek} />
      </div>
    </div>
  );
}

export function AskAnswerBody({
  jobId,
  text,
  events,
  onSeek,
  onOpenSource,
  onComputerFinished,
}: {
  /** For approval cards (they load and decide by job). */
  jobId?: string;
  text: string;
  events: number[];
  onSeek: (atSeconds: number) => void;
  onOpenSource: (source: AskSourceChip) => void;
  /** Latest answer only: Chat reads a finished Computer task and replies. */
  onComputerFinished?: (task: ComputerTaskView) => void;
}) {
  const extracted = extractAskSources(text);
  const { quotes } = extracted;
  // A proposal waiting on the person (send a text, remove access) renders as an approval card.
  const approvals = extracted.actions.flatMap((action) => {
    const m = /^ask-approval:([0-9a-f-]{36})$/i.exec(action.path ?? '');
    return m ? [m[1]] : [];
  });
  const computerTasks = extracted.actions.filter(
    (action) => action.tool === 'start_computer_task' && !(action.path ?? '').startsWith('ask-approval:'),
  );
  const { prose, artifact } = splitAskArtifact(extracted.body);
  const blocks = parseAskProseBlocks(
    sanitizeSpeakerProse(prose, {
      protect: quotes.flatMap((quote) => (quote.clipTitle ? [quote.clipTitle] : [])),
    }),
  );
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed text-ink-800" data-testid="ask-answer-body">
      {blocks.length ? (
        <AskBlocks blocks={blocks} events={events} onSeek={onSeek} />
      ) : prose ? (
        <p className="whitespace-pre-wrap">{prose}</p>
      ) : null}
      {artifact ? <AskArtifact markdown={artifact} events={events} onSeek={onSeek} /> : null}
      {jobId
        ? approvals.map((id) => <AskApprovalCard key={id} jobId={jobId} approvalId={id} />)
        : null}
      {computerTasks.map((action, i) => (
        <ComputerTaskCard
          key={`${action.path ?? 'computer'}-${i}`}
          path={action.path}
          summary={action.label}
          onFinished={onComputerFinished}
        />
      ))}
      <AskQuoteList quotes={quotes} onOpen={onOpenSource} />
    </div>
  );
}

export function copyableAskText(text: string): string {
  const extracted = extractAskSources(text);
  const { prose, artifact } = splitAskArtifact(extracted.body);
  return [prose.trim(), artifact?.trim()].filter(Boolean).join('\n\n');
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 12.5l6.2-6.2a3 3 0 114.2 4.2l-7.4 7.5a4.5 4.5 0 11-6.4-6.4l7.2-7.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SendIcon() {
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

export function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function TypingDots() {
  return (
    <span className="gpt-typing inline-flex items-center gap-1" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}
