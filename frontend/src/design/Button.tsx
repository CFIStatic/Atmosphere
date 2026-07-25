import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'approve' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-900/30',
  secondary: 'bg-ink-700 text-gray-100 hover:bg-ink-600 border border-white/10',
  outline: 'border border-white/15 text-gray-200 hover:bg-white/5',
  ghost: 'text-gray-300 hover:bg-white/5 hover:text-white',
  danger:
    'bg-state-danger/15 text-state-danger border border-state-danger/30 hover:bg-state-danger/25',
  approve: 'bg-state-ok/15 text-state-ok border border-state-ok/30 hover:bg-state-ok/25',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-8 w-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
