import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import type { ProofResponse, SharedJobRecord } from '../lib/api';
import { usePhoneShell } from '../lib/usePhoneShell';
import { TabPanel, Tabs } from '../design/Tabs';
import { JobAskPanel, type JobAskFn } from './JobAskPanel';
import type { ProofQuestion } from '../lib/api';

type JobFilePane = 'file' | 'ask';

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
 * frame. Desktop pins Ask on the right. A phone (or the 480px app iframe)
 * uses File / Ask tabs so chat is first-class on both surfaces.
 *
 * Never paints an Overview back/breadcrumb. Callers that still pass one are
 * stripped here so File / Ask sit flush under the account header.
 */
export function JobFileAskChrome({
  jobId,
  file,
  back,
  children,
  extra,
  initialPane = 'file',
  ask,
  loadQuestions,
}: {
  jobId: string;
  file?: { record: SharedJobRecord | null; proofs: ProofResponse | null };
  back?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  /** Open Ask first — used by the emailed Ask link (?ask=1). */
  initialPane?: JobFilePane;
  ask?: JobAskFn;
  loadQuestions?: () => Promise<{ questions: ProofQuestion[] }>;
}) {
  const phone = usePhoneShell();
  const [pane, setPane] = useState<JobFilePane>(initialPane);
  const shownBack = back && !isOverviewBack(back) ? back : undefined;

  useEffect(() => {
    setPane(initialPane);
  }, [jobId, initialPane]);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden"
      data-testid="job-file"
      data-job-file-chrome="no-overview-back"
    >
      {phone ? (
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
              <JobAskPanel jobId={jobId} file={file} fill ask={ask} loadQuestions={loadQuestions} />
            </TabPanel>
          </Tabs>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {shownBack ? <div data-testid="job-file-back">{shownBack}</div> : null}
            {children}
          </div>

          <aside
            className="flex min-h-[28rem] w-full shrink-0 flex-col border-t border-line lg:h-full lg:min-h-0 lg:w-[min(32rem,42%)] lg:border-l lg:border-t-0"
            aria-label="Ask this job"
            data-testid="job-file-ask"
          >
            <JobAskPanel jobId={jobId} file={file} fill ask={ask} loadQuestions={loadQuestions} />
          </aside>
        </>
      )}
      {extra}
    </div>
  );
}
