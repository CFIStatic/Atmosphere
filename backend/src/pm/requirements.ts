import type { DocumentKind, LossType, MilestoneKind, ProjectPhase, WorkType } from './types.js';

/**
 * What a complete file looks like, and when the clock on it starts.
 *
 * Two catalogues:
 *
 *   * **Requirements** — the artifacts a job needs before it can be invoiced.
 *     Seeded onto a project as `pm_documents` rows in `missing` state, which
 *     turns "is this billable?" from a conversation into a query.
 *   * **Milestones** — dated commitments to somebody outside the crew. A
 *     requirement is something we owe; a milestone is something we owe *by a
 *     date*, and missing it has a consequence a to-do does not.
 *
 * Both are keyed, and both are seeded idempotently, so re-running the seeder on
 * a project that already has a signed authorization does not reset it.
 */

export interface Requirement {
  key: string;
  label: string;
  kind: DocumentKind;
  /**
   * Blocking requirements stop an invoice. Everything else is a nice-to-have
   * and must never be allowed to hold up billing — an agent that cries wolf
   * over an optional photograph gets switched off.
   */
  blocking: boolean;
  /** The phase by which it should exist. Used to decide when chasing starts. */
  requiredByPhase: ProjectPhase;
  workTypes: WorkType[];
  /** Restricts the requirement to particular losses (e.g. mould clearance). */
  lossTypes?: LossType[];
  /** Only applies when the job is an insurance claim. */
  insuranceOnly?: boolean;
  why?: string;
}

export const REQUIREMENTS: Requirement[] = [
  {
    key: 'authorization_to_perform',
    label: 'Signed authorization to perform',
    kind: 'signature',
    blocking: true,
    requiredByPhase: 'inspection',
    workTypes: ['mitigation', 'construction'],
    why: 'Without it the work was not authorised and the invoice is unenforceable.',
  },
  {
    key: 'pre_work_photos',
    label: 'Pre-work photographs',
    kind: 'photo',
    blocking: true,
    requiredByPhase: 'inspection',
    workTypes: ['mitigation', 'construction'],
    why: 'The before state cannot be recreated later.',
  },
  {
    key: 'scope_of_work',
    label: 'Written scope of work',
    kind: 'report',
    blocking: true,
    requiredByPhase: 'approval',
    workTypes: ['mitigation', 'construction'],
  },
  {
    key: 'estimate',
    label: 'Estimate',
    kind: 'estimate',
    blocking: true,
    requiredByPhase: 'approval',
    workTypes: ['mitigation', 'construction'],
  },
  {
    key: 'carrier_approval',
    label: 'Written carrier approval',
    kind: 'form',
    blocking: true,
    requiredByPhase: 'scheduled',
    workTypes: ['mitigation', 'construction'],
    insuranceOnly: true,
    why: 'A verbal approval from an adjuster is not an approval.',
  },
  {
    key: 'moisture_map',
    label: 'Moisture map with dry standards',
    kind: 'report',
    blocking: true,
    requiredByPhase: 'mitigation',
    workTypes: ['mitigation'],
    lossTypes: ['water', 'storm', 'mold'],
  },
  {
    key: 'containment_photos',
    label: 'Containment and equipment placement photographs',
    kind: 'photo',
    blocking: false,
    requiredByPhase: 'drying',
    workTypes: ['mitigation'],
  },
  {
    key: 'daily_reading_log',
    label: 'Daily moisture reading log',
    kind: 'reading_log',
    blocking: true,
    requiredByPhase: 'drying_complete',
    workTypes: ['mitigation'],
    lossTypes: ['water', 'storm', 'mold'],
    why: 'The reading log is what proves the job dried, and it is the first thing an auditor asks for.',
  },
  {
    key: 'disposal_log',
    label: 'Disposed materials log',
    kind: 'form',
    blocking: false,
    requiredByPhase: 'drying_complete',
    workTypes: ['mitigation'],
  },
  {
    key: 'mold_clearance',
    label: 'Third-party clearance test',
    kind: 'certificate',
    blocking: true,
    requiredByPhase: 'final_review',
    workTypes: ['mitigation'],
    lossTypes: ['mold'],
    why: 'Clearance is the only defensible way to close a mould job.',
  },
  {
    key: 'permits',
    label: 'Permits and inspection sign-offs',
    kind: 'certificate',
    blocking: true,
    requiredByPhase: 'production',
    workTypes: ['construction'],
  },
  {
    key: 'change_orders',
    label: 'Signed change orders',
    kind: 'signature',
    blocking: true,
    requiredByPhase: 'invoicing',
    workTypes: ['construction'],
    why: 'Unsigned change orders are the most common reason a final invoice gets cut down.',
  },
  {
    key: 'post_work_photos',
    label: 'Completion photographs',
    kind: 'photo',
    blocking: true,
    requiredByPhase: 'final_review',
    workTypes: ['mitigation', 'construction'],
  },
  {
    key: 'certificate_of_completion',
    label: 'Signed certificate of completion / satisfaction',
    kind: 'signature',
    blocking: true,
    requiredByPhase: 'invoicing',
    workTypes: ['mitigation', 'construction'],
  },
];

export interface ProjectShape {
  workType: WorkType;
  lossType: LossType | null;
  /** A claim number or carrier is what makes it an insurance job. */
  isInsurance: boolean;
}

export function requirementsFor(shape: ProjectShape): Requirement[] {
  return REQUIREMENTS.filter((r) => {
    if (!r.workTypes.includes(shape.workType)) return false;
    if (r.insuranceOnly && !shape.isInsurance) return false;
    if (r.lossTypes && (!shape.lossType || !r.lossTypes.includes(shape.lossType))) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Milestones
 * ------------------------------------------------------------------ */

export interface MilestoneTemplate {
  key: string;
  label: string;
  kind: MilestoneKind;
  /**
   * Hours from the project's start (its creation, or the loss date when one is
   * recorded — carriers count from the loss, not from when we heard about it).
   */
  dueInHours: number;
  workTypes: WorkType[];
  insuranceOnly?: boolean;
  why?: string;
}

export const MILESTONE_TEMPLATES: MilestoneTemplate[] = [
  {
    key: 'first_contact',
    label: 'First contact with the customer',
    kind: 'customer',
    dueInHours: 2,
    workTypes: ['mitigation', 'construction'],
  },
  {
    key: 'on_site',
    label: 'Crew on site',
    kind: 'internal',
    dueInHours: 24,
    workTypes: ['mitigation'],
  },
  {
    key: 'carrier_initial_report',
    label: 'Initial report to the carrier',
    kind: 'carrier',
    dueInHours: 72,
    workTypes: ['mitigation', 'construction'],
    insuranceOnly: true,
    why: 'Most carrier programmes want the first report inside 72 hours of the loss.',
  },
  {
    key: 'carrier_scope_submission',
    label: 'Scope submitted to the carrier',
    kind: 'carrier',
    dueInHours: 120,
    workTypes: ['mitigation', 'construction'],
    insuranceOnly: true,
  },
  {
    key: 'target_dry',
    label: 'Target dry date',
    kind: 'internal',
    dueInHours: 96,
    workTypes: ['mitigation'],
    why: 'Four days is the usual expectation for a class 2 dry-out; past it, somebody should be asking why.',
  },
];

export function milestonesFor(shape: ProjectShape): MilestoneTemplate[] {
  return MILESTONE_TEMPLATES.filter((m) => {
    if (!m.workTypes.includes(shape.workType)) return false;
    if (m.insuranceOnly && !shape.isInsurance) return false;
    return true;
  });
}
