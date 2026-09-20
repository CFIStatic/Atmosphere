import {
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import type { ProofResponse, SharedJobRecord } from '../lib/api';
import { usePhoneShell } from '../lib/usePhoneShell';
import { VideoSeekProvider } from '../lib/videoSeek';
import {
  JobFileFocusListener,
  JobFileFocusProvider,
  useJobFileFocus,
} from '../lib/jobFileFocus';
import {
  clampAskWidth,
  clearAskSplitWidth,
  DEFAULT_ASK_WIDTH_PX,
  MIN_ASK_WIDTH_PX,
  readAskSplitWidth,
  writeAskSplitWidth,
} from '../lib/jobFileAskSplit';
import { TabPanel, Tabs } from '../design/Tabs';
import { JobAskPanel, type JobAskFn } from './JobAskPanel';
import type { AskThread, ProofQuestion } from '../lib/api';

type JobFilePane = 'file' | 'ask';

function JobFileFocusRevealBridge({ reveal }: { reveal: () => void }) {
  const { setRevealFile } = useJobFileFocus();
  useEffect(() => {
    setRevealFile(reveal);
    return () => setRevealFile(undefined);
  }, [reveal, setRevealFile]);
  return null;
}



function reactNodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join('');
  if (isValidElement(node)) {
    return reactNodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/** Overview is a destination in the office shell — never a job-file back row. */
function isOverviewBack(node: ReactNode): boolean {
  if (/^\s*Overview\s*$/i.test(reactNodeText(node))) return true;
  if (!isValidElement(node)) return false;
  const props = node.props as { to?: unknown; href?: unknown; onClick?: unknown };
  const dest = String(props.to ?? props.href ?? '');
  if (
    dest === '/field' ||
    dest === '/overview' ||
    dest.startsWith('/field?') ||
    dest.startsWith('/overview?')
  ) {
    return true;
  }
  return (
    typeof props.onClick === 'function' && /['"`]\/(field|overview)\b/.test(String(props.onClick))
  );
}

/**
 * One job file chrome for the office job file, intake, and the Field Capture
 * frame.
 *
 * Default (`askPlacement="split"`): desktop pins Ask on the left with a drag
 * handle; phone uses File / Ask tabs.
 *
 * Office job progress (`askPlacement="section"`): single-column shell only —
 * Ask lives under the Chat section tab in the page body, not beside the file.
 *
 * Never paints an Overview back/breadcrumb. Callers that still pass one are
 * stripped here so content sits flush under the account header.
 */
export function JobFileAskChrome({
  jobId,
  file,
  back,
  children,
  extra,
  initialPane = 'file',
  pane: paneControlled,
  onPaneChange,
  askPlacement = 'split',
  ask,
  loadQuestions,
  loadThreads,
  createThread,
  renameThread,
}: {
  jobId: string;
  file?: { record: SharedJobRecord | null; proofs: ProofResponse | null };
  back?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  /** Open Ask first — used by the emailed Ask link (?ask=1). */
  initialPane?: JobFilePane;
  /** Controlled File / Ask pane (office section bar Chat tab). */
  pane?: JobFilePane;
  onPaneChange?: (pane: JobFilePane) => void;
  /**
   * `split` — Ask beside the file (default; intake / detail / guest).
   * `section` — no Ask chrome; page renders Ask under the Chat section tab.
   */
  askPlacement?: 'split' | 'section';
  ask?: JobAskFn;
  loadQuestions?: (threadId?: string | null) => Promise<{ questions: ProofQuestion[] }>;
  loadThreads?: () => Promise<{ threads: AskThread[] }>;
  createThread?: (title?: string) => Promise<{ thread: AskThread }>;
  renameThread?: (threadId: string, title: string) => Promise<{ thread: AskThread }>;
}) {
  const phone = usePhoneShell();
  const [paneUncontrolled, setPaneUncontrolled] = useState<JobFilePane>(initialPane);
  const controlled = paneControlled !== undefined;
  const pane = controlled ? paneControlled : paneUncontrolled;
  const setPane = (next: JobFilePane) => {
    if (!controlled) setPaneUncontrolled(next);
    onPaneChange?.(next);
  };
  const shownBack = back && !isOverviewBack(back) ? back : undefined;
  const splitRef = useRef<HTMLDivElement>(null);
  const [askWidth, setAskWidth] = useState(() => readAskSplitWidth());
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_ASK_WIDTH_PX);

  useEffect(() => {
    if (controlled) return;
    setPaneUncontrolled(initialPane);
  }, [jobId, initialPane, controlled]);

  const onSplitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragStartX.current = event.clientX;
      dragStartWidth.current = askWidth;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [askWidth],
  );

  const onSplitPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const container = splitRef.current?.clientWidth ?? 0;
    const next = clampAskWidth(
      dragStartWidth.current + (event.clientX - dragStartX.current),
      container || undefined,
    );
    setAskWidth(next);
  }, []);

  const onSplitPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setAskWidth((w) => writeAskSplitWidth(w));
  }, []);

  const onSplitDoubleClick = useCallback(() => {
    clearAskSplitWidth();
    setAskWidth(DEFAULT_ASK_WIDTH_PX);
  }, []);

  const askPaneStyle = {
    ['--job-file-ask-width' as string]: `${askWidth}px`,
  } as CSSProperties;

  const revealFilePane = useCallback(() => {
    setPane('file');
  }, []);

  return (
    <VideoSeekProvider>
    <JobFileFocusProvider>
    <JobFileFocusListener />
    <JobFileFocusRevealBridge reveal={revealFilePane} />
    <div
      ref={splitRef}
      className={
        askPlacement === 'section'
          ? 'flex h-full min-h-0 flex-1 flex-col'
          : 'flex h-full min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden'
      }
      data-testid="job-file"
      data-job-file-chrome="no-overview-back"
      data-ask-placement={askPlacement}
      data-ask-width={askPlacement === 'split' ? askWidth : undefined}
    >
      {askPlacement === 'section' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-6 pb-4 sm:px-6">
          {shownBack ? (
            <div className="shrink-0" data-testid="job-file-back">
              {shownBack}
            </div>
          ) : null}
          {children}
        </div>
      ) : phone ? (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {shownBack && (
            <div
              className="shrink-0 border-b border-line bg-paper-0 px-3 pt-2"
              data-testid="job-file-back"
            >
              {shownBack}
            </div>
          )}
          <Tabs
            value={pane}
            onValueChange={(value) => setPane(value as JobFilePane)}
            items={[
              { value: 'file', label: 'File' },
              { value: 'ask', label: 'Ask' },
            ]}
            className="flex h-full min-h-0 flex-1 flex-col px-3"
          >
            {/*
              Do not put a bare `flex` utility on these panels. Tailwind's
              display:flex overrides the HTML hidden attribute Radix uses for
              the inactive tab, so File and Ask each take half the phone frame.
            */}
            <TabPanel
              value="file"
              className="min-h-0 flex-1 overflow-y-auto px-1 py-4 outline-none data-[state=inactive]:hidden"
            >
              {children}
            </TabPanel>
            <TabPanel
              value="ask"
              className="min-h-0 flex-1 flex-col outline-none data-[state=active]:flex data-[state=inactive]:hidden"
              aria-label="Ask this job"
              data-testid="job-file-ask"
            >
              <JobAskPanel jobId={jobId} file={file} fill ask={ask} loadQuestions={loadQuestions} loadThreads={loadThreads} createThread={createThread} renameThread={renameThread} />
            </TabPanel>
          </Tabs>
        </div>
      ) : (
        <>
          <aside
            className="flex min-h-[28rem] w-full shrink-0 flex-col border-t border-line lg:h-full lg:min-h-0 lg:w-[var(--job-file-ask-width)] lg:border-t-0"
            style={askPaneStyle}
            aria-label="Ask this job"
            data-testid="job-file-ask"
          >
            <JobAskPanel jobId={jobId} file={file} fill ask={ask} loadQuestions={loadQuestions} loadThreads={loadThreads} createThread={createThread} renameThread={renameThread} />
          </aside>

          {/*
            Desktop Ask | job-file splitter: always-visible grip + brand tint on
            hover/drag, wide hit target, col-resize. Phone tabs unchanged.
          */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Ask and job file"
            aria-valuenow={askWidth}
            aria-valuemin={MIN_ASK_WIDTH_PX}
            title="Drag to resize · double-click to reset"
            data-testid="job-file-ask-split"
            data-dragging={dragging ? 'true' : undefined}
            tabIndex={0}
            className={`group relative z-10 hidden w-0 shrink-0 cursor-col-resize touch-none outline-none lg:block ${
              dragging ? 'select-none' : ''
            }`}
            onPointerDown={onSplitPointerDown}
            onPointerMove={onSplitPointerMove}
            onPointerUp={onSplitPointerUp}
            onPointerCancel={onSplitPointerUp}
            onDoubleClick={onSplitDoubleClick}
          >
            {/* Hit target wider than the painted line so grab is easy. */}
            <span aria-hidden className="absolute inset-y-0 -left-2 w-4" />
            {/* Track line — thicker + brand on hover / focus / drag. */}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 left-0 transition-[width,background-color,box-shadow] ${
                dragging
                  ? 'w-0.5 bg-brand-400 shadow-[0_0_0_1px_rgb(var(--brand-400)/0.35)]'
                  : 'w-0.5 bg-line group-hover:bg-brand-300 group-focus-visible:bg-brand-300'
              }`}
            />
            {/* Centered grip pill so the split reads as adjustable at rest. */}
            <span
              aria-hidden
              data-testid="job-file-ask-split-grip"
              className={`pointer-events-none absolute left-0 top-1/2 flex h-9 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition ${
                dragging
                  ? 'border-brand-400/70 bg-paper-0 text-brand-400'
                  : 'border-line bg-paper-0 text-ink-500 group-hover:border-brand-300/80 group-hover:text-brand-400 group-focus-visible:border-brand-300/80 group-focus-visible:text-brand-400'
              }`}
            >
              <GripVertical className="h-3.5 w-3.5" strokeWidth={2.25} />
            </span>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {shownBack ? <div data-testid="job-file-back">{shownBack}</div> : null}
            {children}
          </div>
        </>
      )}
      {extra}
    </div>
    </JobFileFocusProvider>
    </VideoSeekProvider>
  );
}
