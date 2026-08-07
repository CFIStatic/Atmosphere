import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';
import type { ServiceTrade } from './verifierSetupOptions';

export type SetupWizardStep = 1 | 2 | 3 | 4;

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
    detail: 'Crew Lead, Field Technician, Project Manager, or Reviewer — doing HVAC, plumbing, electrical, or other service work.',
  },
  {
    step: 4 as const,
    title: 'Invite your crew',
    detail: 'Every organization gets one join code. Hand it to a teammate and they are in.',
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
  if (parsed >= 1 && parsed <= 4) return parsed as SetupWizardStep;
  if (options.user && !options.membership) return 2;
  return 1;
}
