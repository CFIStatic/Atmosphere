import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  PROVIDER_LABELS,
  ESTIMATOR_STAGE_LABELS,
  api,
  type ConstructionEstimate,
  type EstimatorCredentialInput,
  type EstimateLineItem,
  type EstimatorProvider,
  type EstimatorRun,
  type EstimatorStatus,
  type MatchCandidate,
  type EstimatorRunStage,
  type ScanProjectSummary,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { AlertIcon, CheckIcon, DownloadIcon, SpinnerIcon } from '../components/icons';

/**
 * Construction Estimator.
 *
 * The agent does the reading and the arithmetic; this page is where a person
 * checks its work. Two moments matter and both are explicit here: choosing the
 * right CRM job when the matcher could not, and approving the estimate before
 * anything is written into Xactimate. Everything else — stage progress, the
 * event log, per-line rationale — exists so those two decisions can be made
 * with the evidence in view rather than on trust.
 */

const PROVIDERS: EstimatorProvider[] = ['docusketch', 'dash', 'xactimate'];

/** Ordered for the progress rail; terminal stages are handled separately. */
const STAGE_SEQUENCE: EstimatorRunStage[] = [
  'connecting',
  'fetching_scan',
  'matching_job',
  'analyzing_photos',
  'reading_mitigation',
  'building_scope',
  'pricing',
  'awaiting_review',
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

function ConnectionCard({
  status,
  onChanged,
}: {
  status: EstimatorStatus;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<EstimatorProvider | null>(null);
  const [form, setForm] = useState<EstimatorCredentialInput>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const stored = useMemo(
    () => new Map(status.credentials.map((entry) => [entry.provider, entry])),
    [status.credentials],
  );

  async function save(provider: EstimatorProvider) {
    setBusy(true);
    setMessage(null);
    try {
      await api.saveEstimatorCredential(provider, form);
      setOpen(null);
      setForm({});
      setMessage({ tone: 'ok', text: `${PROVIDER_LABELS[provider]} connected.` });
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function test(provider: EstimatorProvider) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.testEstimatorCredential(provider);
      setMessage({ tone: 'ok', text: `Signed in to ${result.connector}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(provider: EstimatorProvider) {
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteEstimatorCredential(provider);
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-paper-0 p-5">
      <h2 className="text-lg font-semibold text-ink-900">Connections</h2>
      <p className="mt-1 text-sm text-ink-600">
        The estimator signs in to these on your organization's behalf. Credentials are encrypted
        before they are stored and are never shown again — not even to you.
      </p>

      {status.sandbox && (
        <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-sm text-caution-600">
          This server is running in sandbox mode. Runs use built-in sample data and no vendor
          account is touched.
        </p>
      )}

      {!status.credentialStorageAvailable && (
        <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          Credential storage is not configured on this server. Set{' '}
          <code className="font-mono">ESTIMATOR_CREDENTIAL_KEY</code> to connect a vendor account.
        </p>
      )}

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
        {PROVIDERS.map((provider) => {
          const credential = stored.get(provider);
          return (
            <li key={provider} className="bg-paper-0 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{PROVIDER_LABELS[provider]}</p>
                  <p className="text-xs text-ink-500">
                    {credential
                      ? `Connected · secret ${credential.fingerprint}${
                          credential.label ? ` · ${credential.label}` : ''
                        }`
                      : 'Not connected'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {credential && (
                    <button
                      onClick={() => test(provider)}
                      disabled={busy}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100 disabled:opacity-50"
                    >
                      Test
                    </button>
                  )}
                  {status.canManageCredentials && (
                    <>
                      <button
                        onClick={() => {
                          setOpen(open === provider ? null : provider);
                          setForm({});
                        }}
                        className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs text-ink-800 transition hover:bg-paper-100"
                      >
                        {credential ? 'Replace' : 'Connect'}
                      </button>
                      {credential && (
                        <button
                          onClick={() => disconnect(provider)}
                          disabled={busy}
                          className="rounded-lg px-2 py-1.5 text-xs text-ink-500 transition hover:text-danger-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {open === provider && (
                <form
                  className="mt-3 grid gap-2 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(provider);
                  }}
                >
                  <CredentialField
                    label="API key"
                    value={form.apiKey ?? ''}
                    type="password"
                    onChange={(apiKey) => setForm((f) => ({ ...f, apiKey }))}
                  />
                  <CredentialField
                    label="Account / company ID"
                    value={form.accountId ?? ''}
                    onChange={(accountId) => setForm((f) => ({ ...f, accountId }))}
                  />
                  <CredentialField
                    label="Username"
                    value={form.username ?? ''}
                    onChange={(username) => setForm((f) => ({ ...f, username }))}
                  />
                  <CredentialField
                    label="Password"
                    type="password"
                    value={form.password ?? ''}
                    onChange={(password) => setForm((f) => ({ ...f, password }))}
                  />
                  <CredentialField
                    label="API host (optional)"
                    placeholder="https://api.vendor.com/v1"
                    value={form.baseUrl ?? ''}
                    onChange={(baseUrl) => setForm((f) => ({ ...f, baseUrl }))}
                  />
                  <CredentialField
                    label="Label (optional)"
                    value={form.label ?? ''}
                    onChange={(label) => setForm((f) => ({ ...f, label }))}
                  />
                  <div className="sm:col-span-2">
                    <p className="text-xs text-ink-500">
                      Provide an API key, or a username and password — whichever your{' '}
                      {PROVIDER_LABELS[provider]} account uses.
                    </p>
                    <button
                      type="submit"
                      disabled={busy}
                      className="mt-2 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
                    >
                      {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                      Save credentials
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {message && (
        <p
          className={`mt-3 text-sm ${message.tone === 'ok' ? 'text-success-600' : 'text-danger-700'}`}
          role="status"
        >
          {message.text}
        </p>
      )}

      {!status.modelAvailable && (
        <p className="mt-3 text-xs text-ink-500">
          No model is configured on this server, so photos and job notes will not be read. Scope
          will be built from the scan measurements and the mitigation estimate.
        </p>
      )}
    </section>
  );
}

function CredentialField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-ink-600">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Starting a run                                                      */
/* ------------------------------------------------------------------ */

function StartRunCard({ onStarted }: { onStarted: (run: EstimatorRun) => void }) {
  const [projects, setProjects] = useState<ScanProjectSummary[] | null>(null);
  const [selected, setSelected] = useState('');
  const [mitigationText, setMitigationText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listScanProjects()
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);
        setSelected(list[0]?.id ?? '');
      })
      .catch((err) => {
        if (!cancelled) {
          setProjects([]);
          setError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { run } = await api.startEstimatorRun(selected, mitigationText.trim() || undefined);
      setMitigationText('');
      onStarted(run);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-paper-0 p-5">
      <h2 className="text-lg font-semibold text-ink-900">Build an estimate</h2>
      <p className="mt-1 text-sm text-ink-600">
        Pick a DocuSketch scan. The estimator finds the matching job in Dash, reads the photos and
        the job notes, and builds a rebuild scope. It stops for your review before anything is
        written to Xactimate.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-ink-600">Scan project</span>
        {projects === null ? (
          <div className="mt-2 flex items-center gap-2 text-sm text-ink-500">
            <SpinnerIcon className="animate-spin" width={16} height={16} /> Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">
            No scan projects are available. Connect DocuSketch above.
          </p>
        ) : (
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.claimNumber ? ` · ${project.claimNumber}` : ''}
                {project.address ? ` · ${project.address}` : ''}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="mt-4 block text-sm">
        <span className="text-ink-600">Mitigation estimate (optional)</span>
        <p className="text-xs text-ink-500">
          Paste the mitigation estimate — a CSV export, an XML interchange file, or text copied out
          of the PDF. Everything that was torn out gets scoped back in. If you leave this empty the
          estimator looks for one on the job in Dash.
        </p>
        <textarea
          value={mitigationText}
          onChange={(event) => setMitigationText(event.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={'Room,Code,Description,Quantity,Unit\nMaster Bedroom,DMO CRPT,"Remove carpet",224.00,SF'}
          className="mt-2 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 font-mono text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        />
      </label>

      {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}

      <button
        onClick={() => void start()}
        disabled={busy || !selected}
        className="mt-4 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
      >
        {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
        Start estimate
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Run progress                                                        */
/* ------------------------------------------------------------------ */

function StageRail({ run }: { run: EstimatorRun }) {
  const currentIndex = STAGE_SEQUENCE.indexOf(run.stage);

  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
      {STAGE_SEQUENCE.map((stage, index) => {
        const done =
          run.status === 'complete' || (currentIndex >= 0 && index < currentIndex);
        const active = stage === run.stage && run.status !== 'failed';
        const failed = stage === run.stage && run.status === 'failed';

        return (
          <li
            key={stage}
            className={`rounded-full px-2.5 py-1 ${
              failed
                ? 'bg-danger-50 text-danger-700'
                : active
                  ? 'bg-brand-50 text-brand-700'
                  : done
                    ? 'bg-success-50 text-success-600'
                    : 'bg-paper-0 text-ink-500'
            }`}
          >
            {ESTIMATOR_STAGE_LABELS[stage]}
          </li>
        );
      })}
    </ol>
  );
}

function JobReview({
  run,
  onSelected,
}: {
  run: EstimatorRun;
  onSelected: (run: EstimatorRun) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(candidate: MatchCandidate) {
    setBusy(candidate.jobId);
    setError(null);
    try {
      onSelected((await api.selectEstimatorJob(run.id, candidate.jobId)).run);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-caution-200 bg-caution-50 p-4">
      <div className="flex items-start gap-2">
        <AlertIcon className="mt-0.5 shrink-0 text-caution-600" width={18} height={18} />
        <div>
          <p className="text-sm font-medium text-caution-600">Which job is this scan?</p>
          <p className="mt-1 text-sm text-caution-600">
            {run.matchReason ??
              'The estimator could not identify the job with enough confidence to continue on its own.'}
          </p>
        </div>
      </div>

      {run.matchCandidates.length === 0 ? (
        <p className="mt-3 text-sm text-caution-600">
          No candidate jobs came back from the CRM. Check the claim number on the scan.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {run.matchCandidates.map((candidate) => (
            <li
              key={candidate.jobId}
              className="rounded-lg border border-line bg-paper-50 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {candidate.jobNumber ?? candidate.jobId}
                    {candidate.claimNumber && (
                      <span className="ml-2 font-mono text-xs text-brand-600">
                        {candidate.claimNumber}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-600">
                    {[candidate.insuredName, candidate.address, candidate.lossDate]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {candidate.signals.map((signal) => (
                      <li key={signal.field} className="text-xs text-ink-500">
                        <span
                          className={
                            signal.score > 0.7
                              ? 'text-success-600'
                              : signal.score > 0.3
                                ? 'text-amber-400'
                                : 'text-ink-400'
                          }
                        >
                          ●
                        </span>{' '}
                        {signal.detail}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="rounded-full bg-paper-0 px-2.5 py-1 text-xs text-ink-700">
                    {candidate.score}/100
                  </span>
                  <button
                    onClick={() => void choose(candidate)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
                  >
                    {busy === candidate.jobId && (
                      <SpinnerIcon className="animate-spin" width={14} height={14} />
                    )}
                    Use this job
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
    </div>
  );
}

function EstimateTable({ estimate }: { estimate: ConstructionEstimate }) {
  const byRoom = useMemo(() => {
    const rooms = new Map<string, EstimateLineItem[]>();
    for (const line of estimate.lineItems) {
      const bucket = rooms.get(line.roomName);
      if (bucket) bucket.push(line);
      else rooms.set(line.roomName, [line]);
    }
    return [...rooms.entries()];
  }, [estimate]);

  return (
    <div className="mt-4 space-y-4">
      {byRoom.map(([roomName, lines]) => (
        <div key={roomName} className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between bg-paper-0 px-4 py-2">
            <h4 className="text-sm font-semibold text-ink-900">{roomName}</h4>
            <span className="text-xs text-ink-500">{lines.length} line items</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-paper-0 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((line, index) => (
                  <tr key={`${line.code}-${index}`} className="bg-paper-0 align-top">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-brand-600">
                      {line.code}
                    </td>
                    <td className="px-4 py-2">
                      <p className="text-ink-800">{line.description}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{line.rationale}</p>
                      {line.needsReview && (
                        <span className="mt-1 inline-block rounded-full bg-caution-50 px-2 py-0.5 text-[11px] text-caution-600">
                          check this line
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-ink-800">
                      {line.quantityWithWaste.toFixed(2)}
                      {line.quantityWithWaste !== line.quantity && (
                        <span className="block text-[11px] text-ink-500">
                          {line.quantity.toFixed(2)} + waste
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-600">{line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function RunPanel({
  run,
  onUpdated,
}: {
  run: EstimatorRun;
  onUpdated: (run: EstimatorRun) => void;
}) {
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  async function approve() {
    setApproving(true);
    setApproveError(null);
    try {
      onUpdated((await api.approveEstimatorRun(run.id)).run);
    } catch (err) {
      setApproveError(errorMessage(err));
    } finally {
      setApproving(false);
    }
  }

  const estimate = run.estimate;
  const readyToApprove = run.status === 'awaiting_review' && estimate !== null;

  return (
    <section className="rounded-xl border border-line bg-paper-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            {estimate?.claimNumber ?? run.scanProjectId}
          </h2>
          <p className="text-sm text-ink-600">
            {run.job?.insuredName ?? 'Identifying the job…'}
            {run.matchScore !== null && (
              <span className="ml-2 text-xs text-ink-500">match {run.matchScore}/100</span>
            )}
          </p>
        </div>
        <StatusBadge run={run} />
      </div>

      <div className="mt-4">
        <StageRail run={run} />
      </div>

      {run.error && (
        <p className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {run.error}
        </p>
      )}

      {run.matchNeedsReview && run.status === 'awaiting_review' && (
        <JobReview run={run} onSelected={onUpdated} />
      )}

      {estimate && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Stat label="Line items" value={String(estimate.summary.lineItemCount)} />
            <Stat label="Rooms" value={String(estimate.summary.roomCount)} />
            <Stat
              label="Flagged"
              value={String(estimate.summary.itemsNeedingReview)}
              tone={estimate.summary.itemsNeedingReview > 0 ? 'warn' : 'ok'}
            />
            <Stat
              label="Built from"
              value={
                estimate.basis === 'both'
                  ? 'Photos + mitigation'
                  : estimate.basis === 'mitigation'
                    ? 'Mitigation estimate'
                    : 'Scan + photos'
              }
            />
          </div>

          {estimate.warnings.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-lg border border-caution-200 bg-caution-50 p-3">
              {estimate.warnings.map((warning, index) => (
                <li key={index} className="flex gap-2 text-sm text-caution-600">
                  <AlertIcon className="mt-0.5 shrink-0" width={14} height={14} />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}

          <EstimateTable estimate={estimate} />

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={api.estimatorExportUrl(run.id, 'csv')}
              className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm text-ink-800 transition hover:bg-paper-100"
            >
              <DownloadIcon width={16} height={16} /> CSV
            </a>
            <a
              href={api.estimatorExportUrl(run.id, 'xml')}
              className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm text-ink-800 transition hover:bg-paper-100"
            >
              <DownloadIcon width={16} height={16} /> Xactimate XML
            </a>

            {run.status === 'complete' ? (
              <span className="flex items-center gap-2 text-sm text-success-600">
                <CheckIcon width={16} height={16} />
                Written to Xactimate as {run.exportRef}
              </span>
            ) : (
              <button
                onClick={() => void approve()}
                disabled={!readyToApprove || approving}
                className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
              >
                {approving && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                Approve and send to Xactimate
              </button>
            )}
          </div>

          {approveError && <p className="mt-3 text-sm text-danger-700">{approveError}</p>}
        </>
      )}

      <button
        onClick={() => setShowLog((value) => !value)}
        className="mt-5 text-xs text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline"
      >
        {showLog ? 'Hide' : 'Show'} run log ({run.events.length})
      </button>

      {showLog && (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line bg-paper-50 p-3 font-mono text-xs">
          {run.events.map((event, index) => (
            <li
              key={index}
              className={
                event.level === 'error'
                  ? 'text-danger-700'
                  : event.level === 'warn'
                    ? 'text-caution-600'
                    : 'text-ink-600'
              }
            >
              <span className="text-ink-400">{new Date(event.at).toLocaleTimeString()} </span>
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ run }: { run: EstimatorRun }) {
  const map: Record<EstimatorRun['status'], { text: string; className: string }> = {
    running: { text: 'Running', className: 'bg-brand-50 text-brand-700' },
    awaiting_review: { text: 'Needs your review', className: 'bg-caution-50 text-caution-600' },
    complete: { text: 'Sent to Xactimate', className: 'bg-success-50 text-success-600' },
    failed: { text: 'Failed', className: 'bg-danger-50 text-danger-700' },
    cancelled: { text: 'Cancelled', className: 'bg-paper-0 text-ink-600' },
  };
  const badge = map[run.status];

  return (
    <span
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}
    >
      {run.status === 'running' && <SpinnerIcon className="animate-spin" width={12} height={12} />}
      {badge.text}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'warn' ? 'text-caution-600' : 'text-ink-900'}`}>
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function EstimatorPage() {
  const [status, setStatus] = useState<EstimatorStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<EstimatorRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    api
      .estimatorStatus()
      .then(setStatus)
      .catch((err) => setStatusError(errorMessage(err)));
  }, []);

  useEffect(loadStatus, [loadStatus]);

  useEffect(() => {
    api
      .listEstimatorRuns()
      .then(({ runs: list }) => {
        setRuns(list);
        setActiveRunId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => setRuns([]));
  }, []);

  const activeRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  const upsertRun = useCallback((run: EstimatorRun) => {
    setRuns((current) => {
      const index = current.findIndex((entry) => entry.id === run.id);
      if (index === -1) return [run, ...current];
      const next = [...current];
      next[index] = run;
      return next;
    });
    setActiveRunId(run.id);
  }, []);

  /**
   * Poll while a run is in flight. The pipeline runs on the server behind the
   * request that started it, so this is how progress reaches the page — and it
   * stops the moment the run needs a person or finishes, rather than polling
   * forever in a background tab.
   */
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    const id = window.setInterval(() => {
      api
        .getEstimatorRun(activeRun.id)
        .then(({ run }) => upsertRun(run))
        .catch(() => undefined);
    }, 2500);
    pollRef.current = id;

    return () => window.clearInterval(id);
  }, [activeRun, upsertRun]);

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 sm:px-10">
        <Logo />
        <Link
          to="/dashboard"
          className="rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
        >
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10 sm:px-10">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-600">Construction Estimator</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-900">
            From the scan to a rebuild estimate
          </h1>
          <p className="mt-2 max-w-2xl text-ink-600">
            Reads the DocuSketch photos and measurements, finds the job in Dash, works out what the
            mitigation crew took out, and builds the construction estimate that puts it back.
          </p>
        </div>

        {statusError && (
          <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {statusError}
          </p>
        )}

        {status && <ConnectionCard status={status} onChanged={loadStatus} />}

        <StartRunCard onStarted={upsertRun} />

        {activeRun && <RunPanel run={activeRun} onUpdated={upsertRun} />}

        {runs.length > 1 && (
          <section className="rounded-xl border border-line bg-paper-0 p-5">
            <h2 className="text-lg font-semibold text-ink-900">Recent runs</h2>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    onClick={() => setActiveRunId(run.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition ${
                      run.id === activeRunId ? 'bg-paper-0' : 'bg-paper-0 hover:bg-paper-0'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-ink-900">
                        {run.estimate?.claimNumber ?? run.scanProjectId}
                      </p>
                      <p className="text-xs text-ink-500">
                        {new Date(run.createdAt).toLocaleString()} ·{' '}
                        {ESTIMATOR_STAGE_LABELS[run.stage]}
                      </p>
                    </div>
                    <StatusBadge run={run} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
