import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type JobFileFocusSection =
  | 'access'
  | 'scope'
  | 'videos'
  | 'evidence'
  | 'parties'
  | 'setup'
  | 'brief';

export type JobFileFocusTarget = {
  section: JobFileFocusSection;
  workDate?: string;
  /** Bump so repeat clicks on the same target still fire. */
  nonce?: number;
};

type JobFileFocusContextValue = {
  request: JobFileFocusTarget | null;
  focus: (target: Omit<JobFileFocusTarget, 'nonce'> & { nonce?: number }) => void;
  /** Phone File/Ask tabs — switch to the job file before scrolling. */
  revealFile?: () => void;
  setRevealFile: (fn: (() => void) | undefined) => void;
};

const JobFileFocusContext = createContext<JobFileFocusContextValue>({
  request: null,
  focus: () => undefined,
  setRevealFile: () => undefined,
});

export function JobFileFocusProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<JobFileFocusTarget | null>(null);
  const [revealFile, setRevealFileState] = useState<(() => void) | undefined>(undefined);

  const focus = useCallback((target: Omit<JobFileFocusTarget, 'nonce'> & { nonce?: number }) => {
    setRequest({
      ...target,
      nonce: target.nonce ?? Date.now(),
    });
  }, []);

  const setRevealFile = useCallback((fn: (() => void) | undefined) => {
    setRevealFileState(() => fn);
  }, []);

  const value = useMemo(
    () => ({ request, focus, revealFile, setRevealFile }),
    [request, focus, revealFile, setRevealFile],
  );

  return <JobFileFocusContext.Provider value={value}>{children}</JobFileFocusContext.Provider>;
}

export function useJobFileFocus(): JobFileFocusContextValue {
  return useContext(JobFileFocusContext);
}

/**
 * Scroll/open the matching job-file section when Ask source chips fire.
 * Opens the Job setup <details> when needed.
 */
export function JobFileFocusListener() {
  const { request, revealFile } = useJobFileFocus();

  useEffect(() => {
    if (!request) return;
    revealFile?.();

    const run = () => {
      const setup = document.querySelector<HTMLDetailsElement>('[data-job-section="setup"]');
      if (
        setup &&
        (request.section === 'scope' ||
          request.section === 'parties' ||
          request.section === 'setup' ||
          request.section === 'brief')
      ) {
        setup.open = true;
      }

      const el =
        document.querySelector<HTMLElement>(`[data-job-section="${request.section}"]`) ??
        (request.section === 'brief'
          ? document.querySelector<HTMLElement>('[data-job-section="setup"]')
          : null);
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-brand-300');
      window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-brand-300');
      }, 1200);

      if (request.workDate && request.section === 'videos') {
        const clip = document.querySelector<HTMLElement>(
          `[data-job-clip-date="${request.workDate}"]`,
        );
        clip?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    // Let the phone tab / details open paint before scrolling.
    const t = window.setTimeout(run, 40);
    return () => window.clearTimeout(t);
  }, [request, revealFile]);

  return null;
}
