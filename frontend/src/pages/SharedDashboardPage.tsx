import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type SharedJobSummary, type SharedJobRecord, type IntakeCaptureInvite } from '../lib/api';
import { JobFileAskChrome } from '../components/JobFileAskChrome';
import { JobAskPanel } from '../components/JobAskPanel';
import { ShareJobProgressPanel } from '../components/shared/ShareJobProgressPanel';
import { JobAccessRoster } from '../components/shared/JobAccessRoster';
import { EvidenceLocker } from '../components/shared/EvidenceLocker';
import { ProofOfWork } from '../components/shared/ProofOfWork';
import { JobFileActions } from '../components/shared/JobFileActions';
import { UnpaidJobEvaluation } from '../components/shared/UnpaidJobEvaluation';
import { useProductActionsLocked } from '../components/billing/ProductActionLock';
import { JobFileTodayStrip } from '../components/shared/JobFileTodayStrip';
import { JobTimeline } from '../components/shared/JobTimeline';
import {
  JobFileSectionBar,
  type JobFileSectionId,
  type JobFileSectionTab,
} from '../components/shared/JobFileSectionBar';
import { initialJobFileSection, timelineRedirectSearch } from '../components/shared/jobTimeline';
import { jobFilePath } from '../lib/jobFileAsk';
import { touchJobFile } from '../lib/jobFileRecents';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useAuth } from '../context/AuthContext';
import { HOMEOWNER_HUB_PATH } from '../lib/homeownerHub';

type HandoffState = {
  freshJob?: SharedJobSummary;
  freshRecord?: SharedJobRecord;
  freshInvites?: IntakeCaptureInvite[];
  justApproved?: boolean;
};

/**
 * One job, two companies, one record.
 *
 * A general contractor hires subs, and the money is lost in a narrow set of
 * places that are all the same failure underneath — the two sides were working
 * from different facts. "Who told you to demo that wall." "The super said it
 * was fine." "I was working off the old scope." Everything was said out loud,
 * on a phone, in a truck, and nothing survived it.
 *
 * So this is not a chat feature with a job attached. It is a record, with a
 * conversation attached, and three things carry the weight:
 *
 *   What NOT to do comes first. A scope list that only says what to do leaves
 *   "and nothing else" to be inferred, and it never is. Exclusions are rows
 *   with reasons, at the top of the screen, because whoever is reading this is
 *   reading it on a phone and the top of the screen is where they stop.
 *
 *   Acceptance is versioned. Publishing new facts lapses everybody's
 *   acceptance rather than carrying it silently forward, and the page says who
 *   that just affected — quietly invalidating four subs' sign-off is a thing
 *   somebody should be told they are doing.
 *
 *   Decisions happen before the work. A request sitting unanswered for a day
 *   is a blocker, not a to-do, because at that point the crew either goes home
 *   or does it anyway, and doing it anyway is the whole thing being prevented.
 */

function placeholderRecord(
  jobId: string,
  title: string,
  jobNumber: number | null = null,
): SharedJobRecord {
  return {
    job: { id: jobId, jobNumber, title, status: null, claimNumber: null },
    brief: null,
    revisions: [],
    currentRevision: null,
    parties: [],
    scope: [],
    money: { approved: 0, pending: 0, unpricedApprovals: 0 },
    messages: [],
    risks: [],
  };
}

export function SharedDashboardPage() {
  const { membership } = useAuth();
  const actionsLocked = useProductActionsLocked();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedJob = searchParams.get('job');
  const requestedTitle = searchParams.get('title');
  const requestedNumber = searchParams.get('number');
  /** Field Capture / emailed Ask links open the Ask tab (?ask=1). */
  const openAsk = searchParams.get('ask') === '1';
  const parsedNumber =
    requestedNumber != null && requestedNumber !== '' ? Number(requestedNumber) : null;
  const jobNumberHint = Number.isFinite(parsedNumber) ? parsedNumber : null;
  const handoff = (location.state as HandoffState | null) ?? null;
  const freshFromNav = handoff?.freshJob;
  const freshRecord = handoff?.freshRecord;
  const [justApproved, setJustApproved] = useState(Boolean(handoff?.justApproved));
  const [freshInvites, setFreshInvites] = useState<IntakeCaptureInvite[]>(
    () => handoff?.freshInvites ?? [],
  );
  useFeatureTimer('job_files');
  const openSeq = useRef(0);
  const recordIdRef = useRef<string | null>(freshRecord?.job.id ?? requestedJob ?? null);
  const seededId = requestedJob || freshFromNav?.jobId || freshRecord?.job.id || null;

  const [list, setList] = useState<SharedJobSummary[] | null>(() =>
    freshFromNav ? [freshFromNav] : null,
  );
  const [openId, setOpenId] = useState<string | null>(seededId);
  const [record, setRecord] = useState<SharedJobRecord | null>(
    () =>
      freshRecord ??
      (requestedJob
        ? placeholderRecord(requestedJob, requestedTitle || 'Job', jobNumberHint)
        : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [shareFormOpen, setShareFormOpen] = useState(false);
  /** Chat by default. A legacy Happening Now / Job history link opens Timeline before paint. */
  const [section, setSection] = useState<JobFileSectionId>(() =>
    initialJobFileSection(location.search, location.hash),
  );
  const askLink =
    openAsk && !timelineRedirectSearch(location.search, location.hash);
  const askKey = askLink ? `${openId ?? ''}:${location.search}` : '';
  const [seenAsk, setSeenAsk] = useState(askKey);
  if (askLink && askKey !== seenAsk) {
    setSeenAsk(askKey);
    setSection('chat');
  }

  const stayOnRecord = Boolean(requestedJob || freshFromNav || freshRecord);
  const viewerOnly = record?.access === 'viewer';
  const grantViewer = viewerOnly || (!membership && Boolean(requestedJob));

  useEffect(() => {
    recordIdRef.current = record?.job.id ?? null;
  }, [record]);

  useEffect(() => {
    if (openId) touchJobFile(openId);
  }, [openId]);

  useEffect(() => {
    const next = timelineRedirectSearch(location.search, location.hash);
    if (!next) return;
    navigate(
      { pathname: location.pathname, search: next, hash: '' },
      { replace: true, state: location.state },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!stayOnRecord) navigate('/verifier-library', { replace: true });
  }, [stayOnRecord, navigate]);

  function openShare() {
    setShareFormOpen(true);
  }

  function ensureListed(summary: SharedJobSummary) {
    setList((prev) => {
      const base = prev ?? [];
      if (base.some((j) => j.jobId === summary.jobId)) return base;
      return [summary, ...base];
    });
  }

  async function openJob(jobId: string, opts?: { syncUrl?: boolean }) {
    const seq = ++openSeq.current;
    setOpenId(jobId);
    setShareFormOpen(false);
    if (opts?.syncUrl !== false) {
      // Preserve intake handoff state — setSearchParams drops it otherwise.
      const next: Record<string, string> = jobId ? { job: jobId } : {};
      if (requestedTitle) next.title = requestedTitle;
      if (requestedNumber) next.number = requestedNumber;
      const keepTimeline =
        section === 'timeline' ||
        searchParams.get('section') === 'timeline' ||
        Boolean(timelineRedirectSearch(location.search, location.hash));
      if (keepTimeline) next.section = 'timeline';
      else if (openAsk) next.ask = '1';
      setSearchParams(next, {
        replace: true,
        state: location.state,
      });
    }
    setError(null);
    try {
      const next = await api.sharedJob(jobId);
      if (seq !== openSeq.current) return;
      setRecord(next);
      ensureListed({
        jobId,
        jobNumber: next.job.jobNumber ?? null,
        title: next.job.title,
        status: next.job.status ?? null,
        parties: next.parties?.length ?? 0,
        currentRevision: next.brief?.revision ?? next.currentRevision ?? null,
        behind: 0,
        awaiting: 0,
        exclusions: 0,
      });
    } catch {
      if (seq !== openSeq.current) return;
      // Never wipe a just-created job file on a flaky GET — keep the handoff.
      if (recordIdRef.current === jobId) {
        // keep painted record; soft-fail
      } else {
        const listed = (list ?? []).find((j) => j.jobId === jobId);
        setRecord(
          placeholderRecord(
            jobId,
            listed?.title || requestedTitle || 'Job',
            listed?.jobNumber ?? jobNumberHint,
          ),
        );
        setError(null);
      }
    }
  }

  async function loadList() {
    try {
      const res = await api.sharedJobs();
      setList((prev) => {
        const incoming = res.jobs;
        if (!prev?.length) return incoming;
        // Keep a freshly opened intake job if the list query briefly omits it.
        const extras = prev.filter((j) => !incoming.some((i) => i.jobId === j.jobId));
        return extras.length ? [...extras, ...incoming] : incoming;
      });
      const preferred =
        requestedJob ||
        freshFromNav?.jobId ||
        freshRecord?.job.id ||
        (openId && res.jobs.some((j) => j.jobId === openId) && openId) ||
        res.jobs[0]?.jobId ||
        null;
      if (preferred) {
        // Refresh detail in background; syncUrl only when deep-linked.
        void openJob(preferred, {
          syncUrl: Boolean(requestedJob || freshFromNav || freshRecord),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the shared records.');
      setList((prev) => prev ?? []);
      const fallback = requestedJob || freshFromNav?.jobId || freshRecord?.job.id;
      if (fallback) void openJob(fallback, { syncUrl: Boolean(requestedJob) });
    }
  }

  useEffect(() => {
    if (!stayOnRecord) return;
    if (freshFromNav) ensureListed(freshFromNav);
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link from Dashboard job name or Approve & invite: /job-progress?job=<id>
  // When intake already seeded the file, loadList's refresh is enough — a
  // second openJob here raced and could leave the dashboard stuck on Loading.
  useEffect(() => {
    if (!requestedJob) return;
    if (freshFromNav?.jobId === requestedJob) ensureListed(freshFromNav);
    if (recordIdRef.current === requestedJob || freshRecord?.job.id === requestedJob) return;
    void openJob(requestedJob, { syncUrl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedJob]);

  if (!stayOnRecord) return null;

  const jobId = record?.job.id ?? requestedJob ?? '';

  const fileBody = (
    <div className="flex min-h-0 flex-1 flex-col" data-job-section={section}>
      <header
        className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3"
        data-job-file-header=""
      >
        <h1 className="min-w-0 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          {record?.job.title ?? 'Job'}
        </h1>
        {grantViewer ? (
          <Link
            to={HOMEOWNER_HUB_PATH}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
            data-testid="your-job-files"
          >
            Your job files
          </Link>
        ) : record && !viewerOnly ? (
          <JobFileActions
            jobId={record.job.id}
            title={record.job.title}
            onShare={openShare}
            onRenamed={(nextTitle) => {
              setRecord((prev) =>
                prev ? { ...prev, job: { ...prev.job, title: nextTitle } } : prev,
              );
              setList((prev) =>
                (prev ?? []).map((job) =>
                  job.jobId === record.job.id ? { ...job, title: nextTitle } : job,
                ),
              );
              if (requestedJob === record.job.id) {
                const next: Record<string, string> = { job: record.job.id, title: nextTitle };
                if (requestedNumber) next.number = requestedNumber;
                if (section === 'timeline') next.section = 'timeline';
                else if (openAsk) next.ask = '1';
                setSearchParams(next, { replace: true, state: location.state });
              }
            }}
            onDuplicated={({ jobId: nextId, title: nextTitle, summary }) => {
              ensureListed(summary);
              navigate(jobFilePath(nextId, { title: nextTitle }), {
                state: { freshJob: summary },
              });
            }}
          />
        ) : null}
      </header>

      {actionsLocked && record ? <UnpaidJobEvaluation jobId={record.job.id} /> : null}

      {record && <JobFileTodayStrip jobId={record.job.id} record={record} />}

      {justApproved && record && (
        <div
          role="status"
          className="mt-4 space-y-3 rounded-xl border border-success-200 bg-success-50/70 px-4 py-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-success-700">Job created</p>
              <p className="mt-0.5 text-sm text-ink-700">
                <span className="font-medium text-ink-900">{record.job.title}</span> is ready
                {freshInvites.length
                  ? freshInvites.every((i) => i.emailed || !i.email)
                    ? ' — Field Capture invites went out.'
                    : ' — some invites could not be emailed.'
                  : '.'}{' '}
                Footage will land on the Dashboard as they film.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-ink-500 hover:text-ink-800"
              onClick={() => {
                setJustApproved(false);
                setFreshInvites([]);
              }}
            >
              Dismiss
            </button>
          </div>
          {freshInvites.length > 0 && (
            <ul className="space-y-2 border-t border-success-200/70 pt-3">
              {freshInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-0/70 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{inv.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {inv.email ?? 'No email on file'}
                      {' · '}
                      {inv.emailed
                        ? 'Emailed'
                        : inv.email
                          ? 'Email did not send'
                          : 'Invite created'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {record ? (
        <JobFileSections
          record={record}
          section={section}
          onSectionChange={setSection}
          grantViewer={grantViewer}
          viewerOnly={viewerOnly}
          office={!viewerOnly && !grantViewer}
          onOpenHref={(href) => navigate(href)}
        />
      ) : (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      )}
    </div>
  );

  return (
    <JobFileAskChrome
      jobId={jobId}
      askPlacement="section"
      initialPane="ask"
      pane={section === 'chat' ? 'ask' : 'file'}
      onPaneChange={(next) => {
        if (next === 'ask') setSection('chat');
        else if (section === 'chat') setSection('timeline');
      }}
      extra={
        shareFormOpen && record ? (
          <ShareJobProgressPanel
            jobId={record.job.id}
            creating
            modal
            onClose={() => setShareFormOpen(false)}
            onCreatingChange={setShareFormOpen}
          />
        ) : null
      }
    >
      {fileBody}
    </JobFileAskChrome>
  );
}

function JobFileSections({
  record,
  section,
  onSectionChange,
  grantViewer,
  viewerOnly,
  office,
  onOpenHref,
}: {
  record: SharedJobRecord;
  section: JobFileSectionId;
  onSectionChange: (id: JobFileSectionId) => void;
  grantViewer: boolean;
  viewerOnly: boolean;
  office: boolean;
  onOpenHref?: (href: string) => void;
}) {
  const tabs = useMemo(() => {
    const next: JobFileSectionTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'timeline', label: 'Timeline' },
    ];
    if (!grantViewer) next.push({ id: 'access', label: 'Access' });
    if (!viewerOnly) {
      next.push(
        { id: 'videos', label: 'Videos' },
        { id: 'evidence', label: 'Evidence report' },
      );
    }
    return next;
  }, [grantViewer, viewerOnly]);

  const active = tabs.some((t) => t.id === section) ? section : 'chat';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-job-file-sections="">
      <div className="shrink-0">
        <JobFileSectionBar tabs={tabs} active={active} onChange={onSectionChange} />
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`job-file-section-${active}`}
        data-testid={`job-file-section-panel-${active}`}
        className={
          active === 'chat' || active === 'timeline'
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'min-h-0 flex-1 overflow-y-auto'
        }
      >
        {active === 'chat' ? (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper-50"
            aria-label="Ask this job"
            data-testid="job-file-ask"
          >
            <JobAskPanel jobId={record.job.id} fill onOpenHref={onOpenHref} officeExtras={!grantViewer} />
          </div>
        ) : null}

        {active === 'timeline' ? (
          <JobTimeline key={record.job.id} jobId={record.job.id} record={record} office={office} />
        ) : null}

        {active === 'access' && !grantViewer ? <JobAccessRoster jobId={record.job.id} /> : null}

        {active === 'videos' && !viewerOnly ? (
          <ProofOfWork jobId={record.job.id} heading="Videos" showCollectionAsk={false} />
        ) : null}

        {active === 'evidence' && !viewerOnly ? <EvidenceLocker jobId={record.job.id} /> : null}
      </div>
    </div>
  );
}
