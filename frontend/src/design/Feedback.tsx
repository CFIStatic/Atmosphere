import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Every status surface in the product resolves through this one tone scale, so
 * "at risk" looks identical whether it appears on a job, an invoice, or an
 * agent run. Adding a tone here is a deliberate product decision, not a local
 * styling choice.
 */
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'running' | 'idle' | 'brand';

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-state-ok',
  info: 'text-state-info',
  warn: 'text-state-warn',
  danger: 'text-state-danger',
  running: 'text-state-running',
  idle: 'text-state-idle',
  brand: 'text-brand-300',
};

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-state-ok/10 text-state-ok border-state-ok/25',
  info: 'bg-state-info/10 text-state-info border-state-info/25',
  warn: 'bg-state-warn/10 text-state-warn border-state-warn/25',
  danger: 'bg-state-danger/10 text-state-danger border-state-danger/25',
  running: 'bg-state-running/10 text-state-running border-state-running/25',
  idle: 'bg-line/5 text-state-idle border-line/10',
  brand: 'bg-brand-500/10 text-brand-300 border-brand-400/25',
};

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-state-ok',
  info: 'bg-state-info',
  warn: 'bg-state-warn',
  danger: 'bg-state-danger',
  running: 'bg-state-running',
  idle: 'bg-state-idle',
  brand: 'bg-brand-400',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: ReactNode;
}

export function Badge({ tone = 'idle', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
        TONE_CHIP[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * A status dot. `pulse` is reserved for work actively in flight — it is the one
 * piece of motion allowed on a dense screen, because "something is running right
 * now" is the only state worth spending attention on.
 */
export function StatusDot({
  tone = 'idle',
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-60 animate-pulse-soft',
            TONE_DOT[tone],
          )}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', TONE_DOT[tone])} />
    </span>
  );
}

export function ToneText({
  tone,
  className,
  children,
}: {
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn(TONE_TEXT[tone], className)}>{children}</span>;
}

export function Progress({
  value,
  tone = 'brand',
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line/10', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', TONE_DOT[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-md bg-line/5', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid place-items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-fg-4">{icon}</div>}
      <p className="text-sm font-medium text-fg-2">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-fg-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Keyboard hint, e.g. ⌘K. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'rounded border border-line/15 bg-line/5 px-1.5 py-0.5 font-sans text-2xs font-medium text-fg-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
