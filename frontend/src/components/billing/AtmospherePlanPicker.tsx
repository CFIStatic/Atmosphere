import type { AtmosphereSelfServePlan } from '../../lib/api';
import {
  fieldCaptureSeatLabel,
  planAnnualCents,
  planPickerFootnote,
  type AtmosphereBillingInterval,
} from '../../lib/atmospherePlans';
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
  interval = 'month',
  onIntervalChange,
  annualAvailable = false,
}: {
  plans: AtmosphereSelfServePlan[];
  value: AtmosphereSelfServePlan['code'];
  onChange: (code: AtmosphereSelfServePlan['code']) => void;
  name?: string;
  disabled?: boolean;
  /** Monthly is the default. Yearly is ignored unless annual prices are configured. */
  interval?: AtmosphereBillingInterval;
  onIntervalChange?: (interval: AtmosphereBillingInterval) => void;
  /** Hide the Yearly toggle when annual Stripe price ids are not set. */
  annualAvailable?: boolean;
}) {
  const activeInterval: AtmosphereBillingInterval = annualAvailable && interval === 'year' ? 'year' : 'month';

  return (
    <div>
      {annualAvailable ? (
        <IntervalToggle
          name={`${name}-interval`}
          value={activeInterval}
          disabled={disabled}
          onChange={(next) => onIntervalChange?.(next)}
        />
      ) : null}
      <fieldset className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3">
        <legend className="sr-only">Atmosphere plan</legend>
        {plans.map((plan) => {
          const selected = plan.code === value;
          const seats = fieldCaptureSeatLabel(plan.includedFcSeats);
          return (
            <label
              key={plan.code}
              className={cn(
                'relative flex h-full cursor-pointer flex-col rounded-xl border-2 p-4 transition',
                activeInterval === 'year' ? 'min-h-[15.75rem]' : 'min-h-[13.5rem]',
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
              <PlanPrice
                monthlyCents={plan.monthlyCents}
                annualCents={planAnnualCents(plan)}
                interval={activeInterval}
              />
              <span className="mt-auto pt-3 text-sm leading-5 text-ink-600">{seats}</span>
            </label>
          );
        })}
      </fieldset>
      <p className="mt-3 text-xs text-ink-500">{planPickerFootnote(activeInterval)}</p>
    </div>
  );
}

function IntervalToggle({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: AtmosphereBillingInterval;
  onChange: (interval: AtmosphereBillingInterval) => void;
  disabled?: boolean;
}) {
  const options: { value: AtmosphereBillingInterval; label: string }[] = [
    { value: 'month', label: 'Monthly' },
    { value: 'year', label: 'Yearly' },
  ];
  return (
    <div className="mb-4 flex justify-center sm:justify-start">
      <div
        role="radiogroup"
        aria-label="Billing interval"
        className="inline-flex max-w-full flex-wrap rounded-full border border-line bg-paper-0 p-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex cursor-pointer items-center rounded-full px-3 py-1.5 text-sm font-semibold transition',
                selected ? 'bg-brand-500 text-white' : 'text-ink-600 hover:text-ink-900',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
              {option.value === 'year' ? (
                <span
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    selected ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700',
                  )}
                >
                  2 months free
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function PlanPrice({
  monthlyCents,
  annualCents,
  interval = 'month',
  className,
}: {
  monthlyCents: number;
  annualCents?: number;
  interval?: AtmosphereBillingInterval;
  className?: string;
}) {
  const yearly = interval === 'year';
  const amount = yearly ? (annualCents ?? monthlyCents * 10) : monthlyCents;
  return (
    <span className={cn('mt-3 block', className)}>
      <span className="whitespace-nowrap">
        <span className="whitespace-nowrap text-2xl font-bold tabular-nums tracking-tight text-ink-900">
          {formatCents(amount)}
        </span>{' '}
        <span className="whitespace-nowrap text-sm font-medium text-ink-500">
          {yearly ? 'Per Year' : 'Per Month'}
        </span>
      </span>
      {yearly ? (
        <span className="mt-1 block text-xs font-medium text-ink-500">
          {`${formatCents(Math.round(amount / 12))}/mo billed yearly`}
        </span>
      ) : null}
    </span>
  );
}
