import type { Priority, ProjectPhase, TaskCategory, WorkType } from './types.js';

/**
 * What a job needs at each phase, by trade.
 *
 * This is the part of the agent that is not clever, and that is the point. Most
 * of what a project manager forgets is not subtle — it is the containment
 * photo, the second signature, the certificate of completion — and a list that
 * never gets bored is better at those than judgement is.
 *
 * The catalogue lives in code rather than in the database because it is
 * reviewable: a diff shows exactly what work the system started or stopped
 * asking for, and who approved that.
 */

export interface PlaybookTask {
  /**
   * Stable within a project. Becomes `pm_tasks.origin_key`, which carries a
   * unique index — so re-running the playbook can never duplicate a task, and
   * a task the PM cancelled stays cancelled instead of growing back.
   */
  key: string;
  title: string;
  details?: string;
  category: TaskCategory;
  priority: Priority;
  /** Hours from when the project entered the phase. */
  dueInHours?: number;
  /** Repeats daily for as long as the phase lasts (the drying monitoring visit). */
  recurring?: 'daily';
}

export interface PhasePlaybook {
  phase: ProjectPhase;
  label: string;
  /** One-line description of what this phase is for, shown in the UI. */
  intent: string;
  tasks: PlaybookTask[];
}

/** The phases each trade actually moves through, in order. */
export const PHASE_SEQUENCE: Record<WorkType, ProjectPhase[]> = {
  mitigation: [
    'intake',
    'inspection',
    'approval',
    'scheduled',
    'mitigation',
    'drying',
    'drying_complete',
    'final_review',
    'invoicing',
    'paid',
  ],
  construction: [
    'intake',
    'inspection',
    'approval',
    'permitting',
    'scheduled',
    'production',
    'punch_list',
    'final_review',
    'invoicing',
    'paid',
  ],
};

export function isPhaseValidFor(workType: WorkType, phase: ProjectPhase): boolean {
  return PHASE_SEQUENCE[workType].includes(phase);
}

export function nextPhase(workType: WorkType, phase: ProjectPhase): ProjectPhase | null {
  const seq = PHASE_SEQUENCE[workType];
  const i = seq.indexOf(phase);
  if (i < 0 || i === seq.length - 1) return null;
  return seq[i + 1]!;
}

/** Phases in which a mitigation job is actively drying and owes daily readings. */
export const DRYING_PHASES: ProjectPhase[] = ['drying'];

const SHARED_INTAKE: PlaybookTask[] = [
  {
    key: 'intake:contact_customer',
    title: 'Make first contact with the customer',
    details:
      'Confirm the loss, the access arrangements, and who is authorised to sign. First contact inside two hours is the single biggest driver of a job going well.',
    category: 'customer',
    priority: 'urgent',
    dueInHours: 2,
  },
  {
    key: 'intake:authorization',
    title: 'Get the signed authorization to perform',
    details: 'Nothing bills without it. Get it signed before the crew starts, not after.',
    category: 'documentation',
    priority: 'urgent',
    dueInHours: 24,
  },
  {
    key: 'intake:assign_pm',
    title: 'Confirm the project manager and crew',
    category: 'scheduling',
    priority: 'high',
    dueInHours: 8,
  },
];

const SHARED_INSPECTION: PlaybookTask[] = [
  {
    key: 'inspection:pre_photos',
    title: 'Take pre-work photographs of every affected area',
    details:
      'Wide shot then detail, every room, before anything is moved. The photographs you did not take are the ones the adjuster asks for.',
    category: 'documentation',
    priority: 'high',
    dueInHours: 24,
  },
  {
    key: 'inspection:scope',
    title: 'Write the scope of work',
    category: 'inspection',
    priority: 'high',
    dueInHours: 48,
  },
];

const SHARED_CLOSEOUT: PlaybookTask[] = [
  {
    key: 'final:post_photos',
    title: 'Take completion photographs',
    category: 'documentation',
    priority: 'high',
    dueInHours: 24,
  },
  {
    key: 'final:walkthrough',
    title: 'Walk the job with the customer and get the completion certificate signed',
    category: 'customer',
    priority: 'high',
    dueInHours: 48,
  },
  {
    key: 'final:invoice_packet',
    title: 'Assemble the invoice packet',
    details: 'Scope, photographs, readings log, equipment days, signed certificate.',
    category: 'billing',
    priority: 'normal',
    dueInHours: 72,
  },
];

const MITIGATION: PhasePlaybook[] = [
  { phase: 'intake', label: 'Intake', intent: 'Get the job accepted, authorised and owned.', tasks: SHARED_INTAKE },
  {
    phase: 'inspection',
    label: 'Inspection',
    intent: 'Establish what is wet, how wet, and what dry looks like.',
    tasks: [
      ...SHARED_INSPECTION,
      {
        key: 'inspection:moisture_map',
        title: 'Map affected areas and record a dry standard for each',
        details:
          'Take an unaffected control reading of the same material — that is the dry standard, and without it there is no way to prove the job dried.',
        category: 'drying',
        priority: 'urgent',
        dueInHours: 24,
      },
      {
        key: 'inspection:category_class',
        title: 'Determine water category and class',
        details: 'Drives equipment counts, PPE, and whether materials can be dried in place.',
        category: 'inspection',
        priority: 'urgent',
        dueInHours: 12,
      },
    ],
  },
  {
    phase: 'approval',
    label: 'Carrier approval',
    intent: 'Get the carrier to agree the scope before the cost is incurred.',
    tasks: [
      {
        key: 'approval:submit_scope',
        title: 'Submit the scope and photographs to the carrier',
        category: 'insurance',
        priority: 'high',
        dueInHours: 24,
      },
      {
        key: 'approval:confirm_coverage',
        title: 'Confirm coverage, deductible and any scope exclusions in writing',
        details: 'Verbal approval from an adjuster is not approval.',
        category: 'insurance',
        priority: 'high',
        dueInHours: 48,
      },
    ],
  },
  {
    phase: 'scheduled',
    label: 'Scheduled',
    intent: 'Crew, equipment and access lined up for the start date.',
    tasks: [
      {
        key: 'scheduled:confirm_access',
        title: 'Confirm site access and start time with the customer',
        category: 'customer',
        priority: 'high',
        dueInHours: 24,
      },
      {
        key: 'scheduled:stage_equipment',
        title: 'Stage the equipment the class calls for',
        category: 'equipment',
        priority: 'high',
        dueInHours: 24,
      },
    ],
  },
  {
    phase: 'mitigation',
    label: 'Mitigation',
    intent: 'Extract, remove unsalvageable material, set the drying chamber.',
    tasks: [
      {
        key: 'mitigation:containment_photos',
        title: 'Photograph containment and equipment placement',
        category: 'documentation',
        priority: 'high',
        dueInHours: 12,
      },
      {
        key: 'mitigation:place_equipment',
        title: 'Place and record every piece of equipment on site',
        details:
          'Recording placement is what makes equipment-days billable — and what stops a dehu being left behind.',
        category: 'equipment',
        priority: 'urgent',
        dueInHours: 8,
      },
      {
        key: 'mitigation:disposal_log',
        title: 'Log disposed materials with quantities',
        category: 'documentation',
        priority: 'normal',
        dueInHours: 48,
      },
    ],
  },
  {
    phase: 'drying',
    label: 'Drying',
    intent: 'Daily readings against the dry standard until every area meets it.',
    tasks: [
      {
        key: 'drying:daily_readings',
        title: 'Take today’s moisture and psychrometric readings',
        details:
          'Every affected area plus one unaffected control and one outside reading. A day without a reading is a day you cannot bill for and cannot defend.',
        category: 'drying',
        priority: 'urgent',
        dueInHours: 24,
        recurring: 'daily',
      },
    ],
  },
  {
    phase: 'drying_complete',
    label: 'Dry-out complete',
    intent: 'Prove it dried, then get the equipment back.',
    tasks: [
      {
        key: 'drying_complete:final_readings',
        title: 'Record final readings showing every area at or below its dry standard',
        category: 'drying',
        priority: 'urgent',
        dueInHours: 12,
      },
      {
        key: 'drying_complete:pull_equipment',
        title: 'Pull the equipment and check it back in',
        details: 'Equipment left on a dried job bills nobody and is not available for the next one.',
        category: 'equipment',
        priority: 'urgent',
        dueInHours: 24,
      },
      {
        key: 'drying_complete:certificate',
        title: 'Get the certificate of satisfaction signed',
        category: 'documentation',
        priority: 'high',
        dueInHours: 48,
      },
    ],
  },
  { phase: 'final_review', label: 'Final review', intent: 'Close the file out properly.', tasks: SHARED_CLOSEOUT },
  {
    phase: 'invoicing',
    label: 'Invoicing',
    intent: 'Bill it while the evidence is fresh.',
    tasks: [
      {
        key: 'invoicing:submit',
        title: 'Submit the invoice to the carrier or customer',
        category: 'billing',
        priority: 'high',
        dueInHours: 48,
      },
    ],
  },
  { phase: 'paid', label: 'Paid', intent: 'Done.', tasks: [] },
];

const CONSTRUCTION: PhasePlaybook[] = [
  { phase: 'intake', label: 'Intake', intent: 'Get the job accepted, authorised and owned.', tasks: SHARED_INTAKE },
  {
    phase: 'inspection',
    label: 'Inspection',
    intent: 'Measure it and price it.',
    tasks: [
      ...SHARED_INSPECTION,
      {
        key: 'inspection:measurements',
        title: 'Take full measurements and a materials list',
        category: 'inspection',
        priority: 'high',
        dueInHours: 48,
      },
    ],
  },
  {
    phase: 'approval',
    label: 'Approval',
    intent: 'Signed estimate and agreed change-order process before anyone starts.',
    tasks: [
      {
        key: 'approval:signed_estimate',
        title: 'Get the estimate signed',
        category: 'documentation',
        priority: 'urgent',
        dueInHours: 48,
      },
      {
        key: 'approval:deposit',
        title: 'Collect the deposit',
        category: 'billing',
        priority: 'high',
        dueInHours: 72,
      },
    ],
  },
  {
    phase: 'permitting',
    label: 'Permitting',
    intent: 'Permits pulled and inspections booked.',
    tasks: [
      {
        key: 'permitting:apply',
        title: 'Apply for the permits the scope requires',
        category: 'documentation',
        priority: 'urgent',
        dueInHours: 72,
      },
      {
        key: 'permitting:schedule_inspections',
        title: 'Book the required inspections',
        details: 'Rough-in inspections gate everything behind them; book them before the trades are ready, not after.',
        category: 'scheduling',
        priority: 'high',
        dueInHours: 120,
      },
    ],
  },
  {
    phase: 'scheduled',
    label: 'Scheduled',
    intent: 'Trades, materials and access sequenced.',
    tasks: [
      {
        key: 'scheduled:order_materials',
        title: 'Order long-lead materials',
        details: 'Cabinets, windows and flooring are what actually set the finish date.',
        category: 'scheduling',
        priority: 'urgent',
        dueInHours: 48,
      },
      {
        key: 'scheduled:confirm_trades',
        title: 'Confirm subcontractors and start dates',
        category: 'scheduling',
        priority: 'high',
        dueInHours: 72,
      },
    ],
  },
  {
    phase: 'production',
    label: 'Production',
    intent: 'Build it, and keep a record of it being built.',
    tasks: [
      {
        key: 'production:progress_photos',
        title: 'Take weekly progress photographs',
        category: 'documentation',
        priority: 'normal',
        dueInHours: 168,
        recurring: 'daily',
      },
      {
        key: 'production:customer_update',
        title: 'Send the customer a weekly progress update',
        details: 'The complaint is almost never about the schedule. It is about not being told about the schedule.',
        category: 'customer',
        priority: 'normal',
        dueInHours: 168,
      },
    ],
  },
  {
    phase: 'punch_list',
    label: 'Punch list',
    intent: 'Walk it, list it, finish it.',
    tasks: [
      {
        key: 'punch:walk',
        title: 'Walk the job and build the punch list with the customer',
        category: 'customer',
        priority: 'high',
        dueInHours: 48,
      },
      {
        key: 'punch:final_inspection',
        title: 'Book the final inspection',
        category: 'scheduling',
        priority: 'high',
        dueInHours: 72,
      },
    ],
  },
  { phase: 'final_review', label: 'Final review', intent: 'Close the file out properly.', tasks: SHARED_CLOSEOUT },
  {
    phase: 'invoicing',
    label: 'Invoicing',
    intent: 'Bill it while the evidence is fresh.',
    tasks: [
      {
        key: 'invoicing:final_invoice',
        title: 'Issue the final invoice including approved change orders',
        category: 'billing',
        priority: 'high',
        dueInHours: 48,
      },
    ],
  },
  { phase: 'paid', label: 'Paid', intent: 'Done.', tasks: [] },
];

export const PLAYBOOKS: Record<WorkType, PhasePlaybook[]> = {
  mitigation: MITIGATION,
  construction: CONSTRUCTION,
};

export function playbookFor(workType: WorkType, phase: ProjectPhase): PhasePlaybook | null {
  return PLAYBOOKS[workType].find((p) => p.phase === phase) ?? null;
}

/**
 * Every task the playbook wants for a project that has reached `phase`.
 *
 * Cumulative rather than per-phase: a job that jumped from intake straight to
 * drying still owes its authorization and its dry standard, and a system that
 * only ever asks about the current phase would let both disappear. Phases the
 * project has passed through still count.
 */
export function expectedTasksUpTo(workType: WorkType, phase: ProjectPhase): PlaybookTask[] {
  const seq = PHASE_SEQUENCE[workType];
  const index = seq.indexOf(phase);
  if (index < 0) return [];
  const reached = new Set(seq.slice(0, index + 1));
  return PLAYBOOKS[workType].filter((p) => reached.has(p.phase)).flatMap((p) => p.tasks);
}
