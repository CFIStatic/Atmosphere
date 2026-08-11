import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import {
  api,
  type CaptureTeamMember,
  type IntakeProposal,
  type IntakeApproveResult,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { useExperiment } from '../hooks/useExperiment';

/**
 * Office intake — address + scope (upload or paste), review, approve.
 *
 * Creates the job file, scope lines, published brief, and capture invites
 * together. Invite your Field Capture team and/or subcontractors by email.
 * Outsiders get an email; if they already have an Atmosphere account the job
 * shows there, otherwise they are prompted to create one.
 */

type Step = 'paste' | 'review' | 'done';

type ExternalInvite = {
  id: string;
  fullName: string;
  company: string;
  email: string;
};

const SAMPLE = `Claim #AM-10428
Property: 1842 Meridian Ave
Austin, TX 78702

Scope of work
1. Extract standing water — living room and hallway
2. Remove wet drywall to 24" on south wall
3. Set air movers and dehumidifier; monitor 3 days
4. Replace insulation in opened cavities
DO NOT: demo kitchen cabinets
DO NOT: open ceilings without written approval

Mitigation — water loss`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_ADDRESS = /^address to confirm$/i;

function buildProposeText(scopeText: string, siteAddress: string): string {
  const body = scopeText.trim();
  const address = siteAddress.trim();
  if (!address) return body;
  if (/(?:^|\n)\s*(?:property|address)\s*:/i.test(body)) return body;
  return `Property: ${address}\n\n${body}`;
}

export function JobIntakePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  useFeatureTimer('job_intake');
  // Paused by default in DB — assign returns null until status = running.
  const intakeCta = useExperiment('intake_cta_copy');
  const approveLabel =
    intakeCta.variantKey === 'proof_first'
      ? 'Publish brief & invite crew'
      : 'Approve & invite';
  const [step, setStep] = useState<Step>('paste');
  const [siteAddress, setSiteAddress] = useState('');
  const [text, setText] = useState('');
  const [scopeFileName, setScopeFileName] = useState<string | null>(null);
  const [proposal, setProposal] = useState<IntakeProposal | null>(null);
  const [captureTeam, setCaptureTeam] = useState<CaptureTeamMember[]>([]);
  const [externals, setExternals] = useState<ExternalInvite[]>([]);
  const [extName, setExtName] = useState('');
  const [extCompany, setExtCompany] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [result, setResult] = useState<IntakeApproveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const included = useMemo(
    () => (proposal?.scope ?? []).filter((s) => s.state === 'included').length,
    [proposal],
  );
  const excluded = useMemo(
    () => (proposal?.scope ?? []).filter((s) => s.state === 'excluded').length,
    [proposal],
  );
  const selectedCount = useMemo(
    () => captureTeam.filter((m) => m.selected).length,
    [captureTeam],
  );
  const inviteTotal = selectedCount + externals.length;

  async function onScopeFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
      setError(
        'PDF upload isn’t supported yet — save the scope as a .txt file, or paste the text below.',
      );
      return;
    }
    if (
      !lower.endsWith('.txt') &&
      !lower.endsWith('.md') &&
      !lower.endsWith('.csv') &&
      !lower.endsWith('.rtf') &&
      file.type &&
      !file.type.startsWith('text/')
    ) {
      setError('Upload a text scope file (.txt, .md, .csv), or paste the scope below.');
      return;
    }
    try {
      const content = await file.text();
      if (content.trim().length < 20) {
        setError('That file looks empty — paste the scope, or try another file.');
        return;
      }
      setText(content);
      setScopeFileName(file.name);
      setError(null);
    } catch {
      setError('Could not read that file. Paste the scope instead.');
    }
  }

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    if (!siteAddress.trim()) {
      setError('Enter the site address.');
      return;
    }
    if (text.trim().length < 20) {
      setError('Upload or paste the scope — a few lines is not enough.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.proposeIntake({ text: buildProposeText(text, siteAddress) });
      const drafted = res.proposal;
      setProposal({
        ...drafted,
        address:
          siteAddress.trim() ||
          (PLACEHOLDER_ADDRESS.test(drafted.address) ? '' : drafted.address),
      });
      setCaptureTeam(
        (res.captureTeam ?? []).map((m) => ({ ...m, selected: m.selected !== false })),
      );
      setExternals([]);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft that package.');
    } finally {
      setBusy(false);
    }
  }

  function addExternal() {
    const email = extEmail.trim().toLowerCase();
    const fullName = extName.trim();
    const company = extCompany.trim() || fullName;
    if (!fullName) {
      setError('Add a name for the subcontractor.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
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

  async function onApprove(e: FormEvent) {
    e.preventDefault();
    if (!proposal) return;
    if (!proposal.address.trim() || PLACEHOLDER_ADDRESS.test(proposal.address)) {
      setError('Enter the real site address before inviting Field Capture.');
      return;
    }
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
    if (invitees.length < 1) {
      setError('Invite at least one Field Capture teammate or subcontractor.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.approveIntake({
        title: proposal.title,
        workType: proposal.workType,
        address: proposal.address,
        city: proposal.city || undefined,
        postalCode: proposal.postalCode || undefined,
        claimNumber: proposal.claimNumber || undefined,
        briefNote: proposal.briefNote,
        facts: proposal.facts,
        scope: proposal.scope,
        invitees,
      });
      intakeCta.track('conversion', {
        inviteCount: invitees.length,
        scopeLines: proposal.scope.length,
      });
      setResult(res);
      setStep('done');
      // Job is live on the shared progress dashboard.
      navigate(`/shared?job=${encodeURIComponent(res.job.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve that package.');
    } finally {
      setBusy(false);
    }
  }

  function updateScope(i: number, patch: Partial<IntakeProposal['scope'][number]>) {
    if (!proposal) return;
    const scope = proposal.scope.map((line, idx) => (idx === i ? { ...line, ...patch } : line));
    setProposal({ ...proposal, scope });
  }

  function removeScope(i: number) {
    if (!proposal) return;
    setProposal({ ...proposal, scope: proposal.scope.filter((_, idx) => idx !== i) });
  }

  function addScope() {
    if (!proposal) return;
    setProposal({
      ...proposal,
      scope: [...proposal.scope, { title: '', state: 'included' }],
    });
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

  return (
    <>
      <PageHeader
        eyebrow="Work Verification Platform"
        title="Start a job"
        description="Enter the site address, upload or paste the scope, review the draft, then approve once to invite Field Capture."
        action={
          <Link
            to="/shared"
            className="text-sm font-medium text-brand-600 hover:text-brand-500"
          >
            Back to job progress
          </Link>
        }
      />

      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-medium">
        {(
          [
            ['paste', '1 · Scope'],
            ['review', '2 · Review'],
            ['done', '3 · On dashboard'],
          ] as const
        ).map(([id, label]) => (
          <li
            key={id}
            className={
              'rounded-full px-3 py-1 ' +
              (step === id
                ? 'bg-brand-600 text-ink-900'
                : step === 'done' || (step === 'review' && id === 'paste')
                  ? 'bg-paper-200/70 text-ink-600'
                  : 'bg-paper-200/40 text-ink-500')
            }
          >
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="mb-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {step === 'paste' && (
        <form onSubmit={onPropose} className="mx-auto max-w-3xl space-y-4 animate-fade-in-up">
          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Enter address here</h2>
            <p className="mt-1 text-sm text-ink-600">
              Where the crew will work. You can fine-tune city and postal on the next step.
            </p>
            <label className="mt-4 block text-xs font-medium text-ink-600">
              Site address
              <input
                className="glass-field mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                required
                autoComplete="street-address"
                placeholder="1842 Meridian Ave, Austin, TX 78702"
              />
            </label>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Upload scope here</h2>
            <p className="mt-1 text-sm text-ink-600">
              Drop a text export of the carrier notes or estimate (.txt, .md, .csv). We draft the
              job and scope lines — you still approve before anyone is invited.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.rtf,text/plain,text/markdown,text/csv"
              className="sr-only"
              onChange={(e) => void onScopeFile(e)}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-line bg-paper-0/70 px-4 py-2.5 text-sm font-semibold text-ink-900 hover:border-brand-300"
              >
                Choose scope file
              </button>
              {scopeFileName ? (
                <p className="text-sm text-ink-600">
                  Loaded <span className="font-medium text-ink-800">{scopeFileName}</span>
                </p>
              ) : (
                <p className="text-sm text-ink-500">No file yet — paste below if you prefer.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Or paste scope here</h2>
            <p className="mt-1 text-sm text-ink-600">
              Same as upload — claim notes, estimate lines, and “do not” items all work.
            </p>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (scopeFileName) setScopeFileName(null);
              }}
              rows={14}
              required
              placeholder="Paste claim / scope text here…"
              className="glass-field mt-4 w-full resize-y rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || text.trim().length < 20 || !siteAddress.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                Draft the package
              </button>
              <button
                type="button"
                className="text-sm font-medium text-brand-600"
                onClick={() => {
                  setText(SAMPLE);
                  setSiteAddress('1842 Meridian Ave, Austin, TX 78702');
                  setScopeFileName(null);
                }}
              >
                Use a sample scope
              </button>
            </div>
          </div>
        </form>
      )}

      {step === 'review' && proposal && (
        <form onSubmit={onApprove} className="mx-auto max-w-3xl space-y-4 animate-fade-in-up">
          <div className="rounded-xl glass-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink-900">Review before anyone sees it</h2>
                <p className="mt-1 text-sm text-ink-600">{proposal.summary}</p>
              </div>
              <span className="rounded-full bg-paper-200/70 px-2.5 py-1 text-xs font-medium text-ink-600">
                {proposal.source === 'model' ? 'Model draft' : 'Draft from text'}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-600">
                Job title
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.title}
                  onChange={(e) => setProposal({ ...proposal, title: e.target.value })}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                Work type
                <select
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.workType}
                  onChange={(e) =>
                    setProposal({
                      ...proposal,
                      workType: e.target.value as IntakeProposal['workType'],
                    })
                  }
                >
                  <option value="mitigation">Mitigation</option>
                  <option value="construction">Construction</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-ink-600 sm:col-span-2">
                Site address
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.address}
                  onChange={(e) => setProposal({ ...proposal, address: e.target.value })}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                City
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.city}
                  onChange={(e) => setProposal({ ...proposal, city: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                Postal code
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.postalCode}
                  onChange={(e) => setProposal({ ...proposal, postalCode: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                Claim #
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.claimNumber}
                  onChange={(e) => setProposal({ ...proposal, claimNumber: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl glass-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-900">Scope lines</h2>
              <p className="text-xs text-ink-500">
                {included} in scope · {excluded} do not
              </p>
            </div>
            <ul className="mt-3 space-y-2">
              {proposal.scope.map((line, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-start gap-2 rounded-lg border border-line/60 bg-paper-50/40 px-3 py-2"
                >
                  <select
                    className="glass-field rounded-md px-2 py-1 text-xs font-medium text-ink-800"
                    value={line.state}
                    onChange={(e) =>
                      updateScope(i, { state: e.target.value as 'included' | 'excluded' })
                    }
                  >
                    <option value="included">In scope</option>
                    <option value="excluded">Do not</option>
                  </select>
                  <input
                    className="glass-field min-w-[12rem] flex-1 rounded-md px-2 py-1 text-sm text-ink-900"
                    value={line.title}
                    onChange={(e) => updateScope(i, { title: e.target.value })}
                    required
                    placeholder="What to do — or not do"
                  />
                  <button
                    type="button"
                    className="text-xs font-medium text-ink-500 hover:text-danger-600"
                    onClick={() => removeScope(i)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addScope}
              className="mt-3 text-sm font-medium text-brand-600"
            >
              Add a line
            </button>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">First brief</h2>
            <p className="mt-1 text-sm text-ink-600">
              Approving publishes this revision. Field Capture accepts these facts before they are
              clear to film.
            </p>
            <textarea
              className="glass-field mt-3 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
              rows={3}
              value={proposal.briefNote}
              onChange={(e) => setProposal({ ...proposal, briefNote: e.target.value })}
            />
          </div>

          <div className="rounded-xl glass-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-ink-900">Field Capture team</h2>
                <p className="mt-1 text-sm text-ink-600">
                  Preloaded from your org. Selected people get a link to capture this job on site
                  (video + mic).
                </p>
              </div>
              {captureTeam.length > 0 && (
                <div className="flex gap-2 text-xs font-medium">
                  <button
                    type="button"
                    className="text-brand-600"
                    onClick={() => setAllSelected(true)}
                  >
                    Invite all
                  </button>
                  <span className="text-ink-400">·</span>
                  <button
                    type="button"
                    className="text-ink-500"
                    onClick={() => setAllSelected(false)}
                  >
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
              {selectedCount} selected · each gets their own capture link for this job
            </p>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Invite a subcontractor</h2>
            <p className="mt-1 text-sm text-ink-600">
              Outside your company — Atmosphere emails them the invite. If they already have an
              account, the job shows there. If not, the email walks them through creating one with
              that address.
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

          <div className="flex flex-wrap items-center gap-3 pb-8">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600"
              onClick={() => setStep('paste')}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || !proposal.scope.length || inviteTotal < 1}
              data-experiment="intake_cta_copy"
              data-variant={intakeCta.variantKey ?? 'control'}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              {approveLabel}
            </button>
            <p className="text-xs text-ink-500">
              {inviteTotal} invite{inviteTotal === 1 ? '' : 's'} · job file, brief, and capture
              links in one step.
            </p>
          </div>
        </form>
      )}

      {step === 'done' && result && (
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
                    <code className="glass-field min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-xs text-ink-800">
                      {window.location.origin}
                      {inv.external ? inv.sharePath : inv.fieldCapturePath || inv.sharePath}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        void copyLink(
                          inv.external ? inv.sharePath : inv.fieldCapturePath || inv.sharePath,
                          inv.id,
                        )
                      }
                      className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900"
                    >
                      {copiedId === inv.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h3 className="text-sm font-semibold text-ink-900">What they do</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li className="flex gap-2">
                <span className="text-brand-600">1</span>
                Open their capture link on phone
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">2</span>
                Accept the brief — in-scope and “do not” lines
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">3</span>
                Film the day (video + mic) against that scope
              </li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pb-8">
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900"
              onClick={() => navigate(`/shared?job=${encodeURIComponent(result.job.id)}`)}
            >
              Open this job on the dashboard
            </button>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600"
              onClick={() => {
                setStep('paste');
                setSiteAddress('');
                setText('');
                setScopeFileName(null);
                setProposal(null);
                setCaptureTeam([]);
                setExternals([]);
                setResult(null);
              }}
            >
              Start another
            </button>
          </div>
        </div>
      )}
    </>
  );
}
