import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/*
 * Overlays are built on Radix primitives rather than hand-rolled. Focus
 * trapping, scroll locking, escape handling, and aria wiring are the parts that
 * quietly break for keyboard and screen-reader users, and they are not worth
 * reimplementing on a product people run their business on.
 */

const OVERLAY = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-fade-in';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-white/10 bg-ink-800 shadow-2xl shadow-black/60',
            'data-[state=open]:animate-fade-in-up',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold text-white">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-xs text-gray-400">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-gray-500 transition hover:bg-white/5 hover:text-gray-200">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-white/10 px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Right-hand sheet for entity detail. Preferred over navigating away when the
 * user needs to keep their place in a list — reviewing a queue of approvals is
 * the canonical case.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'w-[min(34rem,100vw)]',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          className={cn(
            'fixed right-0 top-0 z-50 flex h-full flex-col border-l border-white/10 bg-ink-900 shadow-2xl shadow-black/60',
            'data-[state=open]:animate-slide-in-right',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-semibold text-white">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 truncate text-xs text-gray-400">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-gray-500 transition hover:bg-white/5 hover:text-gray-200">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && (
            <div className="border-t border-white/10 bg-ink-800/60 px-5 py-3">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Popover({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 min-w-[12rem] rounded-xl border border-white/10 bg-ink-800 p-1.5 shadow-2xl shadow-black/60',
            'data-[state=open]:animate-fade-in',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-lg border border-white/10 bg-ink-700 px-2.5 py-1.5 text-xs text-gray-200 shadow-xl"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
