import type { SignupIntent } from '../../lib/authRedirect';
import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';
import type { ServiceTrade } from './verifierSetupOptions';

export type SetupWizardStep = 1 | 2;
export type OrgSetupIntent = SignupIntent;

export interface SetupWizardCopy {
  heading: string;
  lede: string;
  steps: readonly {
    step: SetupWizardStep;
    title: string;
    detail: string;
  }[];
}

export const SETUP_WIZARD_STEPS = [
  {
    step: 1 as const,
    title: 'Account & workspace',
    detail: 'Your login and company name — you become Global Admin.',
  },
  {
    step: 2 as const,
    title: 'Set up billing',
    detail: 'Add your payment method in Stripe — $599/mo platform fee.',
  },
] as const;

const JOIN_WIZARD_STEPS = [
  {
    step: 1 as const,
    title: 'Account & join code',
    detail: 'Create a login with the invited email, then enter the join code.',
  },
  {
    step: 2 as const,
    title: 'Set up billing',
    detail: 'Joiners skip this — only the Global Admin pays the bill.',
  },
] as const;

export function setupWizardCopy(intent: OrgSetupIntent): SetupWizardCopy {
  if (intent === 'join') {
    return {
      heading: 'Join your team',
      lede: 'Your Global Admin invited you — create a login and enter the join code.',
      steps: JOIN_WIZARD_STEPS,
    };
  }
  return {
    heading: 'Create your company',
    lede: 'You are the Global Admin. Create the workspace, set up billing, then invite everyone else.',
    steps: SETUP_WIZARD_STEPS,
  };
}

export const SETUP_DEFAULTS = {
  role: 'global_admin' as MemberRole,
  workType: 'construction' as WorkType,
  contractorType: 'other' as ContractorType,
  trade: 'other' as ServiceTrade,
  usageIntents: ['field_work', 'exploring', 'billing'] as UsageIntent[],
};

/** Legacy billing URLs: 3 (old billing), 4 (old invite), 5 (older billing). */
const LEGACY_BILLING_STEPS = new Set([3, 4, 5]);

export function initialSetupStep(options: {
  user: boolean;
  membership: boolean;
  stepParam: string | null;
}): SetupWizardStep {
  const parsed = options.stepParam ? Number.parseInt(options.stepParam, 10) : NaN;
  if (LEGACY_BILLING_STEPS.has(parsed)) return 2;
  // New billing is ?step=2. The old workspace URL was also ?step=2 — people
  // who still need a company land on the combined account + workspace form.
  if (parsed === 2) return options.membership ? 2 : 1;
  return 1;
}

/** Company name when the user skips it — still gives the workspace a real label. */
export function workspaceNameFrom(fullName: string, email: string): string {
  const name = fullName.trim();
  if (name.length >= 2) return name;
  const local = email.split('@')[0]?.trim().replace(/[._]+/g, ' ');
  if (local) {
    const labelled = local.replace(/\b\w/g, (ch) => ch.toUpperCase());
    return `${labelled}'s workspace`;
  }
  return 'My workspace';
}
