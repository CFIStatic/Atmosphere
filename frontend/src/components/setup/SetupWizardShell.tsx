import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../Logo';
import { CheckIcon } from '../icons';
import {
  setupWizardCopy,
  type OrgSetupIntent,
  type SetupWizardStep,
} from './setupWizard';

export function SetupWizardShell({
  step,
  intent = 'create',
  signInHref,
  headerAction,
  children,
}: {
  step: SetupWizardStep;
  intent?: OrgSetupIntent;
  signInHref?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const copy = setupWizardCopy(intent);
  return (
    <div className="relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo />
        {headerAction ??
          (signInHref ? (
            <Link
              to={signInHref}
              className="text-sm font-medium text-ink-600 transition hover:text-ink-900"
            >
              Already have an account? <span className="font-semibold text-brand-600">Sign in</span>
            </Link>
          ) : null)}
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-2 sm:items-center">
        <div className="w-full max-w-4xl animate-fade-in-up">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start lg:gap-14">
            <div className="hidden lg:block">
              <h1 className="text-3xl font-bold tracking-tight text-ink-900">{copy.heading}</h1>
              <p className="mt-2 max-w-sm text-base text-ink-600">{copy.lede}</p>

              <ol className="mt-10 space-y-3">
                {copy.steps.map((item) => {
                  const done = item.step < step;
                  const active = item.step === step;
                  return (
                    <li key={item.step} className="flex items-center gap-3">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          done || active
                            ? 'bg-brand-500 text-ink-900'
                            : 'bg-paper-0 text-ink-500 ring-1 ring-line'
                        }`}
                        aria-hidden="true"
                      >
                        {done ? <CheckIcon width={14} height={14} /> : item.step}
                      </span>
                      <p
                        className={`text-sm ${
                          active ? 'font-semibold text-ink-900' : done ? 'text-ink-700' : 'text-ink-500'
                        }`}
                      >
                        {item.title}
                      </p>
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
  title,
  subtitle,
  children,
}: {
  step?: SetupWizardStep;
  title: string;
  subtitle?: string;
  children: ReactNode;
  intent?: OrgSetupIntent;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper-0 p-8 shadow-lift sm:p-10">
      <h2 className="text-xl font-bold tracking-tight text-ink-900">{title}</h2>
      {subtitle ? <p className="mt-1.5 text-sm text-ink-600">{subtitle}</p> : null}
      {children}
    </div>
  );
}
