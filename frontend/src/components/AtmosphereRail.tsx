import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, type Escalation, type PmOverview } from '../lib/api';
import { ArrowUpIcon, SparkIcon, SpinnerIcon } from './icons';

/**
 * The Atmosphere panel: what the agents recommend, what waits on a person,
 * and a place to ask. Its closing line is the product's contract — Atmosphere
 * proposes; you approve.
 */
export function AtmosphereRail({
  context = 'Overview',
  alerts,
  escalations,
  onResolved,
}: {
  /** Named so the panel says which screen it is reasoning about. */
  context?: string;
  alerts: PmOverview['alerts'];
  escalations: Escalation[] | null;
  onResolved: () => void;
}) {
  const { membership } = useAuth();
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const first = escalations?.[0] ?? null;

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setReply(null);
    try {
      const res = await api.assist(q, [], {
        role: membership?.role,
        workType: membership?.workType,
        orgName: membership?.org?.name,
      });
      setReply(res.reply);
    } catch {
      setReply('Could not reach the assistant — try again in a moment.');
    } finally {
      setAsking(false);
    }
  }

  async function resolve(escalationId: string, optionId: string) {
    setResolving(optionId);
    try {
      await api.resolveEscalation(escalationId, optionId);
      onResolved();
    } catch {
      /* the queue re-renders from the reload either way */
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="sticky top-[73px] rounded-2xl glass-card overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-white">
          <SparkIcon width={15} height={15} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-900">Atmosphere</p>
          <p className="text-[11px] text-ink-500">Context: {context}</p>
        </div>
      </header>

      <div className="cx-scroll max-h-[calc(100vh-320px)] overflow-y-auto px-4 py-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
          Recommended next
        </p>
        <div className="mt-2 space-y-2.5">
          {alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="rounded-lg glass-card p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold leading-snug text-ink-900">{alert.title}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    alert.severity === 'critical'
                      ? 'bg-danger-50 text-danger-600'
                      : 'bg-caution-50 text-caution-600'
                  }`}
                >
                  {alert.severity === 'critical' ? 'high' : 'medium'}
                </span>
              </div>
              {(alert.detail || alert.suggestedAction) && (
                <p className="mt-1 text-xs leading-relaxed text-ink-600">
                  {alert.detail ?? alert.suggestedAction}
                </p>
              )}
              {alert.project && (
                <p className="mt-1.5 font-mono text-[11px] text-brand-600">
                  {alert.project.projectNumber}
                </p>
              )}
            </div>
          ))}
          {alerts.length === 0 && (
            <p className="text-xs text-ink-500">
              Nothing flagged — the rules sweep every project on schedule.
            </p>
          )}
        </div>

        <div className="mt-5 flex items-baseline justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
            Awaiting approval{escalations ? ` · ${escalations.length}` : ''}
          </p>
          <Link to="/approvals" className="text-[11px] font-medium text-brand-600">
            View all
          </Link>
        </div>
        <div className="mt-2">
          {first ? (
            <div className="rounded-lg border border-brand-300 bg-paper-200/50 p-3">
              <p className="text-[13px] font-semibold leading-snug text-ink-900">{first.question}</p>
              {first.context.verifierSummary && (
                <p className="mt-1 text-xs leading-relaxed text-ink-600">
                  {first.context.verifierSummary}
                </p>
              )}
              <div className="mt-2.5 space-y-1.5">
                {first.options.slice(0, 3).map((option) => (
                  <button
                    key={option.id}
                    onClick={() => resolve(first.id, option.id)}
                    disabled={resolving !== null}
                    className="w-full rounded-md border border-line px-2.5 py-1.5 text-left text-xs font-medium text-ink-800 transition hover:border-brand-500 hover:text-ink-900 disabled:opacity-50"
                  >
                    {resolving === option.id ? 'Working…' : option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              {escalations === null ? 'Loading…' : 'Nothing waiting on you.'}
            </p>
          )}
        </div>

        {reply && (
          <div className="mt-5 rounded-lg glass-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-brand-600">
              Atmosphere
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-800">
              {reply}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg glass-card p-2 focus-within:border-brand-500">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            rows={2}
            placeholder="Ask Atmosphere to do something…"
            aria-label="Ask Atmosphere"
            className="w-full resize-none bg-transparent text-[13px] text-ink-900 placeholder-ink-500 outline-none"
          />
          <button
            onClick={() => void ask()}
            disabled={asking || !question.trim()}
            aria-label="Send"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-500 text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            {asking ? (
              <SpinnerIcon className="animate-spin" width={14} height={14} />
            ) : (
              <ArrowUpIcon width={14} height={14} />
            )}
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-500">
          Atmosphere proposes; you approve. Nothing changes without sign-off.
        </p>
      </div>
    </div>
  );
}
