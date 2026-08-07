import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, PageHeader } from '../components/AppShell';
import { api, type IntakeProposal, type IntakeApproveResult } from '../lib/api';
import { SpinnerIcon } from '../components/icons';

/**
 * AI-first office intake — one paste, one review, one approve.
 *
 * Creates the job file, scope lines, published brief, and crew invite together.
 * No money. No multi-screen wizard. The human only decides.
 */

type Step = 'paste' | 'review' | 'done';

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

export function JobIntakePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<IntakeProposal | null>(null);
  const [result, setResult] = useState<IntakeApproveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const included = useMemo(
    () => (proposal?.scope ?? []).filter((s) => s.state === 'included').length,
    [proposal],
  );
  const excluded = useMemo(
    () => (proposal?.scope ?? []).filter((s) => s.state === 'excluded').length,
    [proposal],
  );

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.proposeIntake({ text });
      setProposal(res.proposal);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft that package.');
    } finally {
      setBusy(false);
    }
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault();
    if (!proposal) return;
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
        party: proposal.party,
      });
      setResult(res);
      setStep('done');
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

  async function copyLink() {
    if (!result) return;
    const url = `${window.location.origin}${result.sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the link and copy it yourself.');
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Work Verification Platform"
        title="Start a job"
        description="Paste the scope or claim. Review what we drafted. Approve once — the crew link is ready. Nothing about money here; this is the handoff."
        action={
          <Link
            to="/shared"
            className="text-sm font-medium text-brand-600 hover:text-brand-500"
          >
            Back to job files
          </Link>
        }
      />

      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-medium">
        {(
          [
            ['paste', '1 · Paste'],
            ['review', '2 · Review'],
            ['done', '3 · Invite ready'],
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
            <h2 className="text-base font-semibold text-ink-900">Drop the facts</h2>
            <p className="mt-1 text-sm text-ink-600">
              Scope PDF text, carrier notes, or a pasted estimate. We draft the job, lines, and
              first brief — you still approve before anyone is invited.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              required
              placeholder="Paste claim / scope text here…"
              className="glass-field mt-4 w-full resize-y rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || text.trim().length < 20}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50"
              >
                {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                Draft the package
              </button>
              <button
                type="button"
                className="text-sm font-medium text-brand-600"
                onClick={() => setText(SAMPLE)}
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
              Approving publishes this revision. The crew accepts these facts before they are clear
              to work.
            </p>
            <textarea
              className="glass-field mt-3 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
              rows={3}
              value={proposal.briefNote}
              onChange={(e) => setProposal({ ...proposal, briefNote: e.target.value })}
            />
          </div>

          <div className="rounded-xl glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Who gets the link</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-ink-600 sm:col-span-1">
                Company
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.party.company}
                  onChange={(e) =>
                    setProposal({
                      ...proposal,
                      party: { ...proposal.party, company: e.target.value },
                    })
                  }
                  required
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                Trade
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.party.trade}
                  onChange={(e) =>
                    setProposal({
                      ...proposal,
                      party: { ...proposal.party, trade: e.target.value },
                    })
                  }
                />
              </label>
              <label className="block text-xs font-medium text-ink-600">
                Contact name
                <input
                  className="glass-field mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-900"
                  value={proposal.party.contactName}
                  onChange={(e) =>
                    setProposal({
                      ...proposal,
                      party: { ...proposal.party, contactName: e.target.value },
                    })
                  }
                />
              </label>
            </div>
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
              disabled={busy || !proposal.scope.length}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              Approve &amp; invite
            </button>
            <p className="text-xs text-ink-500">
              Creates the job file, publishes the brief, and mints their link — in one step.
            </p>
          </div>
        </form>
      )}

      {step === 'done' && result && (
        <div className="mx-auto max-w-3xl space-y-4 animate-fade-in-up">
          <div className="rounded-xl border border-success-200/80 bg-success-50/40 glass-card p-5">
            <h2 className="text-base font-semibold text-ink-900">Ready for the crew</h2>
            <p className="mt-1 text-sm text-ink-600">
              <span className="font-medium text-ink-800">{result.job.title}</span>
              {result.job.jobNumber != null ? ` · Job #${result.job.jobNumber}` : ''} ·{' '}
              {result.scopeSaved} scope lines · brief r{result.briefRevision} ·{' '}
              {result.party.company}
            </p>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h3 className="text-sm font-semibold text-ink-900">Share link</h3>
            <p className="mt-1 text-sm text-ink-600">
              Send this. They see the scope, accept the brief, and film the day — no office login.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="glass-field flex-1 truncate rounded-lg px-3 py-2 text-xs text-ink-800">
                {window.location.origin}
                {result.sharePath}
              </code>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Field Capture (phone film): open with the same token on the capture app.
            </p>
          </div>

          <div className="rounded-xl glass-card p-5">
            <h3 className="text-sm font-semibold text-ink-900">What they see</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li className="flex gap-2">
                <span className="text-brand-600">1</span>
                Job title and site facts from this brief
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">2</span>
                In-scope lines and clear “do not” exclusions
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">3</span>
                Accept this revision → film the day (video + mic)
              </li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pb-8">
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900"
              onClick={() => navigate(`/shared`)}
            >
              Open job files
            </button>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-600"
              onClick={() => {
                setStep('paste');
                setText('');
                setProposal(null);
                setResult(null);
              }}
            >
              Start another
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
