import { useState } from 'react';
import { InvitePanel } from '../team/InvitePanel';
import { SetupStepCard } from './SetupWizardShell';

/**
 * Step 3, after payment (or a comped workspace), computers only. Optional:
 * company-level invites (the same Settings → Team invite), no job needed.
 * Skip for now (before any invite) and Continue (after one) both go to the Dashboard (or the deep link).
 */
export function SetupInviteStep({ continueLabel, onDone }: { continueLabel: string; onDone: () => void }) {
  const [sent, setSent] = useState(0);
  return (
    <SetupStepCard
      step={3}
      title="Invite your team"
      subtitle="Optional. Add office staff and crew to the company now, or later from Settings."
    >
      <div className="mt-6" data-testid="setup-invite-panel">
        <InvitePanel onInvited={() => setSent((n) => n + 1)} />
      </div>
      <div className="mt-2 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-end">
        {sent === 0 ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-line bg-paper-0 px-4 py-3 text-center font-semibold text-ink-900 transition hover:border-brand-300 focus:outline-hidden focus:ring-2 focus:ring-brand-200 sm:min-w-[180px]"
          >
            Skip for now
          </button>
        ) : (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 transition hover:bg-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-200 sm:min-w-[180px]"
          >
            {continueLabel}
          </button>
        )}
      </div>
    </SetupStepCard>
  );
}
