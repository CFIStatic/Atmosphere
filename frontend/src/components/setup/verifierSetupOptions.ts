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

export type ServiceTrade =
  | 'hvac'
  | 'plumbing'
  | 'electrical'
  | 'cleaning'
  | 'facilities'
  | 'other';

export const SERVICE_TRADE_OPTIONS: {
  value: ServiceTrade;
  label: string;
  blurb: string;
  contractorType: ContractorType;
  workType: WorkType;
}[] = [
  {
    value: 'hvac',
    label: 'HVAC',
    blurb: 'Heating, cooling, and mechanical service work verified on site.',
    contractorType: 'other',
    workType: 'construction',
  },
  {
    value: 'plumbing',
    label: 'Plumbing',
    blurb: 'Plumbing installs, repairs, and service calls with a daily verification record.',
    contractorType: 'other',
    workType: 'construction',
  },
  {
    value: 'electrical',
    label: 'Electrical',
    blurb: 'Electrical service and install work — filmed, checked, and held on the record.',
    contractorType: 'other',
    workType: 'construction',
  },
  {
    value: 'cleaning',
    label: 'Cleaning',
    blurb: 'Commercial or specialty cleaning with before-and-after proof of work.',
    contractorType: 'other',
    workType: 'construction',
  },
  {
    value: 'facilities',
    label: 'Facilities',
    blurb: 'Facilities maintenance and multi-trade service contracts.',
    contractorType: 'general_contractor',
    workType: 'construction',
  },
  {
    value: 'other',
    label: 'Other service trade',
    blurb: 'Any service contractor work that needs a verifiable field record.',
    contractorType: 'other',
    workType: 'construction',
  },
];

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

  const roleOption = VERIFIER_ROLE_OPTIONS.find((r) => r.value === role);
  const tradeOption = SERVICE_TRADE_OPTIONS.find((t) => t.value === trade);

  return {
    role,
    workType: tradeOption?.workType ?? ('construction' as WorkType),
    contractorType: tradeOption?.contractorType ?? ('other' as ContractorType),
    usageIntents: roleOption?.usageIntents ?? (['exploring'] as UsageIntent[]),
  };
}
