import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../design/cn';

/**
 * The one popup shell for the app: a dark glass pane over a dimmed, blurred
 * page, with a titled header and an icon close button.
 *
 * Built on Radix so focus trapping, Escape, scroll locking, and aria wiring
 * come for free. Callers render it only while open and pass `onClose`.
 */
export function GlassModal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  align = 'top',
  className,
  bodyClassName,
  closeDisabled = false,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Action row pinned under the body, divided by a hairline. */
  footer?: ReactNode;
  /** Tailwind max-width for the pane. */
  width?: string;
  /** `top` sits the pane a tenth of the way down so a growing list never jumps. */
  align?: 'top' | 'center';
  className?: string;
  bodyClassName?: string;
  /** Ignore Escape, outside clicks, and the close button (e.g. while saving). */
  closeDisabled?: boolean;
  testId?: string;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !closeDisabled) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="glass-scrim fixed inset-0 z-50" />
        <div
          className={cn(
            'pointer-events-none fixed inset-0 z-50 flex justify-center overflow-y-auto p-4',
            align === 'top' ? 'items-start pt-[10vh]' : 'items-center',
          )}
        >
          <DialogPrimitive.Content
            data-testid={testId}
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'glass-dialog pointer-events-auto w-full overflow-hidden rounded-2xl text-ink-900 outline-none',
              width,
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink-900">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-ink-600">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close
                disabled={closeDisabled}
                className="-mr-2 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-ink-900/10 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              </DialogPrimitive.Close>
            </div>
            <div className={cn('px-6 pb-6', bodyClassName)}>{children}</div>
            {footer ? (
              <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>
            ) : null}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
