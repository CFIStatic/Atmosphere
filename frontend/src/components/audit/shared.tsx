import { useState, type ReactNode } from 'react';
import type { AgentAccent, AgentRunStatus, AgentStepType } from '../../lib/api';
import { RUN_STATUS_LABELS } from '../../lib/api';
import {
  AlertIcon,
  ArtifactIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DecisionIcon,
  DotIcon,
  FlagIcon,
  MessageIcon,
  NavigationIcon,
  ResultIcon,
  ThoughtIcon,
  ToolIcon,
  UsageIcon,
} from '../icons';

/**
 * Shared vocabulary for the Audit tab: how a status looks, how a duration
 * reads, and how an agent's payload is shown without letting it take over the
 * page.
 *
 * Every class string here is written out in full rather than composed from
 * fragments — Tailwind scans source text, so a class assembled at runtime is a
 * class that never reaches the stylesheet.
 */

export const STATUS_STYLES: Record<AgentRunStatus, { chip: string; dot: string }> = {
  queued: { chip: 'border-line bg-paper-100 text-ink-600', dot: 'bg-ink-400' },
  running: { chip: 'border-brand-200 bg-brand-50 text-brand-700', dot: 'bg-brand-500' },
  succeeded: { chip: 'border-success-200 bg-success-50 text-success-600', dot: 'bg-success-600' },
  failed: { chip: 'border-danger-200 bg-danger-50 text-danger-600', dot: 'bg-danger-600' },
  cancelled: { chip: 'border-caution-200 bg-caution-50 text-caution-600', dot: 'bg-caution-600' },
};

/**
 * One accent per agent, drawn only from the design system's own status colours.
 * The palette has no decorative hues to spare, so an agent's accent doubles as
 * a status colour elsewhere — which is fine here because it is only ever used
 * to tell agents apart, never to say whether a run went well.
 */
/**
 * `bg` is the solid dot that marks a run in the list; `soft` is the tinted
 * background a label sits on. They are separate because the solid colour is
 * chosen to be visible at 8px, which makes it far too dark to read text against.
 */
export const ACCENT_STYLES: Record<
  AgentAccent,
  { text: string; ring: string; bg: string; soft: string }
> = {
  brand: { text: 'text-brand-700', ring: 'ring-brand-200', bg: 'bg-brand-500', soft: 'bg-brand-50' },
  neutral: { text: 'text-ink-700', ring: 'ring-line-strong', bg: 'bg-ink-400', soft: 'bg-paper-200' },
  success: { text: 'text-success-600', ring: 'ring-success-200', bg: 'bg-success-600', soft: 'bg-success-50' },
  caution: { text: 'text-caution-600', ring: 'ring-caution-200', bg: 'bg-caution-600', soft: 'bg-caution-50' },
  danger: { text: 'text-danger-600', ring: 'ring-danger-200', bg: 'bg-danger-600', soft: 'bg-danger-50' },
};

export const STEP_ICONS: Record<AgentStepType, typeof DotIcon> = {
  status: FlagIcon,
  thought: ThoughtIcon,
  message: MessageIcon,
  tool_call: ToolIcon,
  tool_result: ResultIcon,
  observation: NavigationIcon,
  navigation: NavigationIcon,
  decision: DecisionIcon,
  artifact: ArtifactIcon,
  usage: UsageIcon,
  error: AlertIcon,
  event: DotIcon,
};

export function StatusChip({ status }: { status: AgentRunStatus }) {
  const style = STATUS_STYLES[status];
  const live = status === 'running' || status === 'queued';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${live ? 'animate-pulse' : ''}`} />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** Milliseconds as something a person reads at a glance. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const delta = Date.now() - then;
  if (delta < 45_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/** One label-over-value cell, used across the run header and the stat row. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <div className="mt-1 truncate text-sm text-ink-800">{children}</div>
    </div>
  );
}

/**
 * A collapsed JSON body.
 *
 * Agent payloads are routinely larger than the step that carries them, so they
 * start closed: the trace should read as a sequence of actions, with the raw
 * evidence one click away rather than in the way.
 */
export function JsonBlock({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (value === null || value === undefined) return null;

  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (!text || text === '{}' || text === 'null') return null;

  return (
    <div className="rounded-lg border border-line bg-paper-50">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink-600 transition hover:text-ink-800"
      >
        {open ? (
          <ChevronDownIcon width={14} height={14} />
        ) : (
          <ChevronRightIcon width={14} height={14} />
        )}
        {label}
        <span className="ml-auto font-normal text-ink-400">{text.length.toLocaleString()} chars</span>
      </button>
      {open && (
        <pre className="max-h-80 overflow-auto border-t border-line px-3 py-2 text-xs leading-relaxed text-ink-700">
          {text}
        </pre>
      )}
    </div>
  );
}
