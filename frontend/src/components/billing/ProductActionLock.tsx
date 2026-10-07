import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { getBillingOnboardingShared } from '../../lib/billingOnboardingShared';
import { billingStepHref } from '../../lib/firstRun';
import { APP_SHELL_BILLING_NOTE, isInAppShell } from '../../lib/appShell';

/** Why an action is locked. In the app there is no plan link (App Store 3.1.1). */
export function planRequiredMessage(inApp = isInAppShell()): string {
  return inApp
    ? `This workspace needs a plan before you can upload, record, share, or invite. ${APP_SHELL_BILLING_NOTE}`
    : 'Choose a plan to upload, record, share, or invite.';
}

/** True when this office still owes a plan. Missing billing calls stay unlocked. */
export function useProductActionsLocked(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (typeof api.getBillingOnboarding !== 'function') return;
    getBillingOnboardingShared(api.getBillingOnboarding)
      .then((status) => {
        if (!cancelled) setLocked(Boolean(status?.required && !status?.complete));
      })
      .catch(() => {
        if (!cancelled) setLocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return locked;
}

export function UpgradePrompt() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  if (isInAppShell()) {
    return (
      <p className="text-sm text-ink-700" data-testid="upgrade-prompt">
        {planRequiredMessage(true)}
      </p>
    );
  }
  return (
    <p className="text-sm text-ink-700" data-testid="upgrade-prompt">
      Choose a plan to upload, record, share, or invite.{' '}
      <a href={billingStepHref(next)} className="font-semibold text-brand-700 hover:text-brand-800">
        Choose a plan
      </a>
    </p>
  );
}
