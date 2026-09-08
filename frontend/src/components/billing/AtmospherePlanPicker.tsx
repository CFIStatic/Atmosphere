import type { AtmosphereSelfServePlan } from '../../lib/api';
import { fieldCaptureSeatLabel } from '../../lib/atmospherePlans';
import { formatCents } from '../../lib/money';
import { cn } from '../../design/cn';

export function AtmospherePlanPicker({
  plans,
  value,
  onChange,
  name = 'atmosphere-plan',
  disabled = false,
}: {
  plans: AtmosphereSelfServePlan[];
  value: AtmosphereSelfServePlan['code'];
  onChange: (code: AtmosphereSelfServePlan['code']) => void;
  name?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
      <legend className="sr-only">Atmosphere plan</legend>
      {plans.map((plan) => {
        const selected = plan.code === value;
        return (
          <label
            key={plan.code}
            className={cn(
              'relative flex h-full min-h-[12.5rem] cursor-pointer flex-col rounded-xl border-2 p-4 transition',
              selected
                ? 'border-brand-500 bg-brand-50 shadow-sm'
                : 'border-line bg-paper-50 hover:border-brand-200',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={plan.code}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(plan.code)}
              className="sr-only"
            />
            <span className="flex min-h-[1.5rem] items-center">
              {plan.recommended ? (
                <span className="inline-flex items-center rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-900">
                  Recommended
                </span>
              ) : null}
            </span>
            <span className="mt-2 min-h-[2.75rem] text-[15px] font-semibold leading-snug tracking-tight text-ink-900">
              {plan.name}
            </span>
            <PlanPrice monthlyCents={plan.monthlyCents} />
            <span className="mt-auto pt-3 text-sm leading-snug text-ink-600">
              {fieldCaptureSeatLabel(plan.includedFcSeats)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function PlanPrice({
  monthlyCents,
  className,
}: {
  monthlyCents: number;
  className?: string;
}) {
  return (
    <span className={cn('mt-3 flex items-baseline gap-x-1.5 whitespace-nowrap', className)}>
      <span className="text-2xl font-bold tabular-nums tracking-tight text-ink-900">
        {formatCents(monthlyCents)}
      </span>
      <span className="text-sm font-medium text-ink-500">/ month</span>
    </span>
  );
}
