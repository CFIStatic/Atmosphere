import type { SignupIntent } from '../../lib/authRedirect';
import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';
import type { ServiceTrade } from './verifierSetupOptions';

export type SetupWizardStep = 1 | 2 | 3 | 4;
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
    title: 'Create your account',
    detail: 'Work email and a password. We never store your password in plain text.',
  },
  {
    step: 2 as const,
    title: 'Name your organization',
    detail: 'Start a new workspace — or link to the office account with a join code.',
  },
  {
    step: 3 as const,
    title: 'Invite your crew',
    detail: 'Every organization gets one join code. Hand it to a teammate and they are in.',
  },
  {
    step: 4 as const,
    title: 'Set up billing',
    detail: 'Add your payment method in Stripe — $599/mo platform fee, then you are in.',
  },
] as const;

const JOIN_WIZARD_STEPS = [
  {
    step: 1 as const,
    title: 'Create your account',
    detail: 'Work email and a password. We never store your password in plain text.',
  },
  {
    step: 2 as const,
    title: 'Link to the office account',
    detail: 'Enter the join code from your office so this login belongs to that organization.',
  },
  {
    step: 3 as const,
    title: 'You are connected',
    detail: 'Your account is linked. You can invite others from Settings later.',
  },
  {
    step: 4 as const,
    title: 'Set up billing',
    detail: 'Joiners usually skip this — the office already has a plan.',
  },
] as const;

export function setupWizardCopy(intent: OrgSetupIntent): SetupWizardCopy {
  if (intent === 'join') {
    return {
      heading: 'Link to the office account',
      lede: 'Create your login, then enter the office join code so you work in the same organization.',
      steps: JOIN_WIZARD_STEPS,
    };
  }
  return {
    heading: 'Create your organization',
    lede: 'Four quick steps — about two minutes from account to your first job.',
    steps: SETUP_WIZARD_STEPS,
  };
}

export const SETUP_DEFAULTS = {
  role: 'field_technician' as MemberRole,
  workType: 'construction' as WorkType,
  contractorType: 'other' as ContractorType,
  trade: 'other' as ServiceTrade,
  usageIntents: ['field_work', 'exploring'] as UsageIntent[],
};

export function initialSetupStep(options: {
  user: boolean;
  membership: boolean;
  stepParam: string | null;
}): SetupWizardStep {
  const parsed = options.stepParam ? Number.parseInt(options.stepParam, 10) : NaN;
  // Accept legacy ?step=5 (old billing step number) as billing.
  if (parsed === 5) return 4;
  if (parsed >= 1 && parsed <= 4) return parsed as SetupWizardStep;
  if (options.user && !options.membership) return 2;
  return 1;
}
