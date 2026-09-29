import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { api, type CaptureTeamMember, type IntakeProposal } from '../lib/api';
import { jobFilePath } from '../lib/jobFileAsk';
import {
  INTAKE_SAMPLE,
  isInviteEmail,
  membersToCaptureTeam,
  scopeFromSituation,
  startJobActionLabel,
  workTypeFromSituation,
} from '../lib/intakeForm';
import { usePhoneShell } from '../lib/usePhoneShell';
import { cn } from '../design';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useExperiment } from '../hooks/useExperiment';

/**
 * Office Start a job — modeled on the field app's New job: a job name, an
 * optional note, and one button. Invites and homeowner sharing sit behind a
 * disclosure; the button reads "Create job" until someone is on the list,
 * then "Create & send invites".
 *
 * One page. Creates the job file, publishes a brief, and can invite Field Capture.
 *
 * Field Capture's Platform tab is a 480px iframe. Four padded desktop cards
 * do not fit that frame — they stack past the fold and leave the approve
 * button off-screen. On a phone the form is one job card plus invites, with
 * the action pinned to the thumb.
 */

type ExternalInvite = {
  id: string;
  fullName: string;
  company: string;
  email: string;
};

const DEFAULT_BRIEF =
  'No work description yet. Field Capture can still film — AI will describe what happened from the video.';

export function JobIntakePage() {
  const navigate = useNavigate();
  const phone = usePhoneShell();
  useFeatureTimer('job_intake');
  // Conversion is still tracked; the button copy now follows the invite list.
  const intakeCta = useExperiment('intake_cta_copy');

  const [name, setName] = useState('');
  const [situation, setSituation] = useState('');
  const [captureTeam, setCaptureTeam] = useState<CaptureTeamMember[]>([]);
  const [externals, setExternals] = useState<ExternalInvite[]>([]);
  const [extName, setExtName] = useState('');
  const [extCompany, setExtCompany] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [homeownerEmail, setHomeownerEmail] = useState('');
  const [shareWithHomeowner, setShareWithHomeowner] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMembers()
      .then(({ members }) => {
        if (!cancelled) setCaptureTeam(membersToCaptureTeam(members));
      })
      .catch(() => {
        if (!cancelled) setCaptureTeam([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCount = useMemo(
    () => captureTeam.filter((m) => m.selected).length,
    [captureTeam],
  );

  function addExternal() {
    const email = extEmail.trim().toLowerCase();
    const fullName = extName.trim();
    const company = extCompany.trim() || fullName;
    if (!fullName) {
      setError('Add a name for the subcontractor.');
      return;
    }
    if (!isInviteEmail(email)) {
      setError('Enter a valid email to invite someone outside the company.');
      return;
    }
    if (externals.some((x) => x.email === email)) {
      setError('That email is already on the invite list.');
      return;
    }
    setError(null);
    setExternals((list) => [
      ...list,
      { id: `ext-${Date.now()}-${list.length}`, fullName, company, email },
    ]);
    setExtName('');
    setExtCompany('');
    setExtEmail('');
  }

  function buildProposal(): IntakeProposal {
    const note = situation.trim();
    const scope = scopeFromSituation(note);
    return {
      title: name.trim(),
      workType: workTypeFromSituation(note),
      address: '',
      city: '',
      postalCode: '',
      claimNumber: '',
      briefNote: note || DEFAULT_BRIEF,
      facts: {
        ...(note ? { Work: note.slice(0, 500) } : {}),
        Source: note ? 'Name and work description' : 'Name only — work description optional',
      },
      scope,
      party: {
        company: 'Field Capture',
        trade: 'field_capture',
        contactName: '',
      },
      source: 'heuristic',
      summary: note
        ? 'Job drafted from the name and what needs to be done.'
        : 'Job drafted from the name.',
    };
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a job name.');
      return;
    }
    const ownerEmailInput = homeownerEmail.trim().toLowerCase();
    if (shareWithHomeowner && !isInviteEmail(ownerEmailInput)) {
      setInvitesOpen(true);
      setError('Enter the homeowner’s email, or turn off homeowner sharing.');
      return;
    }
    setBusy(true);
    setError(null);
    const proposal = buildProposal();
    const invitees = [
      ...captureTeam
        .filter((m) => m.selected)
        .map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
          email: m.email,
          trade: 'field_capture' as const,
          external: false,
        })),
      ...externals.map((x) => ({
        fullName: x.fullName,
        company: x.company,
        email: x.email,
        trade: 'subcontractor',
        external: true,
      })),
    ];
    try {
      const scope = proposal.scope.filter((line) => line.title.trim().length > 0);
      const res = await api.approveIntake({
        title: proposal.title,
        workType: proposal.workType,
        briefNote: proposal.briefNote,
        facts: proposal.facts,
        scope,
        invitees,
      });
      intakeCta.track('conversion', {
        inviteCount: invitees.length,
        scopeLines: scope.length,
      });
      const ownerEmail = ownerEmailInput;
      if (shareWithHomeowner && isInviteEmail(ownerEmail)) {
        try {
          await api.createProgressShare({
            jobId: res.job.id,
            label: ownerEmail,
            recipientEmail: ownerEmail,
          });
        } catch {
          // Homeowner link is best-effort; the job file still opens.
        }
      }
      // Invite emails already went out from approveIntake — go straight to
      // the new job file instead of a confirmation screen.
      navigate(jobFilePath(res.job.id, { title: res.job.title, number: res.job.jobNumber }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the job.');
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(userId: string) {
    setCaptureTeam((team) =>
      team.map((m) => (m.userId === userId ? { ...m, selected: !m.selected } : m)),
    );
  }

  function setAllSelected(selected: boolean) {
    setCaptureTeam((team) => team.map((m) => ({ ...m, selected })));
  }

  function clearInvites() {
    setAllSelected(false);
    setExternals([]);
  }

  const invitedCount = selectedCount + externals.length;
  const actionLabel = startJobActionLabel({
    invited: invitedCount,
    homeownerShare: shareWithHomeowner,
  });
  const peopleSummary = [
    invitedCount > 0 ? `${invitedCount} invited` : null,
    shareWithHomeowner ? 'homeowner' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const cardPad = phone ? 'p-3.5' : 'p-5';
  const sectionTitle = phone ? 'text-[15px] font-semibold text-ink-900' : 'text-base font-semibold text-ink-900';
  const sectionHint = phone ? 'mt-0.5 text-[13px] leading-snug text-ink-600' : 'mt-1 text-sm text-ink-600';
  const fieldLabel = phone ? 'block text-[13px] font-medium text-ink-700' : 'block text-sm font-medium text-ink-700';

  return (
    <div
      data-testid="start-job"
      className={phone ? 'flex min-h-0 min-w-0 flex-1 flex-col' : undefined}
    >
      {phone ? (
        <div className="min-w-0 shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Start a job</h1>
          <p className="mt-1 text-[13px] leading-snug text-ink-600">
            Name it, then start. A note and invites are optional.
          </p>
        </div>
      ) : (
        <PageHeader
          title="Start a job"
          description="Name it, then start. A note and invites are optional."
        />
      )}

      {error && (
        <p role="alert" className={cn('text-sm text-danger-600', phone ? 'mb-2 mt-2' : 'mb-4')}>
          {error}
        </p>
      )}

      <form
        onSubmit={onApprove}
        className={cn(
          'animate-fade-in-up',
          phone ? 'mt-3 flex min-h-0 min-w-0 flex-1 flex-col' : 'mx-auto max-w-2xl space-y-4',
        )}
      >
        <div
          className={
            phone
              ? 'min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
              : 'contents'
          }
        >
          <div className={cn('rounded-xl glass-card', cardPad)}>
            <label className={fieldLabel}>
              Job name
              <input
                className="glass-field mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoComplete="off"
                placeholder="East Racine Avenue"
              />
            </label>

            <div className={cn('flex items-baseline justify-between gap-2', phone ? 'mt-3.5' : 'mt-4')}>
              <label htmlFor="start-job-note" className={fieldLabel}>
                Note <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-brand-600"
                onClick={() => {
                  setSituation(INTAKE_SAMPLE.situation);
                }}
              >
                Use a sample note
              </button>
            </div>
            <textarea
              id="start-job-note"
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Extract standing water in the living room. Set drying equipment."
              className="glass-field mt-1.5 w-full resize-y rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400"
            />
            <p className="mt-1 text-xs text-ink-500">What needs to be done. AI describes the film either way.</p>
          </div>

          <div className={cn('rounded-xl glass-card', cardPad)}>
            <button
              type="button"
              aria-expanded={invitesOpen}
              aria-controls="start-job-people"
              onClick={() => setInvitesOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0">
                <span className={cn('block', sectionTitle)}>Invite people</span>
                <span className={cn('block', sectionHint)}>
                  {peopleSummary
                    ? peopleSummary
                    : 'Optional. Crew, outside workers, or the homeowner — or do it later from the job file.'}
                </span>
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
                className={cn('shrink-0 text-ink-500 transition-transform', invitesOpen && 'rotate-180')}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {invitesOpen && (
              <div id="start-job-people" className={phone ? 'mt-3' : 'mt-4'}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink-900">Invite list</h2>
                  {(captureTeam.length > 0 || externals.length > 0) && (
                    <div className="flex shrink-0 gap-2 text-xs font-medium">
                      {captureTeam.length > 0 && (
                        <button type="button" className="text-brand-600" onClick={() => setAllSelected(true)}>
                          Invite all
                        </button>
                      )}
                      {captureTeam.length > 0 && <span className="text-ink-400">·</span>}
                      <button type="button" className="text-ink-500" onClick={clearInvites}>
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  Each person gets a capture link for this job only. Teammates can also film from
                  Field Capture without an invite.
                </p>

                {captureTeam.length === 0 && externals.length === 0 ? (
                  <p className={cn(phone ? 'mt-3 text-[13px] leading-snug text-ink-600' : 'mt-3 text-sm text-ink-600')}>
                    No teammates in this org yet. Add someone by email — they only see this job.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-line/50">
                    {captureTeam.map((m) => (
                      <li
                        key={m.userId}
                        className={cn(
                          'flex min-w-0 items-center gap-3 first:pt-0 last:pb-0',
                          phone ? 'py-2' : 'py-2.5',
                        )}
                      >
                        <input
                          id={`capture-${m.userId}`}
                          type="checkbox"
                          checked={m.selected}
                          onChange={() => toggleMember(m.userId)}
                          className="h-4 w-4 shrink-0 rounded border-line text-brand-600"
                        />
                        <label htmlFor={`capture-${m.userId}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {m.fullName}
                          </span>
                          <span className="block truncate text-xs text-ink-500">
                            {[m.email, m.workType].filter(Boolean).join(' · ') || m.role}
                          </span>
                        </label>
                      </li>
                    ))}
                    {externals.map((x) => (
                      <li
                        key={x.id}
                        className={cn(
                          'flex min-w-0 items-center gap-3 first:pt-0 last:pb-0',
                          phone ? 'py-2' : 'py-2.5',
                        )}
                      >
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {x.fullName}
                          </span>
                          <span className="block truncate text-xs text-ink-500">
                            {[x.company !== x.fullName ? x.company : null, x.email]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-xs font-medium text-ink-500 hover:text-danger-600"
                          onClick={() => setExternals((list) => list.filter((i) => i.id !== x.id))}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-ink-500">{invitedCount} invited</p>

                <div className={cn('border-t border-line/50', phone ? 'mt-3.5 pt-3' : 'mt-4 pt-4')}>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block text-xs font-medium text-ink-600">
                      Contact name
                      <input
                        className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                        value={extName}
                        onChange={(e) => setExtName(e.target.value)}
                        placeholder="Alex Rivera"
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addExternal();
                          }
                        }}
                      />
                    </label>
                    <label className="block text-xs font-medium text-ink-600">
                      Company
                      <input
                        className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                        value={extCompany}
                        onChange={(e) => setExtCompany(e.target.value)}
                        placeholder="Rio Grande Mitigation"
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addExternal();
                          }
                        }}
                      />
                    </label>
                    <label className="block text-xs font-medium text-ink-600">
                      Email
                      <input
                        type="email"
                        className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                        value={extEmail}
                        onChange={(e) => setExtEmail(e.target.value)}
                        placeholder="alex@example.com"
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addExternal();
                          }
                        }}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => addExternal()}
                    className={cn('font-medium text-brand-600', phone ? 'mt-2.5 text-[13px]' : 'mt-3 text-sm')}
                  >
                    Add
                  </button>
                </div>

                <div className={cn('border-t border-line/50', phone ? 'mt-3.5 pt-3' : 'mt-4 pt-4')}>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={shareWithHomeowner}
                      onChange={(e) => setShareWithHomeowner(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-900">Share with the homeowner</span>
                      <span className="block text-xs text-ink-500">Optional. No account needed.</span>
                    </span>
                  </label>

                  {shareWithHomeowner && (
                    <div className="mt-3 space-y-3">
                      <label className="block text-xs font-medium text-ink-600">
                        Homeowner email
                        <input
                          type="email"
                          className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                          value={homeownerEmail}
                          onChange={(e) => setHomeownerEmail(e.target.value)}
                          placeholder="jordan@example.com"
                        />
                      </label>
                      <div
                        data-testid="homeowner-disclosure"
                        className="rounded-lg border border-line bg-paper-0/70 px-3.5 py-3 text-xs leading-relaxed text-ink-700"
                      >
                        <p className="font-semibold text-ink-900">What the homeowner will see</p>
                        <p className="mt-1">
                          {homeownerEmail.trim() ? homeownerEmail.trim() : 'The homeowner'} gets an
                          email with a private link to this job file:
                        </p>
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                          <li>The job name and its progress</li>
                          <li>Every recording on this job, with its transcript and AI summary</li>
                          <li>Answers to questions they ask about those recordings</li>
                        </ul>
                        <p className="mt-1.5 text-ink-500">
                          Recordings added later show up too. You can revoke the link from the job
                          file at any time.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          className={
            phone
              ? 'sticky bottom-0 z-10 -mx-3 shrink-0 border-t border-line bg-paper-100/95 px-3 pt-2 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-sm'
              : 'flex flex-wrap items-center justify-end gap-3 pb-8 pt-2'
          }
        >
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className={cn(
              'inline-flex items-center justify-center gap-2 bg-brand-600 font-semibold text-ink-900 disabled:opacity-50',
              phone
                ? 'w-full rounded-xl px-4 py-3 text-[15px]'
                : 'rounded-lg px-4 py-2.5 text-sm',
            )}
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            {actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
