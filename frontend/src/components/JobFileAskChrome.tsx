import { useEffect, useState, type ReactNode } from 'react';
import type { ProofResponse, SharedJobRecord } from '../lib/api';
import { usePhoneShell } from '../lib/usePhoneShell';
import { TabPanel, Tabs } from '../design/Tabs';
import { JobAskPanel } from './JobAskPanel';

type JobFilePane = 'file' | 'ask';

/**
 * One job file chrome for Overview, Job Files, intake, and the Field Capture
 * frame. Desktop pins Ask on the right. A phone (or the 480px app iframe)
 * uses File / Ask tabs so chat is first-class on both surfaces.
 */
export function JobFileAskChrome({
  jobId,
  file,
  back,
  children,
  extra,
}: {
  jobId: string;
  file?: { record: SharedJobRecord | null; proofs: ProofResponse | null };
  back?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
}) {
  const phone = usePhoneShell();
  const [pane, setPane] = useState<JobFilePane>('file');

  useEffect(() => {
    setPane('file');
  }, [jobId]);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden"
      data-testid="job-file"
    >
      {phone ? (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {back && (
            <div className="shrink-0 border-b border-line bg-paper-0 px-3 pt-2">{back}</div>
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
              <JobAskPanel jobId={jobId} file={file} fill />
            </TabPanel>
          </Tabs>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {back}
            {children}
          </div>

          <aside
            className="flex min-h-[28rem] w-full shrink-0 flex-col border-t border-line lg:h-full lg:min-h-0 lg:w-[min(32rem,42%)] lg:border-l lg:border-t-0"
            aria-label="Ask this job"
            data-testid="job-file-ask"
          >
            <JobAskPanel jobId={jobId} file={file} fill />
          </aside>
        </>
      )}
      {extra}
    </div>
  );
}
