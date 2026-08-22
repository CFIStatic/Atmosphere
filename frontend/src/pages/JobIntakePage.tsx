import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import {
  api,
  type CaptureTeamMember,
  type IntakeApproveResult,
  type IntakeProposal,
  type ResolvedPlaceAddress,
} from '../lib/api';
import { handoffFromApprove } from '../lib/intakeHandoff';
import {
  INTAKE_SAMPLE,
  cityPostalFromAddress,
  isInviteEmail,
  membersToCaptureTeam,
  scopeFromSituation,
  workTypeFromSituation,
} from '../lib/intakeForm';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useExperiment } from '../hooks/useExperiment';

/**
 * Office intake — name, site, optional situation, invite list.
 *
 * One page. Creates the job file, publishes a brief, and can invite Field Capture.
 */

type ExternalInvite = {
  id: string;
  fullName: string;
  company: string;
  email: string;
};

const PLACEHOLDER_ADDRESS = /^address to confirm$/i;
const DEFAULT_BRIEF =
  'No work description yet. Field Capture can still film — AI will describe what happened from the video.';

export function JobIntakePage() {
  const navigate = useNavigate();
  useFeatureTimer('job_intake');
  const intakeCta = useExperiment('intake_cta_copy');
  const approveLabel =
    intakeCta.variantKey === 'proof_first'
      ? 'Publish brief & invite crew'
      : 'Approve & invite';

  const [name, setName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [situation, setSituation] = useState('');
  const [captureTeam, setCaptureTeam] = useState<CaptureTeamMember[]>([]);
  const [externals, setExternals] = useState<ExternalInvite[]>([]);
  const [extName, setExtName] = useState('');
  const [extCompany, setExtCompany] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [result, setResult] = useState<IntakeApproveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  function applyResolvedPlace(addr: ResolvedPlaceAddress) {
    setSiteAddress(addr.formatted || addr.addressLine1);
    setCity((prev) => addr.city || prev);
    setPostalCode((prev) => addr.postalCode || prev);
  }

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
    const address = siteAddress.trim();
    const parsed = cityPostalFromAddress(address);
    const siteCity = city.trim() || parsed.city;
    const sitePostal = postalCode.trim() || parsed.postalCode;
    const note = situation.trim();
    const scope = scopeFromSituation(note);
    return {
      title: name.trim(),
      workType: workTypeFromSituation(note),
      address,
      city: siteCity,
      postalCode: sitePostal,
      claimNumber: '',
      briefNote: note || DEFAULT_BRIEF,
      facts: {
        Site: address,
        ...(note ? { Work: note.slice(0, 500) } : {}),
        Source: note ? 'Address and work description' : 'Address only — work description optional',
      },
      scope,
      party: {
        company: 'Field Capture',
        trade: 'field_capture',
        contactName: '',
      },
      source: 'heuristic',
      summary: note
        ? 'Job drafted from the address and what needs to be done.'
        : 'Job drafted from the address.',
    };
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    if (!siteAddress.trim() || PLACEHOLDER_ADDRESS.test(siteAddress)) {
      setError('Enter the site address.');
      return;
    }
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
    setBusy(true);
    setError(null);
    try {
      const scope = proposal.scope.filter((line) => line.title.trim().length > 0);
      const res = await api.approveIntake({
        title: proposal.title,
        workType: proposal.workType,
        address: proposal.address,
        city: proposal.city || undefined,
        postalCode: proposal.postalCode || undefined,
        briefNote: proposal.briefNote,
        facts: proposal.facts,
        scope,
        invitees,
      });
      intakeCta.track('conversion', {
        inviteCount: invitees.length,
        scopeLines: scope.length,
      });
      const handoff = handoffFromApprove(res, proposal, scope);
      setResult(res);
      navigate(`/job-progress?job=${encodeURIComponent(res.job.id)}`, {
        replace: true,
        state: {
          freshJob: handoff.summary,
          freshRecord: handoff.record,
          freshInvites: handoff.invites,
          justApproved: true,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve that package.');
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

  async function copyLink(path: string, id: string) {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Could not copy — select the link and copy it yourself.');
    }
  }

  const invites = result?.invites?.length
    ? result.invites
    : result
      ? [
          {
            id: result.party.id,
            name: result.party.company,
            email: null as string | null,
            sharePath: result.sharePath,
            fieldCapturePath: result.fieldCapturePath,
            token: '',
          },
        ]
      : [];

  if (result) {
    return (
      <>
        <PageHeader title="Start a job" description="This job is on the dashboard." />
        <div className="mx-auto max-w-3xl space-y-4 animate-fade-in-up">
          <div className="rounded-xl border border-success-200/80 bg-success-50/40 glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Job created — capture invited</h2>
            <p className="mt-1 text-sm text-ink-600">
              <span className="font-medium text-ink-800">{result.job.title}</span>
              {result.job.jobNumber != null ? ` · Job #${result.job.jobNumber}` : ''} ·{' '}
              {result.scopeSaved} scope lines · brief r{result.briefRevision} · {invites.length}{' '}
              invite{invites.length === 1 ? '' : 's'}
              {invites.some((i) => i.emailed)
                ? ` · ${invites.filter((i) => i.emailed).length} emailed`
                : ''}
              . It is on your job progress dashboard now.
            </p>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h3 className="text-sm font-semibold text-ink-900">Invites</h3>
            <p className="mt-1 text-sm text-ink-600">
              Teammates get a capture link. Subcontractors get an Atmosphere email — if they already
              have an account the job shows there; if not, the email prompts them to create one.
            </p>
            <ul className="mt-4 space-y-3">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="rounded-lg border border-line/60 bg-paper-50/40 px-3 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink-900">{inv.name}</p>
                    {inv.email && <p className="text-xs text-ink-500">{inv.email}</p>}
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {inv.emailed
                      ? inv.recipientHasAccount
                        ? 'Atmosphere emailed them — they already have an account; the job will show when they sign in.'
                        : 'Atmosphere emailed them — no account yet; the email walks them through creating one with this address.'
                      : inv.email
                        ? 'Invite created, but Atmosphere mail did not send — copy the link below.'
                        : 'Copy their capture link below.'}
                    {inv.attachedToAccount ? ' Already on their My jobs list.' : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href={inv.sharePath}
                      className="glass-field min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-xs text-brand-700 underline-offset-2 hover:underline"
                    >
                      {window.location.origin}
                      {inv.sharePath}
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyLink(inv.sharePath, inv.id)}
                      className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900"
                    >
                      {copiedId === inv.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pb-8">
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900"
              onClick={() =>
                navigate(`/job-progress?job=${encodeURIComponent(result.job.id)}`)
              }
            >
              Open this job on the dashboard
            </button>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600"
              onClick={() => {
                setResult(null);
                setName('');
                setSiteAddress('');
                setCity('');
                setPostalCode('');
                setSituation('');
                setExternals([]);
              }}
            >
              Start another
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Start a job"
        description="Name the job, then the site. A short note and invites are optional."
      />

      {error && (
        <p role="alert" className="mb-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      <form onSubmit={onApprove} className="mx-auto max-w-3xl space-y-4 animate-fade-in-up">
        <div className="rounded-xl glass-card p-5">
          <h2 className="text-base font-semibold text-ink-900">Name</h2>
          <p className="mt-1 text-sm text-ink-600">What this job is called on the dashboard.</p>
          <label className="mt-4 block text-xs font-medium text-ink-600">
            Name
            <input
              className="glass-field mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
              placeholder="East Racine Avenue"
            />
          </label>
        </div>

        <div className="relative z-20 overflow-visible rounded-xl glass-card p-5">
          <h2 className="text-base font-semibold text-ink-900">Address</h2>
          <p className="mt-1 text-sm text-ink-600">Where the crew will work.</p>
          <label className="mt-4 block text-xs font-medium text-ink-600">
            Address
            <AddressAutocomplete
              value={siteAddress}
              onChange={setSiteAddress}
              onResolved={applyResolvedPlace}
              required
              placeholder="1842 Meridian Ave, Austin, TX 78702"
            />
          </label>
        </div>

        <div className="rounded-xl glass-card p-5">
          <h2 className="text-base font-semibold text-ink-900">Situation</h2>
          <p className="mt-1 text-sm text-ink-600">
            Optional. A short note is enough — AI will describe the day film either way.
          </p>
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            rows={4}
            placeholder="Extract standing water in the living room. Set drying equipment."
            className="glass-field mt-3 w-full resize-y rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400"
          />
          <button
            type="button"
            className="mt-3 text-sm font-medium text-brand-600"
            onClick={() => {
              setSituation(INTAKE_SAMPLE.situation);
              if (!siteAddress.trim()) setSiteAddress(INTAKE_SAMPLE.address);
            }}
          >
            Use a sample note
          </button>
        </div>

        <div className="rounded-xl glass-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Invite list</h2>
              <p className="mt-1 text-sm text-ink-600">
                Selected people get a link to capture this job on site. Add someone outside the
                company by email.
              </p>
            </div>
            {captureTeam.length > 0 && (
              <div className="flex gap-2 text-xs font-medium">
                <button type="button" className="text-brand-600" onClick={() => setAllSelected(true)}>
                  Invite all
                </button>
                <span className="text-ink-400">·</span>
                <button type="button" className="text-ink-500" onClick={() => setAllSelected(false)}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {captureTeam.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600">
              No field technicians in this org yet. Invite a subcontractor by email below, or add
              Field Capture teammates under Team.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/50">
              {captureTeam.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <input
                    id={`capture-${m.userId}`}
                    type="checkbox"
                    checked={m.selected}
                    onChange={() => toggleMember(m.userId)}
                    className="h-4 w-4 rounded border-line text-brand-600"
                  />
                  <label htmlFor={`capture-${m.userId}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-sm font-medium text-ink-900">{m.fullName}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {[m.email, m.workType].filter(Boolean).join(' · ') || m.role}
                    </span>
                  </label>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                    Capture
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-500">
            {selectedCount} selected · {externals.length} outside invite
            {externals.length === 1 ? '' : 's'} · org members can also film from Field Capture
            without an extra invite
          </p>

          <div className="mt-5 border-t border-line/50 pt-4">
            <p className="text-xs font-medium text-ink-600">Invite a subcontractor</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="block text-xs font-medium text-ink-600">
                Contact name
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="Alex Rivera"
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
              className="mt-3 text-sm font-medium text-brand-600"
            >
              Add to invite list
            </button>
            {externals.length > 0 && (
              <ul className="mt-4 divide-y divide-line/50">
                {externals.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-900">{x.fullName}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {[x.company !== x.fullName ? x.company : null, x.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                      Email
                    </span>
                    <button
                      type="button"
                      className="text-xs font-medium text-ink-500 hover:text-danger-600"
                      onClick={() => setExternals((list) => list.filter((i) => i.id !== x.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pb-8 pt-2">
          <button
            type="submit"
            disabled={busy || !name.trim() || !siteAddress.trim()}
            data-experiment="intake_cta_copy"
            data-variant={intakeCta.variantKey ?? 'control'}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            {approveLabel}
          </button>
        </div>
      </form>
    </>
  );
}
