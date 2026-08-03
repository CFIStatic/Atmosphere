import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const FIELD =
  'w-full rounded-lg border border-line/10 bg-raised/80 px-3 py-2 text-sm text-fg placeholder-fg-4 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50';

export function Label({
  htmlFor,
  children,
  hint,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex items-center justify-between gap-2', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg-2">
        {children}
      </label>
      {hint && <span className="text-2xs text-fg-3">{hint}</span>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(FIELD, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, 'resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(FIELD, 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input type="search" className={cn('h-9', className)} {...rest} />;
}

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Compact mutually-exclusive switch. Used for view scoping (e.g. Mine / Team /
 * All) where a dropdown would hide the available choices — on an operational
 * screen the options themselves are information.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-lg border border-line/10 bg-surface/80 p-0.5', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition',
              active ? 'bg-raised-2 text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
