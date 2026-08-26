import type { ReactNode } from 'react';
import { Logo } from '../Logo';
import { ThemeToggle } from '../ThemeToggle';
import { CheckIcon } from '../icons';
import {
  setupWizardCopy,
  type OrgSetupIntent,
  type SetupWizardStep,
} from './setupWizard';

export function SetupWizardShell({
  step,
  intent = 'create',
  headerAction,
  onStepSelect,
  children,
}: {
  step: SetupWizardStep;
  intent?: OrgSetupIntent;
  headerAction?: ReactNode;
  onStepSelect?: (step: SetupWizardStep) => void;
  children: ReactNode;
}) {
  const copy = setupWizardCopy(intent);
  return (
    <div className="relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-8 sm:px-10 sm:py-10">
        <Logo size="lg" />
        <div className="flex items-center gap-3">
          {headerAction}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-2 sm:items-center">
        <div className="w-full max-w-4xl animate-fade-in-up">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start lg:gap-14">
            <div className="hidden lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                Get started
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">
                {copy.heading}
              </h1>
              <p className="mt-3 max-w-md text-base text-ink-600">{copy.lede}</p>

              <ol className="mt-10 space-y-5">
                {copy.steps.map((item) => {
                  const done = item.step < step;
                  const active = item.step === step;
                  return (
                    <li key={item.step}>
                      <button
                        type="button"
                        aria-current={active ? 'step' : undefined}
                        aria-label={item.title}
                        onClick={() => onStepSelect?.(item.step)}
                        className={`flex w-full gap-4 rounded-xl border px-4 py-4 text-left transition ${
                          active
                            ? 'border-brand-300 bg-brand-50 shadow-sm'
                            : 'border-line bg-paper-0 hover:border-brand-200 hover:bg-brand-50/70'
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                            done || active
                              ? 'bg-brand-500 text-ink-900'
                              : 'bg-paper-100 text-ink-500'
                          }`}
                          aria-hidden="true"
                        >
                          {done ? <CheckIcon width={16} height={16} /> : item.step}
                        </span>
                        <div>
                          <p className={`font-semibold ${active || done ? 'text-ink-900' : 'text-ink-700'}`}>
                            {item.title}
                          </p>
                          <p className={`mt-1 text-sm ${active || done ? 'text-ink-600' : 'text-ink-500'}`}>
                            {item.detail}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div>{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function SetupStepCard({
  step,
  title,
  subtitle,
  children,
  intent = 'create',
}: {
  step: SetupWizardStep;
  title: string;
  subtitle: string;
  children: ReactNode;
  intent?: OrgSetupIntent;
}) {
  const label = setupWizardCopy(intent).steps[step - 1]?.title ?? title;
  return (
    <div className="rounded-2xl border border-line bg-paper-0 p-8 shadow-lift sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
        Step {step} · {label}
      </p>
      <h2 className="mt-2 text-xl font-bold tracking-tight text-ink-900">{title}</h2>
      <p className="mt-1.5 text-sm text-ink-600">{subtitle}</p>
      {children}
    </div>
  );
}
