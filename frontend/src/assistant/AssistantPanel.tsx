import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Bot, PanelRightClose, Sparkles, TrendingUp } from 'lucide-react';
import { Badge, Button, EmptyState, Textarea, cn } from '../design';
import {
  useApprovals,
  useApproveRequest,
  useRecommendations,
  useRejectRequest,
} from '../data/hooks';
import { CAPABILITY_LABELS } from '../domain/routing';
import { compareUrgency } from '../domain/approvals';
import { money } from '../domain/format';
import { ActionProposal } from '../patterns/ActionProposal';
import { riskTone } from '../patterns/tone';
import type { Role } from '../domain/types';
import { useAssistant } from './AssistantContext';

/**
 * The persistent contextual panel.
 *
 * Present on every major page, and deliberately *not* a chat window. When idle
 * it answers "what should I do next?" with real recommendations and the live
 * approval queue; conversation is one mode within it, not its purpose. That
 * ordering is what keeps it an operational surface rather than a chatbot bolted
 * to the side of a dashboard.
 */

export function AssistantPanel({ role, onClose }: { role: Role; onClose?: () => void }) {
  const { messages, thinking, send, contextLabel } = useAssistant();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: recommendations = [] } = useRecommendations();
  const { data: approvals = [] } = useApprovals();
  const approve = useApproveRequest();
  const reject = useRejectRequest();

  const pending = approvals.filter((a) => a.status === 'proposed').sort(compareUrgency);
  const conversing = messages.length > 0 || thinking;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  }

  return (
    <aside
      aria-label="Atmosphere assistant"
      className="flex h-full w-full flex-col border-l border-line/10 bg-sunken/70 backdrop-blur-xl"
    >
      <header className="flex h-topbar shrink-0 items-center justify-between gap-2 border-b border-line/10 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-brand-400 to-brand-700">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-fg">Atmosphere</p>
            <p className="truncate text-2xs text-fg-3">{contextLabel}</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="rounded-md p-1 text-fg-3 transition hover:bg-line/5 hover:text-fg-2"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-3">
        {conversing ? (
          <>
            {messages.map((m) => (
              <div key={m.id}>
                {m.author === 'user' ? (
                  <div className="ml-6 rounded-xl rounded-br-sm bg-brand-600/20 px-3 py-2 text-sm text-fg">
                    {m.text}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-fg-2">{m.text}</p>
                        {m.routing && (
                          <p className="mt-1.5 text-2xs text-fg-4">
                            Routed to {CAPABILITY_LABELS[m.routing.capability]} ·{' '}
                            {Math.round(m.routing.confidence * 100)}% confidence
                            {m.routing.matched.length > 0 && ` · matched “${m.routing.matched[0]}”`}
                          </p>
                        )}
                      </div>
                    </div>
                    {m.proposal && (
                      <ActionProposal
                        request={approvals.find((a) => a.id === m.proposal?.id) ?? m.proposal}
                        role={role}
                        variant="compact"
                        onApprove={(id) => approve.mutate(id)}
                        onReject={(id) => reject.mutate(id)}
                        busy={approve.isPending || reject.isPending}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-fg-3">
                <Bot className="h-4 w-4 animate-pulse-soft text-brand-400" />
                Routing your request…
              </div>
            )}
          </>
        ) : (
          <>
            {/* Idle state: what needs attention, not an empty chat box. */}
            <Panel
              title="Recommended next"
              icon={<TrendingUp className="h-3.5 w-3.5 text-brand-400" />}
            >
              {recommendations.length === 0 ? (
                <EmptyState title="Nothing needs your attention" className="py-6" />
              ) : (
                <ul className="space-y-1.5">
                  {recommendations.slice(0, 4).map((rec) => (
                    <li key={rec.id}>
                      <button
                        type="button"
                        onClick={() => send(rec.command)}
                        className="w-full rounded-lg border border-line/10 bg-surface/60 p-2.5 text-left transition hover:border-line/20 hover:bg-raised/60"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium leading-snug text-fg-2">{rec.title}</p>
                          <Badge tone={riskTone[rec.severity]}>{rec.severity}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-fg-3">
                          {rec.rationale}
                        </p>
                        {rec.estimatedValue !== null && (
                          <p className="mt-1 text-2xs font-medium text-state-ok">
                            {money(rec.estimatedValue)} at stake
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={`Awaiting approval${pending.length ? ` · ${pending.length}` : ''}`}
              icon={<Sparkles className="h-3.5 w-3.5 text-state-warn" />}
              action={
                pending.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => navigate('/approvals')}
                    className="text-2xs font-medium text-brand-400 transition hover:text-brand-300"
                  >
                    View all
                  </button>
                ) : undefined
              }
            >
              {pending.length === 0 ? (
                <EmptyState title="Approval queue is clear" className="py-6" />
              ) : (
                <div className="space-y-2">
                  {pending.slice(0, 2).map((request) => (
                    <ActionProposal
                      key={request.id}
                      request={request}
                      role={role}
                      variant="compact"
                      onApprove={(id) => approve.mutate(id)}
                      onReject={(id) => reject.mutate(id)}
                      busy={approve.isPending || reject.isPending}
                    />
                  ))}
                </div>
              )}
            </Panel>
          </>
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-line/10 p-3">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            rows={2}
            placeholder="Ask Atmosphere to do something…"
            className="resize-none pr-10 text-sm"
          />
          <Button
            type="submit"
            size="icon"
            variant="primary"
            disabled={!draft.trim()}
            aria-label="Send"
            className={cn('absolute bottom-2 right-2')}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-2xs text-fg-4">
          Atmosphere proposes; you approve. Nothing changes without sign-off.
        </p>
      </form>
    </aside>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-3">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
