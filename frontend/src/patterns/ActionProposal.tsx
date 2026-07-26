import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDashed,
  FileCheck2,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Badge, Button, Progress, StatusDot, Tooltip, cn } from '../design';
import { canApprove, executionProgress, labelForRole, peakRisk } from '../domain/approvals';
import { money, relativeTime, timeUntil } from '../domain/format';
import type { ApprovalRequest, Role } from '../domain/types';
import { approvalStatusLabel, approvalStatusTone, impactTone, riskLabel, riskTone } from './tone';

/**
 * The unit of trust in Atmosphere.
 *
 * Every agent-initiated action a human must see renders through this one
 * component, in a fixed order: what the agent knows, what it will change, what
 * that costs or earns, what could go wrong, the controls, live progress, and
 * finally proof of what happened. Because there is exactly one implementation,
 * the contract cannot quietly differ between the approvals queue, the assistant
 * panel, and an inline job action — which is the whole point. A user who learns
 * to read one of these has learned to read all of them.
 */

interface ActionProposalProps {
  request: ApprovalRequest;
  role: Role;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  busy?: boolean;
  /** `compact` omits context and evidence — for feeds and side panels. */
  variant?: 'full' | 'compact';
  className?: string;
}

export function ActionProposal({
  request,
  role,
  onApprove,
  onReject,
  busy = false,
  variant = 'full',
  className,
}: ActionProposalProps) {
  const gate = canApprove(request, role);
  const risk = peakRisk(request);
  const progress = executionProgress(request);
  const expiresIn = timeUntil(request.expiresAt);
  const isFull = variant === 'full';
  const inFlight = request.status === 'executing' || request.status === 'approved';
  const finished = request.status === 'completed';

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface/60 backdrop-blur',
        risk === 'high' && request.status === 'proposed'
          ? 'border-state-danger/30'
          : 'border-line/10',
        className,
      )}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 border-b border-line/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={approvalStatusTone[request.status]}>
              {inFlight && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {approvalStatusLabel[request.status]}
            </Badge>
            <Badge tone="brand">{request.agentName}</Badge>
            {request.jobNumber && <Badge tone="idle">{request.jobNumber}</Badge>}
            {risk && request.status === 'proposed' && (
              <Badge tone={riskTone[risk]} icon={<ShieldAlert className="h-2.5 w-2.5" />}>
                {riskLabel[risk]}
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-snug text-fg">{request.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">{request.summary}</p>
        </div>

        {request.valueAtStake !== null && (
          <div className="shrink-0 text-right">
            <p className="text-2xs uppercase tracking-wide text-fg-4">At stake</p>
            <p className="text-sm font-semibold text-fg">{money(request.valueAtStake)}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 px-4 py-3.5">
        {/* ── 1. Context ──────────────────────────────────────────────────── */}
        {isFull && request.context.length > 0 && (
          <Section label="Context">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {request.context.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-2xs text-fg-4">{item.label}</dt>
                  <dd className="truncate text-xs text-fg-2">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {/* ── 2. Proposed changes ─────────────────────────────────────────── */}
        {request.changes.length > 0 && (
          <Section label={finished ? 'Changes applied' : 'Proposed changes'}>
            <ul className="space-y-1.5">
              {request.changes.map((change, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className="text-fg-3">{change.entity}</span>
                  <span className="text-fg-2">{change.field}</span>
                  <span className="flex items-center gap-1.5 font-mono text-2xs">
                    <span className="text-fg-3 line-through">{change.from ?? 'none'}</span>
                    <ArrowRight className="h-3 w-3 text-fg-4" />
                    <span className="text-state-info">{change.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── 3. Business impact ──────────────────────────────────────────── */}
        {request.impact.length > 0 && (
          <Section label="Business impact">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {request.impact.map((item) => (
                <div key={item.label}>
                  <p className="text-2xs text-fg-4">{item.label}</p>
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      impactTone(item.direction) === 'ok' && 'text-state-ok',
                      impactTone(item.direction) === 'danger' && 'text-state-danger',
                      impactTone(item.direction) === 'idle' && 'text-fg-2',
                    )}
                  >
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 4. Risks and conflicts ──────────────────────────────────────── */}
        {request.risks.length > 0 && (
          <Section label="Risks & conflicts">
            <ul className="space-y-2">
              {request.risks.map((flag, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      flag.severity === 'high' && 'text-state-danger',
                      flag.severity === 'medium' && 'text-state-warn',
                      flag.severity === 'low' && 'text-state-info',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg-2">{flag.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{flag.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── 5. Execution progress ───────────────────────────────────────── */}
        {(inFlight || finished || request.status === 'failed') && request.steps.length > 0 && (
          <Section label="Execution">
            <Progress value={progress} tone={finished ? 'ok' : 'running'} className="mb-2.5" />
            <ul className="space-y-1.5">
              {request.steps.map((step, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {step.status === 'done' ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-state-ok" />
                  ) : step.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-state-running" />
                  ) : step.status === 'failed' ? (
                    <X className="h-3.5 w-3.5 shrink-0 text-state-danger" />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5 shrink-0 text-fg-4" />
                  )}
                  <span
                    className={cn(
                      step.status === 'done' ? 'text-fg-3' : 'text-fg-2',
                      step.status === 'pending' && 'text-fg-4',
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── 6. Evidence of completion ───────────────────────────────────── */}
        {isFull && finished && request.evidence.length > 0 && (
          <Section label="Evidence">
            <ul className="space-y-1.5">
              {request.evidence.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-state-ok" />
                  <span className="text-fg-2">{item.label}</span>
                  <span className="font-mono text-2xs text-fg-4">{item.reference}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* ── 7. Approval controls ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/10 px-4 py-3">
        <div className="flex items-center gap-2 text-2xs text-fg-4">
          <StatusDot tone={approvalStatusTone[request.status]} pulse={inFlight} />
          <span>Proposed {relativeTime(request.createdAt)}</span>
          {expiresIn && request.status === 'proposed' && (
            <span className="text-state-warn">· expires in {expiresIn}</span>
          )}
        </div>

        {request.status === 'proposed' && (onApprove || onReject) && (
          <div className="flex items-center gap-2">
            {onReject && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onReject(request.id)}
                disabled={busy}
              >
                Reject
              </Button>
            )}
            {onApprove &&
              (gate.allowed ? (
                <Button
                  size="sm"
                  variant="approve"
                  loading={busy}
                  leadingIcon={!busy ? <Check className="h-3.5 w-3.5" /> : undefined}
                  onClick={() => onApprove(request.id)}
                >
                  Approve
                </Button>
              ) : (
                // Disabled buttons hide their reason. The tooltip is the point.
                <Tooltip content={gate.reason ?? 'Not permitted'}>
                  <span>
                    <Button size="sm" variant="approve" disabled>
                      Approve
                    </Button>
                  </span>
                </Tooltip>
              ))}
          </div>
        )}

        {request.status === 'proposed' && !gate.allowed && (
          <p className="w-full text-2xs text-fg-4">
            Requires {labelForRole(request.requiredRole)} or above.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-4">{label}</p>
      {children}
    </div>
  );
}
