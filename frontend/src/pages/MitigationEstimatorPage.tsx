import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type MitigationEstimate, type XactimateStatus } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { SpinnerIcon } from '../components/icons';
import { SourcePanel, type Sources } from '../components/estimator/SourcePanel';
import { EstimateResult } from '../components/estimator/EstimateResult';
import { XactimateCard } from '../components/estimator/XactimateCard';
import { SymbilityCard } from '../components/estimator/SymbilityCard';

/**
 * The Mitigation Estimator workspace.
 *
 * Sources on the left, the finished estimate on the right, and a build step that
 * is cheap enough to re-run whenever anything changes. The two deliberate
 * separations:
 *
 *   - **Build ≠ save.** Building is free and stateless; saving is what puts a
 *     claim number and a loss address in the database, so it is its own button.
 *   - **Save ≠ push.** Writing into a real Xactimate account needs a live
 *     connection, an explicit write permission, and — when the review found
 *     something critical — a confirmation. Pushing a bad estimate is worse than
 *     not pushing one.
 */

const EMPTY_SOURCES: Sources = { photos: [], notes: '' };

export function MitigationEstimatorPage() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<Sources>(EMPTY_SOURCES);
  const [estimate, setEstimate] = useState<MitigationEstimate | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [xactimate, setXactimate] = useState<XactimateStatus | null>(null);

  const hasSources = Boolean(
    sources.docusketch || sources.mica || sources.photos.length > 0 || sources.notes.trim(),
  );

  // The push button's enabled state depends on the connection, so the status is
  // read once on mount and again whenever the connection card changes it.
  useEffect(() => {
    let cancelled = false;
    api
      .xactimateStatus()
      .then((status) => {
        if (!cancelled) setXactimate(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function payload() {
    return {
      jobId: jobId ?? undefined,
      docusketch: sources.docusketch,
      mica: sources.mica,
      photos: sources.photos.length ? sources.photos : undefined,
      notes: sources.notes.trim() || undefined,
    };
  }

  async function build() {
    setBuilding(true);
    setError(null);
    setNotice(null);
    // A saved estimate is a snapshot of one moment, so rebuilding invalidates
    // the saved one and its export links. The *job* id is kept — deviations are
    // recorded against the job and must survive a rebuild, which is the whole
    // reason accepting one can trigger a rebuild at all.
    setEstimateId(null);
    try {
      const { estimate } = await api.buildEstimate(payload());
      setEstimate(estimate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the estimate.');
    } finally {
      setBuilding(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveEstimate(payload());
      setEstimate(result.estimate);
      setEstimateId(result.estimateId);
      // The agent's own job id, not the database row — deviations are recorded
      // against it so they survive a rebuild.
      setJobId(result.estimate.jobId);
      setNotice('Saved. Exports are available below.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the estimate.');
    } finally {
      setSaving(false);
    }
  }

  async function push() {
    if (!estimate) return;
    setPushing(true);
    setError(null);
    try {
      const result = await api.xactimatePush(estimate, false);
      setNotice(
        `Wrote ${result.lineItemsWritten} line items into Xactimate as ${result.estimateId}.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sla_blocked') {
        setError(
          'This estimate breaches its carrier program terms. Resolve them above, or accept a documented deviation for each, then rebuild.',
        );
      } else if (err instanceof ApiError && err.status === 409) {
        // The server refused because critical findings are outstanding. Make the
        // user look at them rather than offering a one-click override.
        setError(
          'This estimate still has critical findings. Work through the review above, rebuild, and push again.',
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not write to Xactimate.');
      }
    } finally {
      setPushing(false);
    }
  }

  async function loadDemo() {
    setError(null);
    try {
      const { sources: demo } = await api.getDemoSources();
      setSources({
        docusketch: demo.docusketch,
        mica: demo.mica,
        photos: demo.photos ?? [],
        notes: demo.notes ?? '',
      });
      setEstimate(null);
      setEstimateId(null);
      setJobId(null);
      setNotice('Demo job loaded — build it to see the whole pipeline.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the demo job.');
    }
  }

  const canPush = Boolean(
    xactimate?.connected && xactimate.sessionActive && xactimate.scopes.includes('write_estimate'),
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-600">Mitigation</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-900">Estimator</h1>
          <p className="mt-2 max-w-2xl text-ink-600">
            Give it the scan, the drying record, the photos and your notes. It classifies the loss
            against IICRC S500, scopes the work, prices it against your Xactimate price list, and
            tells you what documented work is not yet on the estimate.
          </p>
        </div>

        {error && (
          <p className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-600">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-6 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-600">
            {notice}
          </p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-6">
            <XactimateCard
              onPriceListSynced={() => {
                void api.xactimateStatus().then(setXactimate);
                if (hasSources) void build();
              }}
            />

            {/* The other estimating platform, same contract: web sign-in as
                the user, scoped consent, session-only by default. */}
            <SymbilityCard />

            <SourcePanel
              sources={sources}
              onChange={setSources}
              onLoadDemo={loadDemo}
              busy={building}
            />

            <div className="space-y-2">
              <button
                onClick={build}
                disabled={building || !hasSources}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                {building && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                {building ? 'Building…' : 'Build estimate'}
              </button>

              {estimate && (
                <button
                  onClick={save}
                  disabled={saving}
                  className="w-full rounded-lg border border-line bg-paper-200 px-4 py-2.5 text-sm text-ink-800 transition hover:bg-paper-300 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save this estimate'}
                </button>
              )}

              {estimateId && (
                <div className="flex gap-2">
                  {(
                    [
                      ['csv', 'Line items (CSV)'],
                      ['scope', 'Scope sheet'],
                      ['xml', 'Sketch XML'],
                    ] as const
                  ).map(([format, label]) => (
                    <a
                      key={format}
                      href={api.estimateExportUrl(estimateId, format)}
                      className="flex-1 rounded-lg glass-card px-2 py-2 text-center text-xs text-ink-700 transition hover:bg-paper-200"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}

              {/* The estimate flows straight into purchasing: same id, no
                  re-picking from a list. Saved only — the takeoff reads the
                  stored payload, and an unsaved estimate has none. */}
              {estimateId && (
                <button
                  onClick={() => navigate(`/purchase-orders?from=${estimateId}`)}
                  className="w-full rounded-lg border border-brand-200 bg-brand-600/10 px-4 py-2.5 text-sm font-semibold text-brand-600 transition hover:bg-brand-600/20"
                >
                  Order the materials →
                </button>
              )}
            </div>
          </div>

          <div>
            {estimate ? (
              <EstimateResult
                estimate={estimate}
                onPush={push}
                pushing={pushing}
                canPush={canPush}
                jobId={jobId}
                // Accepting a deviation changes what the terms check concludes,
                // so the estimate is rebuilt rather than patched in place.
                onDeviationAccepted={() => void build()}
              />
            ) : (
              <div className="grid h-64 place-items-center rounded-xl border border-dashed border-line text-center">
                <div>
                  <p className="text-ink-600">No estimate yet.</p>
                  <p className="mt-1 text-sm text-ink-500">
                    Add a source and build, or load the demo job to see what it produces.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
