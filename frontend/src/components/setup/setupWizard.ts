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
    detail: 'Pick a plan and add a card — next you start a job and film in Field Capture.',
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

const HOMEOWNER_WIZARD_STEPS = [
  {
    step: 1 as const,
    title: 'Create your login',
    detail: 'Email and password only — no payment, no Field Capture seat.',
  },
  {
    step: 2 as const,
    title: 'Open the job file',
    detail: 'You will land on job progress after you create your login.',
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
  if (intent === 'homeowner') {
    return {
      heading: 'View your job progress',
      lede: 'Create a quick Atmosphere login to keep this shared job file. No payment and no Field Capture seat.',
      steps: HOMEOWNER_WIZARD_STEPS,
    };
  }
  return {
    heading: 'Create your company',
    lede: 'You are the Global Admin. Create the workspace, pick a plan, start a job, then film the first day in Field Capture.',
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
  checkout?: string | null;
}): SetupWizardStep {
  const parsed = options.stepParam ? Number.parseInt(options.stepParam, 10) : NaN;
  // Stripe always returns to billing. Do this before the membership check —
  // on a full-page return the session is still loading and membership is empty.
  if (options.checkout === 'success' || options.checkout === 'cancelled') return 2;
  if (LEGACY_BILLING_STEPS.has(parsed)) return 2;
  // New billing is ?step=2. The old workspace URL was also ?step=2 — people
  // who still need a company land on the combined account + workspace form.
  if (parsed === 2) return options.membership ? 2 : 1;
  return 1;
}
