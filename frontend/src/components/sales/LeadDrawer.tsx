import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  humanize,
  timeAgo,
  ACTIVITY_KINDS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type ActivityKind,
  type CrmActivity,
  type CrmLead,
  type LeadStage,
} from '../../lib/api';
import { CloseIcon, SpinnerIcon } from '../icons';

const MONEY = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * One lead, opened over the board.
 *
 * A drawer rather than a page on purpose: moving a lead through its stages is
 * a rhythm — open, log the call, advance, close, next — and a route change
 * would throw away the board's scroll position every time.
 */
export function LeadDrawer({
  lead,
  onClose,
  onChanged,
}: {
  lead: CrmLead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<CrmActivity[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ActivityKind>('call');
  const [note, setNote] = useState('');
  const [lostReason, setLostReason] = useState('');

  const loadActivities = useCallback(() => {
    api
      .crmActivities({ leadId: lead.id })
      .then(({ items }) => setActivities(items))
      .catch(() => setActivities([]));
  }, [lead.id]);

  useEffect(() => {
    setActivities(null);
    loadActivities();
  }, [loadActivities]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function move(status: LeadStage) {
    setBusy(status);
    setError(null);
    try {
      await api.updateLead(lead.id, {
        status,
        ...(status === 'lost' && lostReason.trim() ? { lostReason: lostReason.trim() } : {}),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move that lead.');
    } finally {
      setBusy(null);
    }
  }

  async function log() {
    if (!note.trim()) return;
    setBusy('log');
    setError(null);
    try {
      await api.logActivity({ kind, body: note.trim(), leadId: lead.id });
      setNote('');
      loadActivities();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that.');
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy('convert');
    setError(null);
    try {
      const { job } = await api.convertLead(lead.id);
      onChanged();
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert that lead.');
      setBusy(null);
    }
  }

  const stageIndex = LEAD_STAGES.indexOf(lead.status);
  const nextStage = stageIndex >= 0 && stageIndex < 3 ? LEAD_STAGES[stageIndex + 1] : null;
  const settled = lead.status === 'won' || lead.status === 'lost';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close lead"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-label={lead.title}
        className="glass-panel relative flex h-full w-full max-w-lg flex-col overflow-hidden"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                {LEAD_STAGE_LABELS[lead.status]}
              </span>
              {lead.source && (
                <span className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                  {humanize(lead.source)}
                </span>
              )}
            </div>
            <h2 className="mt-2 text-lg font-bold leading-snug text-ink-900">{lead.title}</h2>
            <p className="mt-1 text-sm text-ink-600">
              {lead.estimatedValue != null ? MONEY(lead.estimatedValue) : 'No value set'}
              {lead.workType ? ` · ${humanize(lead.workType)}` : ''}
              {lead.updatedAt ? ` · ${timeAgo(lead.updatedAt)}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-ink-500 transition hover:text-ink-900"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <div className="cx-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {error}
            </p>
          )}

          {lead.description && (
            <Section title="Detail">
              <p className="text-sm leading-relaxed text-ink-700">{lead.description}</p>
            </Section>
          )}

          {!settled && (
            <Section title="Move it along">
              <div className="flex flex-wrap gap-2">
                {nextStage && (
                  <button
                    onClick={() => void move(nextStage)}
                    disabled={busy !== null}
                    className="flex items-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
                  >
                    {busy === nextStage && <SpinnerIcon className="animate-spin" width={14} height={14} />}
                    Advance to {LEAD_STAGE_LABELS[nextStage]}
                  </button>
                )}
                <button
                  onClick={() => void convert()}
                  disabled={busy !== null}
                  className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-2 text-sm font-semibold text-success-600 transition hover:border-success-600 disabled:opacity-50"
                >
                  {busy === 'convert' && <SpinnerIcon className="animate-spin" width={14} height={14} />}
                  Won — convert to job
                </button>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-800">
                  Mark it lost
                </summary>
                <div className="mt-2 flex gap-2">
                  <input
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="Why did it go elsewhere?"
                    className="glass-field w-full rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
                  />
                  <button
                    onClick={() => void move('lost')}
                    disabled={busy !== null}
                    className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 transition hover:text-ink-900 disabled:opacity-50"
                  >
                    Lost
                  </button>
                </div>
              </details>
            </Section>
          )}

          {lead.status === 'lost' && lead.lostReason && (
            <Section title="Why it was lost">
              <p className="text-sm text-ink-700">{lead.lostReason}</p>
            </Section>
          )}

          <Section title="Log a touch">
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition ${
                    kind === k
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-paper-200/60 text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void log();
                }}
                rows={2}
                placeholder="What happened? (⌘↵ to save)"
                className="glass-field w-full resize-none rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none"
              />
              <button
                onClick={() => void log()}
                disabled={busy !== null || !note.trim()}
                className="shrink-0 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-40"
              >
                {busy === 'log' ? '…' : 'Log'}
              </button>
            </div>
          </Section>

          <Section title="History">
            {activities === null && <p className="text-sm text-ink-500">Loading…</p>}
            {activities?.length === 0 && (
              <p className="text-sm text-ink-500">
                Nothing logged yet. Every call and email you record here stays with the lead when
                it becomes a job.
              </p>
            )}
            <div className="space-y-2">
              {(activities ?? []).map((a) => (
                <div key={a.id} className="rounded-lg border border-line bg-paper-200/40 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold capitalize text-brand-600">{a.kind}</span>
                    <span className="text-[11px] text-ink-500">
                      {timeAgo(a.occurredAt ?? a.createdAt ?? null)}
                    </span>
                  </div>
                  {a.subject && (
                    <p className="mt-1 text-[13px] font-medium text-ink-900">{a.subject}</p>
                  )}
                  {a.body && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-700">{a.body}</p>}
                </div>
              ))}
            </div>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
