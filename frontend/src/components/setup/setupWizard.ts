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
  }[];
}

export const SETUP_WIZARD_STEPS = [
  { step: 1 as const, title: 'Account' },
  { step: 2 as const, title: 'Company' },
  { step: 3 as const, title: 'Payment' },
  { step: 4 as const, title: 'Invite team' },
] as const;

const JOIN_WIZARD_STEPS = [
  { step: 1 as const, title: 'Account' },
  { step: 2 as const, title: 'Join team' },
] as const;

export function setupWizardCopy(intent: OrgSetupIntent): SetupWizardCopy {
  if (intent === 'join') {
    return {
      heading: 'Join your team',
      lede: 'Create a login, then enter the invite from your email.',
      steps: JOIN_WIZARD_STEPS,
    };
  }
  return {
    heading: 'Create an account',
    lede: 'Account, company, payment, then invite your team.',
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
  if (parsed === 5) return 3;
  if (parsed >= 1 && parsed <= 4) return parsed as SetupWizardStep;
  if (options.user && !options.membership) return 2;
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
