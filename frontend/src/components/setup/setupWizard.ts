import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';
import type { ServiceTrade } from './verifierSetupOptions';

export type SetupWizardStep = 1 | 2 | 3 | 4 | 5;

export const SETUP_WIZARD_STEPS = [
  {
    step: 1 as const,
    title: 'Create your account',
    detail: 'Work email and a password. We never store your password in plain text.',
  },
  {
    step: 2 as const,
    title: 'Name your organization',
    detail: 'Start a new workspace — or join an existing team with a join code.',
  },
  {
    step: 3 as const,
    title: 'Pick your role and trade',
    detail: 'Crew Lead, Field Technician, Project Manager, or Reviewer — then pick your trade from the full service contractor list.',
  },
  {
    step: 4 as const,
    title: 'Invite your crew',
    detail: 'Every organization gets one join code. Hand it to a teammate and they are in.',
  },
  {
    step: 5 as const,
    title: 'Set up billing',
    detail: 'Add your payment method in Stripe — $599/mo platform fee, then you are in.',
  },
] as const;

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
  if (parsed >= 1 && parsed <= 5) return parsed as SetupWizardStep;
  if (options.user && !options.membership) return 2;
  return 1;
}
