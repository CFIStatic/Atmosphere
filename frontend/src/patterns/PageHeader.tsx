import type { ReactNode } from 'react';
import { cn } from '../design';

/**
 * Consistent page framing. Every workspace page opens with the same shape —
 * what this page is, one line of orientation, and its controls — so moving
 * between sections never costs the user a re-scan.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Filters or tabs rendered beneath the title block. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-line/10 bg-canvas/60 px-4 py-4 sm:px-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Standard content padding, with bottom clearance for the mobile bottom bar. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 py-4 pb-24 sm:px-6 sm:pb-6', className)}>{children}</div>;
}
