import type { AtmosphereSelfServePlan } from '../../lib/api';
import { fieldCaptureSeatLabel } from '../../lib/atmospherePlans';
import { formatCents } from '../../lib/money';
import { cn } from '../../design/cn';

const BADGE_CLASS =
  'inline-flex h-6 items-center rounded-full bg-brand-500 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white';

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
    <fieldset className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3">
      <legend className="sr-only">Atmosphere plan</legend>
      {plans.map((plan) => {
        const selected = plan.code === value;
        const seats = fieldCaptureSeatLabel(plan.includedFcSeats);
        return (
          <label
            key={plan.code}
            className={cn(
              'relative flex h-full min-h-[13.5rem] cursor-pointer flex-col rounded-xl border-2 p-4 transition',
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
            <span className="flex h-6 items-center">
              <span className={cn(BADGE_CLASS, !plan.recommended && 'invisible')} aria-hidden={!plan.recommended}>
                Recommended
              </span>
            </span>
            <span className="mt-2 truncate text-[15px] font-semibold leading-5 tracking-tight text-ink-900 whitespace-nowrap">
              {plan.name}
            </span>
            <PlanPrice monthlyCents={plan.monthlyCents} stacked />
            <span className="mt-auto pt-3 text-sm leading-5 text-ink-600">{seats}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function PlanPrice({
  monthlyCents,
  className,
  stacked = false,
}: {
  monthlyCents: number;
  className?: string;
  stacked?: boolean;
}) {
  return (
    <span
      className={cn(
        stacked
          ? 'mt-3 flex flex-col items-start'
          : 'mt-3 flex items-baseline gap-x-1.5 whitespace-nowrap',
        className,
      )}
    >
      <span className="text-2xl font-bold tabular-nums tracking-tight text-ink-900">
        {formatCents(monthlyCents)}
      </span>
      <span className={cn('text-sm font-medium text-ink-500', stacked && 'mt-0.5')}>/ month</span>
    </span>
  );
}
