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
import { jobFilePath } from '../lib/jobFileAsk';
import {
  INTAKE_SAMPLE,
  cityPostalFromAddress,
  isInviteEmail,
  membersToCaptureTeam,
  scopeFromSituation,
  workTypeFromSituation,
} from '../lib/intakeForm';
import { usePhoneShell } from '../lib/usePhoneShell';
import { cn } from '../design';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useExperiment } from '../hooks/useExperiment';

/**
 * Office intake — name, site, optional situation, invite list.
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

const PLACEHOLDER_ADDRESS = /^address to confirm$/i;
const DEFAULT_BRIEF =
  'No work description yet. Field Capture can still film — AI will describe what happened from the video.';

export function JobIntakePage() {
  const navigate = useNavigate();
  const phone = usePhoneShell();
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
  const [placeId, setPlaceId] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
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
    setCity(addr.city || '');
    setPostalCode(addr.postalCode || '');
    setPlaceId(addr.placeId || '');
    setRegion(addr.state || '');
    setCountry(addr.country || '');
    setLatitude(addr.lat ?? null);
    setLongitude(addr.lng ?? null);
  }

  function clearResolvedPlace() {
    setPlaceId('');
    setRegion('');
    setCountry('');
    setLatitude(null);
    setLongitude(null);
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
        'Site address': [address, siteCity, sitePostal].filter(Boolean).join(', '),
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
      setError('Search for the site address and pick it from the list.');
      return;
    }
    setBusy(true);
    setError(null);
    let resolvedPlaceId = placeId;
    let resolvedCity = city;
    let resolvedPostal = postalCode;
    let resolvedRegion = region;
    let resolvedCountry = country;
    let resolvedLat = latitude;
    let resolvedLng = longitude;
    let resolvedLine = siteAddress.trim();
    if (!resolvedPlaceId) {
      try {
        const lookedUp = await api.placesResolve({ input: siteAddress.trim() });
        applyResolvedPlace(lookedUp.address);
        resolvedPlaceId = lookedUp.address.placeId;
        resolvedCity = lookedUp.address.city;
        resolvedPostal = lookedUp.address.postalCode;
        resolvedRegion = lookedUp.address.state;
        resolvedCountry = lookedUp.address.country;
        resolvedLat = lookedUp.address.lat;
        resolvedLng = lookedUp.address.lng;
        resolvedLine = lookedUp.address.formatted || lookedUp.address.addressLine1 || resolvedLine;
      } catch {
        // OSM / no-key still accepts the typed line. Google rejects on the server
        // if lookup cannot complete.
      }
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
    try {
      const scope = proposal.scope.filter((line) => line.title.trim().length > 0);
      const res = await api.approveIntake({
        title: proposal.title,
        workType: proposal.workType,
        address: resolvedLine || proposal.address,
        city: resolvedCity || proposal.city || undefined,
        postalCode: resolvedPostal || proposal.postalCode || undefined,
        region: resolvedRegion || undefined,
        country: resolvedCountry || undefined,
        placeId: resolvedPlaceId || undefined,
        latitude: resolvedLat,
        longitude: resolvedLng,
        briefNote: proposal.briefNote,
        facts: proposal.facts,
        scope,
        invitees,
      });
      intakeCta.track('conversion', {
        inviteCount: invitees.length,
        scopeLines: scope.length,
      });
      setResult(res);
      // Stay on this page so the invite copy buttons actually render. The
      // previous navigate() to /jobs/:id dropped that handoff — JobDetailPage
      // never reads location.state.
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
      <div
        data-testid="start-job"
        className={phone ? 'flex min-h-0 min-w-0 flex-1 flex-col' : undefined}
      >
        {phone ? (
          <div className="min-w-0 shrink-0">
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Start a job</h1>
            <p className="mt-1 text-[13px] leading-snug text-ink-600">This job is on the dashboard.</p>
          </div>
        ) : (
          <PageHeader title="Start a job" description="This job is on the dashboard." />
        )}
        <div
          className={cn(
            'animate-fade-in-up',
            phone
              ? 'mt-3 flex min-h-0 min-w-0 flex-1 flex-col'
              : 'mx-auto max-w-3xl space-y-4',
          )}
        >
          <div
            className={
              phone
                ? 'min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                : 'contents'
            }
          >
          <div
            className={cn(
              'rounded-xl border border-success-200/80 bg-success-50/40 glass-card',
              phone ? 'p-3.5' : 'p-5',
            )}
          >
            <h2 className={cn('font-semibold text-ink-900', phone ? 'text-[15px]' : 'text-base')}>
              Job created — capture invited
            </h2>
            <p className={cn('mt-1 text-ink-600', phone ? 'text-[13px] leading-snug' : 'text-sm')}>
              <span className="font-medium text-ink-800">{result.job.title}</span>
              {result.job.jobNumber != null ? ` · Job #${result.job.jobNumber}` : ''} ·{' '}
              {result.scopeSaved} scope lines · brief r{result.briefRevision} · {invites.length}{' '}
              invite{invites.length === 1 ? '' : 's'}
              {invites.some((i) => i.emailed)
                ? ` · ${invites.filter((i) => i.emailed).length} emailed`
                : ''}
              {phone ? '.' : '. It is on your job progress dashboard now.'}
            </p>
          </div>

          <div className={cn('rounded-xl glass-card', phone ? 'p-3.5' : 'p-5')}>
            <h3 className="text-sm font-semibold text-ink-900">Invites</h3>
            <p className={cn('mt-1 text-ink-600', phone ? 'text-[13px] leading-snug' : 'text-sm')}>
              {phone
                ? 'Teammates get a capture link. Outside workers get an Atmosphere email.'
                : 'Teammates get a capture link. Subcontractors get an Atmosphere email — if they already have an account the job shows there; if not, the email prompts them to create one.'}
            </p>
            <ul className={cn('space-y-3', phone ? 'mt-3' : 'mt-4')}>
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="rounded-lg border border-line/60 bg-paper-50/40 px-3 py-3"
                >
                  <div
                    className={cn(
                      'min-w-0',
                      phone ? 'space-y-0.5' : 'flex flex-wrap items-baseline justify-between gap-2',
                    )}
                  >
                    <p className="min-w-0 truncate text-sm font-medium text-ink-900">{inv.name}</p>
                    {inv.email && (
                      <p className="min-w-0 truncate text-xs text-ink-500">{inv.email}</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-snug text-ink-500">
                    {inv.emailed
                      ? inv.recipientHasAccount
                        ? phone
                          ? 'Emailed — they already have an account.'
                          : 'Atmosphere emailed them — they already have an account; the job will show when they sign in.'
                        : phone
                          ? 'Emailed — the note walks them through creating an account.'
                          : 'Atmosphere emailed them — no account yet; the email walks them through creating one with this address.'
                      : inv.email
                        ? phone
                          ? 'Invite created — copy the link; mail did not send.'
                          : 'Invite created, but Atmosphere mail did not send — copy the link below.'
                        : 'Copy their capture link below.'}
                    {inv.attachedToAccount ? ' Already on their My jobs list.' : ''}
                  </p>
                  <div className="mt-2 flex min-w-0 items-center gap-2">
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
                      className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900"
                    >
                      {copiedId === inv.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          </div>

          <div
            className={cn(
              phone
                ? 'sticky bottom-0 z-10 -mx-3 mt-2 grid shrink-0 gap-1.5 border-t border-line bg-paper-100/95 px-3 pt-2 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-sm'
                : 'flex flex-wrap gap-3 pb-8',
            )}
          >
            <button
              type="button"
              className={cn(
                'rounded-lg bg-brand-600 text-sm font-semibold text-ink-900',
                phone ? 'w-full px-4 py-3' : 'px-4 py-2',
              )}
              onClick={() =>
                navigate(jobFilePath(result.job.id, { title: result.job.title, number: result.job.jobNumber }))
              }
            >
              Open this job file
            </button>
            <button
              type="button"
              className={cn(
                'rounded-lg text-sm font-medium text-ink-600',
                phone ? 'w-full px-4 py-2.5' : 'px-4 py-2',
              )}
              onClick={() => {
                setResult(null);
                setName('');
                setSiteAddress('');
                setCity('');
                setPostalCode('');
                clearResolvedPlace();
                setSituation('');
                setExternals([]);
              }}
            >
              Start another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cardPad = phone ? 'p-3.5' : 'p-5';
  const sectionTitle = phone ? 'text-[15px] font-semibold text-ink-900' : 'text-base font-semibold text-ink-900';
  const sectionHint = phone ? 'mt-0.5 text-[13px] leading-snug text-ink-600' : 'mt-1 text-sm text-ink-600';

  return (
    <div
      data-testid="start-job"
      className={phone ? 'flex min-h-0 min-w-0 flex-1 flex-col' : undefined}
    >
      {phone ? (
        <div className="min-w-0 shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Start a job</h1>
          <p className="mt-1 text-[13px] leading-snug text-ink-600">
            Name it and the site. A note and invites are optional.
          </p>
        </div>
      ) : (
        <PageHeader
          title="Start a job"
          description="Name the job, then the site. A short note and invites are optional."
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
          phone ? 'mt-3 flex min-h-0 min-w-0 flex-1 flex-col' : 'mx-auto max-w-3xl space-y-4',
        )}
      >
        <div
          className={
            phone
              ? 'min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
              : 'contents'
          }
        >
          {phone && (
          <div className={cn('relative z-20 overflow-visible rounded-xl glass-card', cardPad)}>
            <h2 className={sectionTitle}>Name</h2>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              <span className="sr-only">Name</span>
              <input
                className="glass-field w-full rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="off"
                placeholder="East Racine Avenue"
              />
            </label>

            <h2 className={cn(sectionTitle, 'mt-3.5')}>Address</h2>
            <label className="mt-2 block text-xs font-medium text-ink-600">
              <span className="sr-only">Address</span>
              <AddressAutocomplete
                value={siteAddress}
                onChange={(next) => {
                  setSiteAddress(next);
                  clearResolvedPlace();
                }}
                onResolved={applyResolvedPlace}
                required
                placeholder="Search Google for the site address"
              />
            </label>

            <div className="mt-3.5 flex items-baseline justify-between gap-2">
              <h2 className={sectionTitle}>Situation</h2>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-brand-600"
                onClick={() => {
                  setSituation(INTAKE_SAMPLE.situation);
                  if (!siteAddress.trim()) setSiteAddress(INTAKE_SAMPLE.address);
                }}
              >
                Use a sample note
              </button>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-ink-500">
              Optional. AI will describe the day film either way.
            </p>
            <textarea
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              rows={3}
              placeholder="Extract standing water in the living room. Set drying equipment."
              className="glass-field mt-2 w-full resize-y rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400"
            />
          </div>
          )}

          {!phone && (
            <>
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
                    onChange={(next) => {
                      setSiteAddress(next);
                      clearResolvedPlace();
                    }}
                    onResolved={applyResolvedPlace}
                    required
                    placeholder="Search Google for the site address"
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
            </>
          )}

          <div className={cn('rounded-xl glass-card', cardPad)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className={sectionTitle}>Invite list</h2>
                <p className={sectionHint}>
                  {phone
                    ? 'Selected people get a capture link. Add someone outside by email.'
                    : 'Selected people get a link to capture this job on site. Add someone outside the company by email.'}
                </p>
              </div>
              {captureTeam.length > 0 && (
                <div className="flex shrink-0 gap-2 text-xs font-medium">
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
              <p className={cn(phone ? 'mt-3 text-[13px] leading-snug text-ink-600' : 'mt-4 text-sm text-ink-600')}>
                {phone
                  ? 'No employees yet. Invite an outside worker by email — they only see this job.'
                  : 'No employees in this org yet. Invite an outside worker (subcontractor) by email below — they only see this job — or add Employees under Team.'}
              </p>
            ) : (
              <ul className={cn('divide-y divide-line/50', phone ? 'mt-3' : 'mt-4')}>
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
                    {!phone && (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                        Capture
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-500">
              {selectedCount} selected · {externals.length} outside invite
              {externals.length === 1 ? '' : 's'}
              {phone
                ? ''
                : ' · org members can also film from Field Capture without an extra invite'}
            </p>

            <div className={cn('border-t border-line/50', phone ? 'mt-3.5 pt-3' : 'mt-5 pt-4')}>
              <p className="text-xs font-medium text-ink-600">Invite an outside worker</p>
              <p className="mt-1 text-[11px] leading-snug text-ink-500">
                {phone
                  ? 'They film this job only — they do not join the org.'
                  : 'Job-specific access only — they film this job; they do not join the org or see billing.'}
              </p>
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
                className={cn(
                  'font-medium text-brand-600',
                  phone ? 'mt-2.5 text-[13px]' : 'mt-3 text-sm',
                )}
              >
                Add to invite list
              </button>
              {externals.length > 0 && (
                <ul className="mt-4 divide-y divide-line/50">
                  {externals.map((x) => (
                    <li key={x.id} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
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
                      {!phone && (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                          Email
                        </span>
                      )}
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
            </div>
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
            disabled={busy || !name.trim() || !siteAddress.trim()}
            data-experiment="intake_cta_copy"
            data-variant={intakeCta.variantKey ?? 'control'}
            className={cn(
              'inline-flex items-center justify-center gap-2 bg-brand-600 font-semibold text-ink-900 disabled:opacity-50',
              phone
                ? 'w-full rounded-xl px-4 py-3 text-[15px]'
                : 'rounded-lg px-4 py-2.5 text-sm',
            )}
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            {approveLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
