import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';

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
    detail: 'So Field Capture and the Evidence Platform open with the right defaults.',
  },
  {
    step: 4 as const,
    title: 'Invite your crew',
    detail: 'Every organization gets one join code. Hand it to a teammate and they are in.',
  },
] as const;

export const SETUP_DEFAULTS = {
  role: 'project_manager' as MemberRole,
  workType: 'mitigation' as WorkType,
  contractorType: 'other' as ContractorType,
  usageIntents: ['exploring'] as UsageIntent[],
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
