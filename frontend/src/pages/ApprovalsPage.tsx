import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, type Escalation } from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';
import { ShieldIcon } from '../components/icons';

/**
 * The approvals center: every place an agent stopped and asked for a person,
 * in one queue. Each card is the verifier's question verbatim, with the
 * options it can act on — approving here is what lets the run continue.
 */
export function ApprovalsPage() {
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api
      .getEscalations(showResolved)
      .then(({ escalations }) => {
        setEscalations(escalations);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load approvals.'));
  }, [showResolved]);

  useEffect(() => {
    setEscalations(null);
    load();
  }, [load]);

  async function resolve(escalation: Escalation, optionId: string) {
    setResolving(`${escalation.id}:${optionId}`);
    try {
      await api.resolveEscalation(escalation.id, optionId, note.trim() || undefined);
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that decision.');
    } finally {
      setResolving(null);
    }
  }

  const open = (escalations ?? []).filter((e) => e.status === 'open');
  const settled = (escalations ?? []).filter((e) => e.status !== 'open');

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operate"
        title="Approvals"
        description="Where an agent stopped and asked. Nothing on this page happens without your sign-off — that is the product working, not failing."
        action={
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="h-4 w-4 accent-[#E8590C]"
            />
            Show settled
          </label>
        }
      />

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {escalations === null && <PanelSpinner label="Loading approvals" />}

      {escalations !== null && open.length === 0 && (
        <EmptyState
          title="Nothing waiting on you"
          hint="When an agent needs a decision — an indeterminate verification, a repair it won't make alone — it lands here."
        />
      )}

      <div className="space-y-4">
        {open.map((escalation) => (
          <section
            key={escalation.id}
            className="rounded-xl border border-line bg-paper-0 shadow-card"
          >
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-caution-50 text-caution-600">
                <ShieldIcon width={16} height={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[11px] font-semibold text-caution-600">
                    Needs approval
                  </span>
                  <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                    {escalation.reason.replace(/_/g, ' ')}
                  </span>
                  {escalation.context.siteLabel && (
                    <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                      {escalation.context.siteLabel}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-500">{timeAgo(escalation.createdAt)}</span>
                </div>
                <h2 className="mt-2 text-[15px] font-semibold leading-snug text-ink-900">
                  {escalation.question}
                </h2>
                {escalation.context.runInstruction && (
                  <p className="mt-1 text-[13px] text-ink-600">
                    Task: {escalation.context.runInstruction}
                  </p>
                )}
              </div>
            </header>

            {escalation.context.unsettled && escalation.context.unsettled.length > 0 && (
              <div className="border-b border-line px-5 py-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
                  What the verifier saw
                </p>
                <div className="mt-2 space-y-2">
                  {escalation.context.unsettled.map((u, i) => (
                    <div key={i} className="rounded-lg border border-line bg-paper-50 p-3">
                      <p className="text-[13px] font-medium text-ink-900">{u.expectation}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">{u.evidence}</p>
                      {u.proposedFix && (
                        <p className="mt-1.5 text-xs text-brand-600">Proposed: {u.proposedFix}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {escalation.options.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => resolve(escalation, option.id)}
                    disabled={resolving !== null}
                    className={`rounded-lg border px-3.5 py-2.5 text-left transition disabled:opacity-50 ${
                      option.action === 'repair'
                        ? 'border-brand-500 bg-brand-50 hover:bg-brand-100'
                        : 'border-line bg-paper-0 hover:border-line-strong'
                    }`}
                  >
                    <p className="text-sm font-semibold text-ink-900">
                      {resolving === `${escalation.id}:${option.id}` ? 'Recording…' : option.label}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-600">{option.detail}</p>
                  </button>
                ))}
              </div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the record…"
                className="mt-3 w-full rounded-lg border border-line bg-paper-50 px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none transition focus:border-brand-500"
              />
            </div>
          </section>
        ))}

        {showResolved && settled.length > 0 && (
          <section>
            <h2 className="mb-2 mt-8 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
              Settled
            </h2>
            <div className="rounded-xl border border-line bg-paper-0 shadow-card">
              {settled.map((escalation) => (
                <div
                  key={escalation.id}
                  className="border-b border-line px-5 py-3.5 last:border-b-0"
                >
                  <p className="text-sm font-medium text-ink-800">{escalation.question}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {escalation.status}
                    {escalation.chosenOption ? ` — ${escalation.chosenOption}` : ''}
                    {escalation.resolvedAt ? ` · ${timeAgo(escalation.resolvedAt)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
