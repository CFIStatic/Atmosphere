import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  humanize,
  timeAgo,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type CrmAccount,
  type CrmLead,
  type LeadStage,
} from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';
import { LeadDrawer } from '../components/sales/LeadDrawer';
import { NewLeadDialog } from '../components/sales/NewLeadDialog';
import { PlusIcon } from '../components/icons';

/** Work in hand, not yet won — the open stages, left to right. */
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'estimate_sent'];

function dollars(amount: number): string {
  if (Math.abs(amount) >= 100_000) {
    return `$${(amount / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`;
  }
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * The Sales Platform's board: every lead by the stage it sits in, with the
 * money each stage represents. Won and lost are kept off the board and
 * summarised above it — a pipeline should show what is still winnable.
 */
export function PipelinePage() {
  const [leads, setLeads] = useState<CrmLead[] | null>(null);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .crmLeads()
      .then(({ items }) => {
        setLeads(items);
        setError(null);
      })
      .catch((err) => {
        setLeads([]);
        setError(err instanceof Error ? err.message : 'Could not load the pipeline.');
      });
  }, []);

  useEffect(() => {
    load();
    api.crmAccounts().then(({ items }) => setAccounts(items)).catch(() => setAccounts([]));
  }, [load]);

  const open = leads?.find((l) => l.id === openId) ?? null;

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, CrmLead[]>();
    for (const stage of LEAD_STAGES) map.set(stage, []);
    for (const lead of leads ?? []) map.get(lead.status)?.push(lead);
    return map;
  }, [leads]);

  const openValue = OPEN_STAGES.reduce(
    (sum, stage) =>
      sum + (byStage.get(stage) ?? []).reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
    0,
  );
  const won = byStage.get('won') ?? [];
  const lost = byStage.get('lost') ?? [];
  const decided = won.length + lost.length;
  const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="Pipeline"
        description="Every lead by the stage it sits in. The agent works this board — drafting the follow-up, flagging what has gone quiet — and you decide what it sends."
        action={
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
          >
            <PlusIcon width={15} height={15} />
            New lead
          </button>
        }
      />

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {leads === null && <PanelSpinner label="Loading the pipeline" />}

      {leads !== null && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Open value" value={dollars(openValue)} sub="Across winnable stages" />
            <Stat
              label="Open leads"
              value={String(OPEN_STAGES.reduce((n, s) => n + (byStage.get(s) ?? []).length, 0))}
              sub="Not yet won or lost"
            />
            <Stat label="Won" value={String(won.length)} sub="Converted to jobs" />
            <Stat
              label="Win rate"
              value={winRate !== null ? `${winRate}%` : '—'}
              sub={decided > 0 ? `${decided} decided` : 'Nothing decided yet'}
            />
          </div>

          {leads.length === 0 && !error ? (
            <EmptyState
              title="No leads yet"
              hint="Leads land here from the web form, a phone call, or a carrier assignment — then move stage by stage until they convert to jobs."
            />
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-[900px] grid-cols-4 gap-3">
                {OPEN_STAGES.map((stage) => {
                  const items = byStage.get(stage) ?? [];
                  const value = items.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
                  return (
                    <section key={stage} className="rounded-xl glass-card">
                      <header className="border-b border-line px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <h2 className="text-[13px] font-semibold text-ink-900">
                            {LEAD_STAGE_LABELS[stage]}
                          </h2>
                          <span className="text-[11px] tabular-nums text-ink-500">
                            {items.length}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] tabular-nums text-ink-500">
                          {value > 0 ? dollars(value) : '—'}
                        </p>
                      </header>
                      <div className="space-y-2 p-3">
                        {items.map((lead) => (
                          <button
                            key={lead.id}
                            onClick={() => setOpenId(lead.id)}
                            className="w-full rounded-lg border border-line bg-paper-200/60 px-3 py-2.5 text-left transition hover:border-brand-500/50 hover:bg-paper-300/50"
                          >
                            <p className="text-[13px] font-semibold leading-snug text-ink-900">
                              {lead.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
                              {lead.estimatedValue != null && (
                                <span className="font-semibold tabular-nums text-ink-700">
                                  {dollars(lead.estimatedValue)}
                                </span>
                              )}
                              {lead.source && <span>{humanize(lead.source)}</span>}
                              {lead.updatedAt && <span>· {timeAgo(lead.updatedAt)}</span>}
                            </div>
                          </button>
                        ))}
                        {items.length === 0 && (
                          <p className="px-1 py-4 text-center text-[12px] text-ink-500">Empty</p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {(won.length > 0 || lost.length > 0) && (
            <section className="mt-5 rounded-xl glass-card">
              <header className="border-b border-line px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-ink-900">Decided</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  Won leads become jobs; lost ones keep their reason so the next bid is better.
                </p>
              </header>
              {[...won, ...lost].slice(0, 8).map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => setOpenId(lead.id)}
                  className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-b-0 hover:bg-paper-200/50"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      lead.status === 'won'
                        ? 'bg-success-50 text-success-600'
                        : 'bg-paper-200 text-ink-600'
                    }`}
                  >
                    {LEAD_STAGE_LABELS[lead.status]}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-ink-800">{lead.title}</p>
                  {lead.status === 'lost' && lead.lostReason && (
                    <span className="hidden truncate text-xs text-ink-500 sm:block">
                      {lead.lostReason}
                    </span>
                  )}
                  {lead.estimatedValue != null && (
                    <span className="text-sm font-semibold tabular-nums text-ink-900">
                      {dollars(lead.estimatedValue)}
                    </span>
                  )}
                </button>
              ))}
              <div className="px-5 py-3">
                <Link to="/jobs" className="text-xs font-medium text-brand-600">
                  See the jobs they became →
                </Link>
              </div>
            </section>
          )}
        </>
      )}

      {open && (
        <LeadDrawer
          lead={open}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
      {creating && (
        <NewLeadDialog
          accounts={accounts}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl glass-card px-4 py-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink-900">{value}</p>
      <p className="mt-1 truncate text-xs text-ink-500">{sub}</p>
    </div>
  );
}
