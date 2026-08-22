import type { ContractorType, MemberRole, UsageIntent, WorkType } from '../../lib/api';

/** User-facing Work Verification roles — mapped to existing member_role enum values. */
export const VERIFIER_ROLE_OPTIONS: {
  value: MemberRole;
  label: string;
  tag: string;
  blurb: string;
  usageIntents: UsageIntent[];
}[] = [
  {
    value: 'project_manager',
    label: 'Crew Lead',
    tag: 'Field Capture',
    blurb: 'Runs the job on site — films daily clips, checks the shot list, and signs off before leaving.',
    usageIntents: ['field_work', 'project_management'],
  },
  {
    value: 'field_technician',
    label: 'Field Technician',
    tag: 'Field Capture',
    blurb: 'Films before-and-after work on site. The day you worked is provable forever.',
    usageIntents: ['field_work'],
  },
  {
    value: 'office_manager',
    label: 'Project Manager',
    tag: 'Service contractor',
    blurb: 'Coordinates jobs from the office — releases draws when the verification record supports it.',
    usageIntents: ['project_management', 'crm'],
  },
  {
    value: 'accountant',
    label: 'Reviewer',
    tag: 'Customer & reviewer',
    blurb: 'Settles from the record — every clip, integrity verdict, and chain-of-custody entry on one screen.',
    usageIntents: ['billing', 'financial'],
  },
];

const TRADE_DEFAULTS = {
  contractorType: 'other' as ContractorType,
  workType: 'construction' as WorkType,
};

/** Full service-trade list for signup — stored as org contractor_type + work_type today. */
export const SERVICE_TRADE_OPTIONS = [
  { value: 'hvac', label: 'HVAC', ...TRADE_DEFAULTS },
  { value: 'plumbing', label: 'Plumbing', ...TRADE_DEFAULTS },
  { value: 'electrical', label: 'Electrical', ...TRADE_DEFAULTS },
  { value: 'drywall', label: 'Drywall', ...TRADE_DEFAULTS },
  { value: 'painting', label: 'Painting', ...TRADE_DEFAULTS },
  { value: 'roofing', label: 'Roofing', contractorType: 'roofing' as ContractorType, workType: 'construction' as WorkType },
  { value: 'flooring', label: 'Flooring', ...TRADE_DEFAULTS },
  { value: 'carpentry', label: 'Carpentry', ...TRADE_DEFAULTS },
  { value: 'masonry', label: 'Masonry & concrete', ...TRADE_DEFAULTS },
  { value: 'insulation', label: 'Insulation', ...TRADE_DEFAULTS },
  { value: 'siding', label: 'Siding & exterior', ...TRADE_DEFAULTS },
  { value: 'windows_doors', label: 'Windows & doors', ...TRADE_DEFAULTS },
  { value: 'landscaping', label: 'Landscaping', ...TRADE_DEFAULTS },
  { value: 'cleaning', label: 'Cleaning & janitorial', ...TRADE_DEFAULTS },
  { value: 'facilities', label: 'Facilities maintenance', contractorType: 'general_contractor' as ContractorType, workType: 'construction' as WorkType },
  { value: 'fire_life_safety', label: 'Fire & life safety', ...TRADE_DEFAULTS },
  { value: 'security', label: 'Security & access control', ...TRADE_DEFAULTS },
  { value: 'low_voltage', label: 'Low voltage / AV / data', ...TRADE_DEFAULTS },
  { value: 'pool_spa', label: 'Pool & spa', ...TRADE_DEFAULTS },
  { value: 'pest_control', label: 'Pest control', ...TRADE_DEFAULTS },
  { value: 'appliance', label: 'Appliance repair', ...TRADE_DEFAULTS },
  { value: 'restoration', label: 'Restoration (water / fire / mold)', contractorType: 'restoration' as ContractorType, workType: 'mitigation' as WorkType },
  { value: 'general_contractor', label: 'General contractor', contractorType: 'general_contractor' as ContractorType, workType: 'construction' as WorkType },
  { value: 'other', label: 'Other service trade', ...TRADE_DEFAULTS },
] as const;

export type ServiceTrade = (typeof SERVICE_TRADE_OPTIONS)[number]['value'];

/**
 * Trades a person on a job can be. General contractor is a party role, not a
 * trade, so it is omitted here. Keep verifier/index.html JOB_TRADES in sync.
 */
export const JOB_PARTY_TRADE_OPTIONS = SERVICE_TRADE_OPTIONS.filter(
  (t) => t.value !== 'general_contractor',
);

export const JOB_PARTY_ROLE_OPTIONS = [
  { value: 'owner' as const, label: 'Homeowner' },
  { value: 'adjuster' as const, label: 'Adjuster' },
  { value: 'general_contractor' as const, label: 'General contractor' },
];

export function usageIntentsForRole(role: MemberRole): UsageIntent[] {
  const roleOption = VERIFIER_ROLE_OPTIONS.find((r) => r.value === role);
  return roleOption?.usageIntents ?? (['exploring'] as UsageIntent[]);
}

/** Restoration jobs start as mitigation; every other company type is construction. */
export function workTypeForContractorType(contractorType: ContractorType): WorkType {
  return contractorType === 'restoration' ? 'mitigation' : 'construction';
}

export function resolveVerifierSetup(
  role: MemberRole,
  trade: ServiceTrade,
  useDefaults: boolean,
) {
  if (useDefaults) {
    return {
      role: 'field_technician' as MemberRole,
      workType: 'construction' as WorkType,
      contractorType: 'other' as ContractorType,
      usageIntents: ['field_work', 'exploring'] as UsageIntent[],
    };
  }

  const tradeOption = SERVICE_TRADE_OPTIONS.find((t) => t.value === trade);

  return {
    role,
    workType: tradeOption?.workType ?? ('construction' as WorkType),
    contractorType: tradeOption?.contractorType ?? ('other' as ContractorType),
    usageIntents: usageIntentsForRole(role),
  };
}
