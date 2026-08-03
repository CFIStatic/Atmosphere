/**
 * Demo mode — a mocked backend behind the real UI.
 *
 * Built with `VITE_DEMO=1`, the app installs this fetch interceptor before it
 * boots and every `/api/*` call is answered in-page from the fixtures below:
 * a plausible restoration company mid-week, so every surface renders the way
 * it does in production. The mock is stateful where the story needs it —
 * signing out, signing back in, creating an organization, and joining with
 * the demo code all work — and everything else answers 503 with a note that
 * the surface needs the live backend.
 *
 * Nothing here ships in a normal build: `main.tsx` only imports this module
 * when VITE_DEMO is set, so production bundles never contain it.
 */
import type {
  AgentMemory,
  Escalation,
  AgentSummary,
  AuditRun,
  AuditStats,
  AuditStep,
  AuthUser,
  BillingOverview,
  BillingSettings,
  Catalog,
  ComputerStatus,
  JobDetail,
  JobSummary,
  Membership,
  MemoryEvent,
  MemoryStats,
  OrgMember,
  PmOverview,
  PmSettingsResponse,
  Profile,
  TechnicianCapabilities,
  UsageDay,
  UsageEvent,
  Verification,
  WebConnection,
  WebRun,
  XactimateStatus,
} from '../lib/api';

/* ------------------------------------------------------------------ state */

// A wrapper page can set `window.__DEMO_SIGNED_OUT = true` before the bundle
// runs to start the demo at the sign-in screen — the corporate-site-to-console
// walkthrough begins signed out, the standalone app demo begins signed in.
const startSignedOut = Boolean((window as { __DEMO_SIGNED_OUT?: boolean }).__DEMO_SIGNED_OUT);

const state = {
  signedIn: !startSignedOut,
  onboarded: true,
  email: 'dana@ortizrestoration.com',
  fullName: 'Dana Ortiz' as string | null,
  orgName: 'Ortiz Restoration Group',
  joinCode: '8F3A9C2B',
  settings: {
    autoReloadEnabled: true,
    autoReloadThresholdNanos: 5_000_000_000,
    autoReloadAmountNanos: 25_000_000_000,
    monthlySpendLimitNanos: null,
  } as BillingSettings,
};

const user = (): AuthUser => ({
  id: 'demo-user-1',
  email: state.email,
  createdAt: '2026-06-02T14:11:00Z',
  lastSignInAt: '2026-08-01T13:05:00Z',
  emailConfirmed: true,
  metadata: {},
});

const profile = (): Profile => ({
  id: 'demo-user-1',
  email: state.email,
  fullName: state.fullName,
  createdAt: '2026-06-02T14:11:00Z',
  updatedAt: '2026-07-28T09:40:00Z',
});

const membership = (): Membership => ({
  role: 'project_manager',
  workType: 'mitigation',
  usageIntents: ['project_management', 'mitigation_estimating', 'billing'],
  status: 'active',
  org: {
    id: 'org-1',
    name: state.orgName,
    joinCode: state.joinCode,
    createdAt: '2026-06-02T14:12:00Z',
    contractorType: 'restoration',
  },
});

/* ---------------------------------------------------------------- members */

const MEMBERS: OrgMember[] = [
  { userId: 'demo-user-1', email: 'dana@ortizrestoration.com', fullName: 'Dana Ortiz', role: 'project_manager', workType: 'mitigation', usageIntents: ['project_management', 'mitigation_estimating', 'billing'], status: 'active' },
  { userId: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb', role: 'field_technician', workType: 'mitigation', usageIntents: ['field_work'], status: 'active' },
  { userId: 'u-priya', email: 'priya@ortizrestoration.com', fullName: 'Priya Shah', role: 'sales', workType: 'construction', usageIntents: ['crm', 'construction_estimating'], status: 'active' },
  { userId: 'u-tom', email: 'tom@ortizrestoration.com', fullName: 'Tom Reyes', role: 'office_manager', workType: 'mitigation', usageIntents: ['web_access', 'project_management'], status: 'active' },
  { userId: 'u-elena', email: 'elena@ortizrestoration.com', fullName: 'Elena Cruz', role: 'accountant', workType: 'construction', usageIntents: ['billing'], status: 'active' },
];

/* ------------------------------------------------------------------- jobs */

const JOBS: JobSummary[] = [
  { jobId: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3', status: 'in_progress', priority: 2, workType: 'mitigation', ownerId: 'demo-user-1', claimNumber: 'CLM-88412', taskCount: 14, tasksDone: 9, crewSize: 3, minutesLogged: 2140, eventCount: 87, lastEvent: 'Moisture reading logged — master bedroom subfloor 14.2%', lastEventAt: '2026-08-01T12:20:00Z', contractAmount: 18420, invoicedAmount: 6200, paidAmount: 0, scheduledStart: '2026-08-01T13:00:00Z', createdAt: '2026-07-24T15:02:00Z', updatedAt: '2026-08-01T12:20:00Z' },
  { jobId: 'job-1038', jobNumber: 1038, title: 'Cedar Ridge — storm damage, roof tarp + rebuild', status: 'in_progress', priority: 1, workType: 'construction', ownerId: 'u-priya', claimNumber: 'CLM-88396', taskCount: 11, tasksDone: 4, crewSize: 2, minutesLogged: 1310, eventCount: 52, lastEvent: 'Supplement approved by carrier — $4,180', lastEventAt: '2026-08-01T10:05:00Z', contractAmount: 13980, invoicedAmount: 13980, paidAmount: 9800, scheduledStart: '2026-08-01T15:30:00Z', createdAt: '2026-07-19T08:30:00Z', updatedAt: '2026-08-01T10:05:00Z' },
  { jobId: 'job-1042', jobNumber: 1042, title: 'Harbor Point Condos — mold remediation, unit 4B', status: 'scheduled', priority: 3, workType: 'mitigation', ownerId: 'demo-user-1', claimNumber: null, taskCount: 6, tasksDone: 1, crewSize: 1, minutesLogged: 95, eventCount: 12, lastEvent: 'Containment plan drafted', lastEventAt: '2026-07-31T16:44:00Z', contractAmount: 9200, invoicedAmount: 0, paidAmount: 0, scheduledStart: '2026-08-02T14:00:00Z', createdAt: '2026-07-30T11:15:00Z', updatedAt: '2026-07-31T16:44:00Z' },
  { jobId: 'job-1035', jobNumber: 1035, title: 'Lakeview Dental — contents pack-out', status: 'completed', priority: 4, workType: 'mitigation', ownerId: 'u-tom', claimNumber: 'CLM-88371', taskCount: 8, tasksDone: 8, crewSize: 2, minutesLogged: 960, eventCount: 41, lastEvent: 'Final walkthrough signed off', lastEventAt: '2026-07-29T17:30:00Z', contractAmount: 7600, invoicedAmount: 7600, paidAmount: 7600, scheduledStart: null, createdAt: '2026-07-12T09:00:00Z', updatedAt: '2026-07-29T17:30:00Z' },
];

const JOB_DETAIL: JobDetail = {
  job: {
    id: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3',
    description: 'Supply line failure on the second floor; Class 3 water intrusion across kitchen, dining, and master bedroom. Drying in progress; rebuild scope in draft.',
    workType: 'mitigation', lossType: 'water', status: 'in_progress', priority: 2,
    claimNumber: 'CLM-88412', policyNumber: 'HO-2214-8876', ownerId: 'demo-user-1',
    contactId: null, accountId: null, propertyId: null,
    lossDate: '2026-07-23T22:40:00Z', scheduledStart: '2026-07-24T13:00:00Z', scheduledEnd: '2026-08-08T00:00:00Z',
    actualStart: '2026-07-24T13:20:00Z', actualEnd: null,
    contractAmount: 18420, invoicedAmount: 6200, paidAmount: 0,
    createdBy: 'demo-user-1', createdAt: '2026-07-24T15:02:00Z', updatedAt: '2026-08-01T12:20:00Z',
  },
  tasks: [
    { id: 't-1', jobId: 'job-1041', title: 'Daily moisture readings — all mapped areas', details: 'Subfloor, wall cavities, and contents staging area.', status: 'in_progress', priority: 'high', assignedTo: 'u-marcus', assignee: { id: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb' }, dueAt: '2026-08-01T21:00:00Z', position: 1, completedAt: null, completedBy: null, createdBy: 'demo-user-1', createdAt: '2026-07-24T15:10:00Z', updatedAt: '2026-08-01T12:20:00Z' },
    { id: 't-2', jobId: 'job-1041', title: 'Send drying update to adjuster', details: 'Day 8 — include projected dry-standard date.', status: 'todo', priority: 'normal', assignedTo: 'demo-user-1', assignee: { id: 'demo-user-1', email: 'dana@ortizrestoration.com', fullName: 'Dana Ortiz' }, dueAt: '2026-08-02T16:00:00Z', position: 2, completedAt: null, completedBy: null, createdBy: 'demo-user-1', createdAt: '2026-07-31T09:00:00Z', updatedAt: '2026-07-31T09:00:00Z' },
    { id: 't-3', jobId: 'job-1041', title: 'Rebuild estimate — kitchen cabinetry', details: 'Waiting on cabinet spec from homeowner.', status: 'blocked', priority: 'normal', assignedTo: 'u-priya', assignee: { id: 'u-priya', email: 'priya@ortizrestoration.com', fullName: 'Priya Shah' }, dueAt: null, position: 3, completedAt: null, completedBy: null, createdBy: 'demo-user-1', createdAt: '2026-07-29T10:30:00Z', updatedAt: '2026-07-30T14:00:00Z' },
  ],
  crew: [
    { id: 'a-1', jobId: 'job-1041', userId: 'u-marcus', agent: { id: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb' }, roleOnJob: 'lead', assignedBy: 'demo-user-1', assignedAt: '2026-07-24T15:05:00Z', releasedAt: null, active: true },
    { id: 'a-2', jobId: 'job-1041', userId: 'u-tom', agent: { id: 'u-tom', email: 'tom@ortizrestoration.com', fullName: 'Tom Reyes' }, roleOnJob: 'crew', assignedBy: 'demo-user-1', assignedAt: '2026-07-25T08:00:00Z', releasedAt: null, active: true },
  ],
  workLogs: [
    { id: 'w-1', jobId: 'job-1041', taskId: 't-1', kind: 'work', body: 'Repositioned two air movers to the master bedroom closet; subfloor reading down to 14.2% from 16.8%.', minutes: 45, occurredAt: '2026-08-01T12:15:00Z', authorId: 'u-marcus', author: { id: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb' }, createdAt: '2026-08-01T12:20:00Z', updatedAt: '2026-08-01T12:20:00Z', edited: false },
    { id: 'w-2', jobId: 'job-1041', taskId: null, kind: 'call', body: 'Adjuster confirmed supplement path for cabinet uppers — send photos with the day-8 update.', minutes: 15, occurredAt: '2026-07-31T15:00:00Z', authorId: 'demo-user-1', author: { id: 'demo-user-1', email: 'dana@ortizrestoration.com', fullName: 'Dana Ortiz' }, createdAt: '2026-07-31T15:05:00Z', updatedAt: '2026-07-31T15:05:00Z', edited: false },
  ],
  memory: [],
};

/* ----------------------------------------------------------------- memory */

const EVENTS: MemoryEvent[] = [
  { id: 'e-1', seq: 1287, actorId: 'u-marcus', actorEmail: 'marcus@ortizrestoration.com', actorRole: 'field_technician', eventType: 'work_logged', entityType: 'work_log', entityId: 'w-1', jobId: 'job-1041', job: { id: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3' }, summary: 'Logged 45 min — air movers repositioned, subfloor at 14.2%', changes: {}, snapshot: null, source: 'app', occurredAt: '2026-08-01T12:20:00Z' },
  { id: 'e-2', seq: 1286, actorId: null, actorEmail: null, actorRole: null, eventType: 'estimate_built', entityType: 'estimate', entityId: 'est-204', jobId: 'job-1041', job: { id: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3' }, summary: 'Mitigation Estimator built a 214-line estimate and flagged $1,840 performed-but-unbilled', changes: {}, snapshot: null, source: 'app', occurredAt: '2026-08-01T09:44:00Z' },
  { id: 'e-3', seq: 1285, actorId: 'u-priya', actorEmail: 'priya@ortizrestoration.com', actorRole: 'sales', eventType: 'status_changed', entityType: 'job', entityId: 'job-1038', jobId: 'job-1038', job: { id: 'job-1038', jobNumber: 1038, title: 'Cedar Ridge — storm damage, roof tarp + rebuild' }, summary: 'Carrier approved the $4,180 supplement', changes: { invoicedAmount: { from: 9800, to: 13980 } }, snapshot: null, source: 'app', occurredAt: '2026-08-01T10:05:00Z' },
  { id: 'e-4', seq: 1284, actorId: 'u-tom', actorEmail: 'tom@ortizrestoration.com', actorRole: 'office_manager', eventType: 'run_verified', entityType: 'web_run', entityId: 'wr-2', jobId: null, job: null, summary: 'Verifier confirmed the claim note landed in the Alliance portal', changes: {}, snapshot: null, source: 'app', occurredAt: '2026-07-31T17:26:00Z' },
  { id: 'e-5', seq: 1283, actorId: 'demo-user-1', actorEmail: 'dana@ortizrestoration.com', actorRole: 'project_manager', eventType: 'task_created', entityType: 'job_task', entityId: 't-2', jobId: 'job-1041', job: { id: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3' }, summary: 'Task created: send drying update to adjuster', changes: {}, snapshot: null, source: 'app', occurredAt: '2026-07-31T09:00:00Z' },
  { id: 'e-6', seq: 1282, actorId: 'demo-user-1', actorEmail: 'dana@ortizrestoration.com', actorRole: 'project_manager', eventType: 'job_created', entityType: 'job', entityId: 'job-1042', jobId: 'job-1042', job: { id: 'job-1042', jobNumber: 1042, title: 'Harbor Point Condos — mold remediation, unit 4B' }, summary: 'Job #1042 opened — mold remediation, unit 4B', changes: {}, snapshot: null, source: 'app', occurredAt: '2026-07-30T11:15:00Z' },
];
JOB_DETAIL.memory = EVENTS.filter((e) => e.jobId === 'job-1041');

const MEMORY_STATS: MemoryStats = {
  totalEvents: 1287, agents: 5, activeToday: 3, minutesLogged: 6420, eventsInWindow: 96,
  byType: { work_logged: 34, task_completed: 22, status_changed: 14, estimate_built: 9, reading_logged: 8, run_verified: 5, job_created: 4 },
};

const AGENT_MEMORY: AgentMemory[] = [
  { userId: 'demo-user-1', email: 'dana@ortizrestoration.com', fullName: 'Dana Ortiz', role: 'project_manager', workType: 'mitigation', eventCount: 402, jobsTouched: 11, openTasks: 5, tasksCompleted: 63, minutesLogged: 1240, lastActiveAt: '2026-08-01T12:40:00Z' },
  { userId: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb', role: 'field_technician', workType: 'mitigation', eventCount: 366, jobsTouched: 7, openTasks: 3, tasksCompleted: 58, minutesLogged: 2870, lastActiveAt: '2026-08-01T12:20:00Z' },
  { userId: 'u-priya', email: 'priya@ortizrestoration.com', fullName: 'Priya Shah', role: 'sales', workType: 'construction', eventCount: 214, jobsTouched: 9, openTasks: 4, tasksCompleted: 31, minutesLogged: 640, lastActiveAt: '2026-08-01T10:05:00Z' },
  { userId: 'u-tom', email: 'tom@ortizrestoration.com', fullName: 'Tom Reyes', role: 'office_manager', workType: 'mitigation', eventCount: 198, jobsTouched: 12, openTasks: 2, tasksCompleted: 44, minutesLogged: 890, lastActiveAt: '2026-07-31T17:30:00Z' },
  { userId: 'u-elena', email: 'elena@ortizrestoration.com', fullName: 'Elena Cruz', role: 'accountant', workType: 'construction', eventCount: 107, jobsTouched: 6, openTasks: 1, tasksCompleted: 19, minutesLogged: 310, lastActiveAt: '2026-07-30T15:12:00Z' },
];

/* ------------------------------------------------------------------ audit */

const agentDef = (key: string, name: string, blurb: string, accent: AgentSummary['accent']) =>
  ({ key, name, blurb, accent, intake: 'ledger' as const });

const AUDIT_AGENTS: AgentSummary[] = [
  { ...agentDef('mitigation-estimator', 'Mitigation Estimator', 'Reads the scan, the report, and the photos; prices the scope.', 'brand'), total: 128, succeeded: 121, failed: 4, active: 3, steps: 2432, lastRunAt: '2026-08-01T09:44:00Z', avgDurationMs: 214000 },
  { ...agentDef('verifier', 'Verifier', 'Re-opens finished work read-only and confirms it happened.', 'success'), total: 96, succeeded: 92, failed: 2, active: 2, steps: 861, lastRunAt: '2026-07-31T17:26:00Z', avgDurationMs: 88000 },
  { ...agentDef('web-access', 'Web Access', 'Signs in to carrier and supplier portals and works in them.', 'neutral'), total: 84, succeeded: 79, failed: 5, active: 0, steps: 1204, lastRunAt: '2026-07-31T17:12:00Z', avgDurationMs: 132000 },
  { ...agentDef('project-manager', 'Project Manager', 'Nineteen rules watching every open project.', 'caution'), total: 62, succeeded: 62, failed: 0, active: 0, steps: 740, lastRunAt: '2026-08-01T07:00:00Z', avgDurationMs: 41000 },
  { ...agentDef('field-assistant', 'Field Assistant', 'Answers technicians on site and names what the camera sees.', 'neutral'), total: 57, succeeded: 55, failed: 2, active: 0, steps: 312, lastRunAt: '2026-08-01T11:52:00Z', avgDurationMs: 9000 },
];

const AUDIT_STATS: AuditStats = {
  totalRuns: 427, activeRuns: 5, failedRuns: 13, succeededRuns: 409, totalSteps: 5549,
  inputTokens: 18400000, outputTokens: 2140000, runs24h: 31, agentsSeen: 5,
  lastRunAt: '2026-08-01T11:52:00Z',
};

const mkRun = (id: string, agentKey: string, title: string, status: AuditRun['status'], startedAt: string, durationMs: number, steps: number, summary: string | null): AuditRun => {
  const def = AUDIT_AGENTS.find((a) => a.key === agentKey)!;
  return {
    id, agentKey, agent: def, agentLabel: null, actorType: 'agent', actorUserId: null,
    actorEmail: null, actorLabel: def.name, parentRunId: null, title, summary, status,
    error: status === 'failed' ? 'Carrier portal session expired mid-run; retried on the next schedule.' : null,
    stepCount: steps, inputTokens: 61000, outputTokens: 5400, sourceTable: null, sourceId: null,
    startedAt, finishedAt: status === 'running' ? null : new Date(Date.parse(startedAt) + durationMs).toISOString(),
    durationMs: status === 'running' ? null : durationMs, createdAt: startedAt, updatedAt: startedAt,
  };
};

const AUDIT_RUNS: AuditRun[] = [
  mkRun('run-4187', 'mitigation-estimator', 'Mitigation estimate — Job 22-0148', 'succeeded', '2026-08-01T09:41:03Z', 415000, 8, 'Built a 214-line Xactimate estimate; found 3 items performed but never billed (+$1,840). Verifier confirmed.'),
  mkRun('run-4186', 'field-assistant', 'Assist — moisture mapping question', 'succeeded', '2026-08-01T11:52:00Z', 8000, 3, 'Explained dry-standard targets for Class 3 subfloor.'),
  mkRun('run-4185', 'project-manager', 'Morning sweep — 3 projects', 'succeeded', '2026-08-01T07:00:00Z', 41000, 12, 'Raised 1 critical and 2 warnings; created 2 tasks.'),
  mkRun('run-4184', 'verifier', 'Verify — claim note in Alliance portal', 'succeeded', '2026-07-31T17:24:00Z', 96000, 9, 'Re-opened the portal read-only; note present with the right claim number.'),
  mkRun('run-4183', 'web-access', 'Push claim note — Alliance Claims Portal', 'succeeded', '2026-07-31T17:10:00Z', 122000, 14, 'Signed in, opened claim CLM-88412, posted the drying update.'),
  mkRun('run-4179', 'web-access', 'Pull price list — BuildSupply Pro', 'failed', '2026-07-31T09:02:00Z', 64000, 7, null),
];

const mkStep = (seq: number, type: AuditStep['type'], action: string, detail: string | null, status: AuditStep['status'] = 'ok'): AuditStep => ({
  id: `s-${seq}`, seq, type, action, detail, target: null, payload: null, status, error: null,
  startedAt: null, finishedAt: null, durationMs: null, createdAt: '2026-08-01T09:41:03Z',
});

const RUN_DETAIL_STEPS: AuditStep[] = [
  mkStep(1, 'tool_call', 'Read DocuSketch scan', '14 rooms mapped'),
  mkStep(2, 'tool_call', 'Read MICA report + 62 field photos', 'moisture map merged'),
  mkStep(3, 'decision', 'Classified losses against IICRC S500', 'Class 3 / Category 2'),
  mkStep(4, 'artifact', 'Built Xactimate estimate', '214 line items'),
  mkStep(5, 'observation', 'Found 3 items performed, never billed', '+$1,840'),
  mkStep(6, 'navigation', 'Verifier: re-opened in a read-only browser', null),
  mkStep(7, 'observation', 'Confirmed against the task as written', 'all expectations satisfied'),
  mkStep(8, 'status', 'Complete', 'replay available in the audit trail'),
];

/* ---------------------------------------------------------------- billing */

const CATALOG: Catalog = {
  plans: [
    { code: 'pro', name: 'Pro', tagline: 'For individual estimators and PMs', monthlyPriceCents: 2000, annualPriceCents: 1700, includedCreditsNanos: 0, perSeat: false, minSeats: 1, rateMultiplier: 1, features: ['Priority model access', 'Usage analytics', 'Email support'], isContactSales: false },
    { code: 'max_5x', name: 'Max 5x', tagline: 'Heavier daily workloads', monthlyPriceCents: 10000, annualPriceCents: null, includedCreditsNanos: 0, perSeat: false, minSeats: 1, rateMultiplier: 5, features: ['5× Pro throughput', 'Batch processing', 'Priority support'], isContactSales: false },
    { code: 'max_20x', name: 'Max 20x', tagline: 'Power users running all day', monthlyPriceCents: 20000, annualPriceCents: null, includedCreditsNanos: 0, perSeat: false, minSeats: 1, rateMultiplier: 20, features: ['20× Pro throughput', 'Batch processing', 'Priority support'], isContactSales: false },
    { code: 'team', name: 'Team', tagline: 'Shared billing across the crew', monthlyPriceCents: 3000, annualPriceCents: 2500, includedCreditsNanos: 0, perSeat: true, minSeats: 5, rateMultiplier: 5, features: ['One pooled bill', 'Central spend limits', 'Role-based billing access', '5× Pro throughput'], isContactSales: false },
    { code: 'enterprise', name: 'Enterprise', tagline: 'Custom volume and terms', monthlyPriceCents: 0, annualPriceCents: null, includedCreditsNanos: 0, perSeat: true, minSeats: 25, rateMultiplier: 5, features: ['Volume rates on usage', 'SSO and audit logs', 'Dedicated support'], isContactSales: true },
  ],
  packs: [
    { code: 'starter', name: 'Starter', priceCents: 1000, creditsNanos: 10_000_000_000, bonusNanos: 0 },
    { code: 'crew', name: 'Crew', priceCents: 2500, creditsNanos: 25_000_000_000, bonusNanos: 0 },
    { code: 'pro', name: 'Pro', priceCents: 10000, creditsNanos: 100_000_000_000, bonusNanos: 5_000_000_000 },
    { code: 'heavy', name: 'Heavy', priceCents: 25000, creditsNanos: 250_000_000_000, bonusNanos: 20_000_000_000 },
    { code: 'max', name: 'Max', priceCents: 100000, creditsNanos: 1_000_000_000_000, bonusNanos: 100_000_000_000 },
  ],
  rateCard: [
    { modelId: 'atmosphere-core', displayName: 'Atmosphere', family: 'atmosphere', inputPerMTok: 30, outputPerMTok: 150, cacheWrite5mPerMTok: 37.5, cacheWrite1hPerMTok: 60, cacheReadPerMTok: 3, batchDiscountPct: 50, contextWindow: 200000, maxOutputTokens: 64000 },
  ],
  paymentProvider: 'dev',
};

const balance = () => ({
  totalNanos: 216_400_000_000, planNanos: 0, purchasedNanos: 216_400_000_000,
  promoNanos: 0, nextExpiry: null,
});

const OVERVIEW = (): BillingOverview => ({
  subscription: {
    planCode: 'team', planName: 'Team', billingInterval: 'monthly', seats: 5, status: 'active',
    periodStart: '2026-07-15T00:00:00Z', periodEnd: '2026-08-15T00:00:00Z', cancelAtPeriodEnd: false,
    monthlyPriceCents: 3000, includedCreditsNanos: 0, rateMultiplier: 5,
  },
  settings: state.settings,
  balance: balance(),
  periodUsage: { events: 412, priceNanos: 96_420_000_000, inputTokens: 2_612_000, outputTokens: 447_000, cacheTokens: 1_020_000 },
  usageByModel: [
    { modelId: 'atmosphere-core', displayName: 'Atmosphere', events: 412, inputTokens: 2_612_000, outputTokens: 447_000, priceNanos: 96_420_000_000 },
  ],
  canManage: true,
});

const LEDGER = [
  { id: 'l-1', entryType: 'usage' as const, bucket: 'purchased' as const, amountNanos: -1_240_000_000, description: 'Mitigation estimate — run-4187', createdAt: '2026-08-01T09:48:00Z' },
  { id: 'l-2', entryType: 'usage' as const, bucket: 'purchased' as const, amountNanos: -310_000_000, description: 'PM morning sweep', createdAt: '2026-08-01T07:01:00Z' },
  { id: 'l-3', entryType: 'purchase' as const, bucket: 'purchased' as const, amountNanos: 105_000_000_000, description: 'Pro pack — $100 + $5 bonus', createdAt: '2026-07-28T14:00:00Z' },
  { id: 'l-4', entryType: 'usage' as const, bucket: 'purchased' as const, amountNanos: -860_000_000, description: 'Web access — Alliance portal push + verify', createdAt: '2026-07-31T17:30:00Z' },
  { id: 'l-5', entryType: 'usage' as const, bucket: 'purchased' as const, amountNanos: -420_000_000, description: 'Field assistant, 7 questions', createdAt: '2026-07-30T18:12:00Z' },
  { id: 'l-6', entryType: 'purchase' as const, bucket: 'purchased' as const, amountNanos: 105_000_000_000, description: 'Pro pack — auto-reload', createdAt: '2026-07-18T03:20:00Z' },
];

const PURCHASES = [
  { id: 'p-1', packCode: 'pro', creditsNanos: 100_000_000_000, bonusNanos: 5_000_000_000, amountCents: 10000, status: 'completed' as const, provider: 'dev', isAutoReload: false, createdAt: '2026-07-28T14:00:00Z', completedAt: '2026-07-28T14:00:05Z' },
  { id: 'p-2', packCode: 'pro', creditsNanos: 100_000_000_000, bonusNanos: 5_000_000_000, amountCents: 10000, status: 'completed' as const, provider: 'dev', isAutoReload: true, createdAt: '2026-07-18T03:20:00Z', completedAt: '2026-07-18T03:20:04Z' },
];

const PAYMENTS = [
  { id: 'pay-1', kind: 'subscription' as const, status: 'succeeded' as const, amountCents: 15000, currency: 'usd', description: 'Team — 5 seats, July 15 to August 15', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: '2026-07-15T00:00:00Z', periodEnd: '2026-08-15T00:00:00Z', failureReason: null, createdAt: '2026-07-15T00:05:00Z' },
  { id: 'pay-2', kind: 'credits' as const, status: 'succeeded' as const, amountCents: 10000, currency: 'usd', description: 'Pro credit pack', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: null, periodEnd: null, failureReason: null, createdAt: '2026-07-28T14:00:05Z' },
  { id: 'pay-3', kind: 'credits' as const, status: 'succeeded' as const, amountCents: 10000, currency: 'usd', description: 'Pro credit pack — auto-reload', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: null, periodEnd: null, failureReason: null, createdAt: '2026-07-18T03:20:04Z' },
];

/* ------------------------------------------------------------------ usage */

const USAGE_EVENTS: UsageEvent[] = Array.from({ length: 12 }, (_, i) => ({
  id: `ue-${i + 1}`, modelId: 'atmosphere-core',
  feature: ['mitigation-estimator', 'project-manager', 'web-access', 'field-assistant'][i % 4],
  inputTokens: 41000 - i * 2200, outputTokens: 5200 - i * 240, cacheTokens: 12000,
  isBatch: false, priceNanos: 1_240_000_000 - i * 61_000_000,
  createdAt: new Date(Date.parse('2026-08-01T12:00:00Z') - i * 5_400_000).toISOString(),
}));

const USAGE_DAYS: UsageDay[] = Array.from({ length: 14 }, (_, i) => {
  const day = new Date(Date.parse('2026-08-01T00:00:00Z') - (13 - i) * 86_400_000)
    .toISOString().slice(0, 10);
  const events = [18, 24, 31, 12, 4, 2, 27, 33, 29, 41, 22, 6, 38, 25][i];
  return {
    day, modelId: 'atmosphere-core', events,
    inputTokens: events * 6200, outputTokens: events * 1080, cacheTokens: events * 2400,
    priceNanos: events * 235_000_000,
  };
});

/* --------------------------------------------------------------------- pm */

const PM_SETTINGS = {
  orgId: 'org-1', enabled: true, timezone: 'America/Chicago', digestHour: 7,
  readingIntervalHours: 24, dryingStallDays: 2, dryingProgressMinPct: 5,
  equipmentIdleHours: 48, staleProjectDays: 4, milestoneLeadDays: 3,
  maxProjectsPerCrew: 4, disabledRules: [], autoCreateTasks: true,
};

const pmProject = (id: string, num: string, name: string, phase: PmOverview['projects'][0]['project']['phase'], workType: 'mitigation' | 'construction', city: string): PmOverview['projects'][0]['project'] => ({
  id, orgId: 'org-1', projectNumber: num, name, description: null, workType,
  lossType: workType === 'mitigation' ? 'water' : 'storm', status: 'active', phase,
  priority: 'high', pmUserId: 'demo-user-1', customerName: null, customerPhone: null,
  customerEmail: null, addressLine1: null, city, region: 'TX', carrier: 'Alliance Mutual',
  claimNumber: 'CLM-88412', adjusterName: 'R. Calloway', scheduledStartAt: '2026-07-24T13:00:00Z',
  targetCompletionAt: '2026-08-08T00:00:00Z', startedAt: '2026-07-24T13:20:00Z',
  completedAt: null, createdAt: '2026-07-24T15:02:00Z', updatedAt: '2026-08-01T12:20:00Z',
});

const PM_OVERVIEW: PmOverview = {
  settings: PM_SETTINGS,
  role: 'project_manager', canManage: true, writingEnabled: true,
  counts: { projects: 3, critical: 1, warn: 2, mine: 2 },
  alerts: [
    { id: 'al-1', projectId: 'pm-1', ruleKey: 'drying_stalled', severity: 'critical', category: 'drying', title: 'Drying stalled — master bedroom subfloor', detail: 'Moisture dropped only 1.1% in the last 48 hours against a 5% floor.', suggestedAction: 'Add one LGR dehumidifier or reassess the drying chamber.', status: 'open', occurrences: 2, firstSeenAt: '2026-07-31T07:00:00Z', lastSeenAt: '2026-08-01T07:00:00Z', facts: {}, project: { id: 'pm-1', projectNumber: 'P-1041', name: 'Meridian Ave — water loss' } },
    { id: 'al-2', projectId: 'pm-1', ruleKey: 'reading_overdue', severity: 'warn', category: 'drying', title: 'Moisture reading overdue — dining room', detail: 'Last reading 26 hours ago against a 24-hour interval.', suggestedAction: 'Ask the crew on site for a reading pass.', status: 'open', occurrences: 1, firstSeenAt: '2026-08-01T07:00:00Z', lastSeenAt: '2026-08-01T07:00:00Z', facts: {}, project: { id: 'pm-1', projectNumber: 'P-1041', name: 'Meridian Ave — water loss' } },
    { id: 'al-3', projectId: 'pm-3', ruleKey: 'doc_blocking_invoice', severity: 'warn', category: 'documentation', title: 'Invoice blocked — signed work authorization missing', detail: 'Harbor Point cannot invoice until the authorization is on file.', suggestedAction: 'Request the signature during tomorrow’s containment setup.', status: 'open', occurrences: 3, firstSeenAt: '2026-07-30T07:00:00Z', lastSeenAt: '2026-08-01T07:00:00Z', facts: {}, project: { id: 'pm-3', projectNumber: 'P-1042', name: 'Harbor Point Condos — mold remediation' } },
  ],
  projects: [
    { project: pmProject('pm-1', 'P-1041', 'Meridian Ave — water loss', 'mitigation', 'mitigation', 'Austin'), health: { score: 62, band: 'at_risk', reasons: [{ weight: 3, text: 'Drying stalled in one area' }, { weight: 1, text: 'Reading overdue' }] }, openTasks: 5, overdueTasks: 1, crewCount: 3, daysSinceActivity: 0, drying: { openAreas: 3, areasAtGoal: 1, areasOverdue: 1, areasStalled: 1, daysDrying: 8, allAreasAtGoal: false }, documentation: { completionPct: 78, invoiceReady: false, blocking: 1 } },
    { project: pmProject('pm-2', 'P-1038', 'Cedar Ridge — storm rebuild', 'rebuild' as PmOverview['projects'][0]['project']['phase'], 'construction', 'Round Rock'), health: { score: 88, band: 'good', reasons: [] }, openTasks: 7, overdueTasks: 0, crewCount: 2, daysSinceActivity: 0, drying: null, documentation: { completionPct: 92, invoiceReady: true, blocking: 0 } },
    { project: pmProject('pm-3', 'P-1042', 'Harbor Point Condos — mold remediation', 'scheduled', 'mitigation', 'Austin'), health: { score: 74, band: 'watch', reasons: [{ weight: 2, text: 'Blocking document missing' }] }, openTasks: 5, overdueTasks: 0, crewCount: 1, daysSinceActivity: 1, drying: null, documentation: { completionPct: 40, invoiceReady: false, blocking: 1 } },
  ],
  crew: [
    { userId: 'demo-user-1', email: 'dana@ortizrestoration.com', fullName: 'Dana Ortiz', role: 'project_manager', projectCount: 2, allocationPct: 120, openTaskCount: 7, overdueTaskCount: 1, projectNumbers: ['P-1041', 'P-1042'] },
    { userId: 'u-marcus', email: 'marcus@ortizrestoration.com', fullName: 'Marcus Webb', role: 'field_technician', projectCount: 2, allocationPct: 150, openTaskCount: 4, overdueTaskCount: 0, projectNumbers: ['P-1041', 'P-1042'] },
    { userId: 'u-priya', email: 'priya@ortizrestoration.com', fullName: 'Priya Shah', role: 'sales', projectCount: 1, allocationPct: 60, openTaskCount: 3, overdueTaskCount: 0, projectNumbers: ['P-1038'] },
  ],
  members: MEMBERS.map((m) => ({ userId: m.userId, email: m.email, fullName: m.fullName, role: m.role })),
};

const PM_SETTINGS_RESPONSE: PmSettingsResponse = {
  settings: PM_SETTINGS,
  rules: [
    { key: 'drying_stalled', label: 'Drying stalled', description: 'Moisture is not falling fast enough against the configured floor.', category: 'drying', scope: 'project' },
    { key: 'reading_overdue', label: 'Reading overdue', description: 'An area has gone past the reading interval without a new reading.', category: 'drying', scope: 'project' },
    { key: 'doc_blocking_invoice', label: 'Invoice blocked by documentation', description: 'A blocking document is missing on a project otherwise ready to bill.', category: 'documentation', scope: 'project' },
    { key: 'equipment_idle', label: 'Equipment idle', description: 'Deployed equipment has been idle past the configured window.', category: 'equipment', scope: 'org' },
    { key: 'project_stale', label: 'Project stale', description: 'No activity on an active project past the configured number of days.', category: 'activity', scope: 'project' },
  ],
  canManage: true,
  writingEnabled: true,
};

/* ------------------------------------------------------- web access & co. */

const WEB_CONNECTIONS: WebConnection[] = [
  { id: 'wc-1', label: 'Alliance Claims Portal', siteUrl: 'https://claims.alliancemutual.com', loginUrl: null, username: 'ortiz-restoration', status: 'verified', lastVerifiedAt: '2026-07-31T17:26:00Z', lastError: null, createdAt: '2026-06-20T10:00:00Z' },
  { id: 'wc-2', label: 'BuildSupply Pro', siteUrl: 'https://pro.buildsupply.com', loginUrl: null, username: 'purchasing@ortizrestoration.com', status: 'verified', lastVerifiedAt: '2026-07-29T08:12:00Z', lastError: null, createdAt: '2026-07-02T09:30:00Z' },
];

const WEB_RUNS: WebRun[] = [
  { id: 'wr-2', connectionId: 'wc-1', kind: 'push', instruction: 'Post the day-7 drying update to claim CLM-88412 with the moisture map attached.', status: 'succeeded', result: { summary: 'Update posted to claim CLM-88412; confirmation number ACP-119842.', records: [] }, steps: [ { index: 1, action: 'sign_in', detail: 'Signed in as ortiz-restoration', url: 'https://claims.alliancemutual.com/login' }, { index: 2, action: 'navigate', detail: 'Opened claim CLM-88412', url: 'https://claims.alliancemutual.com/claims/CLM-88412' }, { index: 3, action: 'fill_form', detail: 'Drafted the update note', url: 'https://claims.alliancemutual.com/claims/CLM-88412/notes' }, { index: 4, action: 'submit', detail: 'Posted — confirmation ACP-119842', url: 'https://claims.alliancemutual.com/claims/CLM-88412/notes' } ], error: null, startedAt: '2026-07-31T17:10:00Z', finishedAt: '2026-07-31T17:12:02Z', createdAt: '2026-07-31T17:10:00Z' },
  { id: 'wr-1', connectionId: 'wc-2', kind: 'pull', instruction: 'Pull current pricing for LGR dehumidifier rentals and 6-mil poly sheeting.', status: 'succeeded', result: { summary: '2 price rows pulled into the record.', records: [] }, steps: [ { index: 1, action: 'sign_in', detail: 'Signed in', url: 'https://pro.buildsupply.com/login' }, { index: 2, action: 'search', detail: 'LGR dehumidifier rental', url: 'https://pro.buildsupply.com/search' }, { index: 3, action: 'extract', detail: '2 rows captured', url: 'https://pro.buildsupply.com/rentals' } ], error: null, startedAt: '2026-07-29T08:10:00Z', finishedAt: '2026-07-29T08:12:00Z', createdAt: '2026-07-29T08:10:00Z' },
];

const VERIFICATIONS: Verification[] = [
  { id: 'v-1', runId: 'wr-2', connectionId: 'wc-1', status: 'verified', verdict: 'satisfied',
    expectations: [
      { id: 'ex-1', kind: 'record_exists', description: 'A note exists on claim CLM-88412 dated today', where: 'Claim notes', identifiers: { claim: 'CLM-88412' }, expected: { present: 'true' }, critical: true },
      { id: 'ex-2', kind: 'field_value', description: 'The note references day-7 drying status', where: 'Note body', identifiers: { claim: 'CLM-88412' }, expected: { contains: 'day 7' }, critical: false },
    ],
    findings: [
      { expectationId: 'ex-1', verdict: 'satisfied', evidence: 'Note ACP-119842 present, dated 2026-07-31.', url: 'https://claims.alliancemutual.com/claims/CLM-88412/notes', reasoning: 'The note is visible in the claim timeline with the expected confirmation number.' },
      { expectationId: 'ex-2', verdict: 'satisfied', evidence: 'Body opens with "Day 7 drying update".', url: 'https://claims.alliancemutual.com/claims/CLM-88412/notes', reasoning: 'Text matches the instruction.' },
    ],
    steps: [
      { index: 1, action: 'sign_in', detail: 'Read-only session opened', url: 'https://claims.alliancemutual.com/login', phase: 'observe' },
      { index: 2, action: 'navigate', detail: 'Opened claim CLM-88412 notes', url: 'https://claims.alliancemutual.com/claims/CLM-88412/notes', phase: 'observe' },
    ],
    repairAttempts: 0, summary: 'Both expectations satisfied on first look.', error: null,
    startedAt: '2026-07-31T17:24:00Z', finishedAt: '2026-07-31T17:26:00Z', createdAt: '2026-07-31T17:24:00Z' },
];

const ESCALATIONS: Escalation[] = [
  {
    id: 'esc-1',
    verificationId: 'v-2',
    runId: 'wr-3',
    reason: 'unsafe_repair',
    question: 'Assign inspection crew to STM-1044?',
    context: {
      reason: 'unsafe_repair',
      siteLabel: 'Alliance Claims Portal',
      runInstruction: 'Schedule the inspection for the Vance Residence storm claim.',
      verdict: 'indeterminate',
      verifierSummary:
        'The job has sat unassigned for 5 days. Ken Ohara has Thursday capacity and is 12 minutes from the property.',
      unsettled: [
        {
          expectation: 'An inspection visit exists on claim STM-1044',
          verdict: 'violated',
          evidence: 'No visit is scheduled; the claim shows three failed contact attempts.',
          url: 'https://claims.alliancemutual.com/claims/STM-1044',
          reasoning: 'The carrier requires an inspection within 7 days of assignment.',
          proposedFix: 'Assign Ken Ohara as inspection crew for Thursday 9:00 AM.',
          fixSafety: 'Writes a crew assignment — needs a person to approve.',
        },
      ],
    },
    options: [
      {
        id: 'assign',
        label: 'Assign Ken Ohara — Thursday 9:00 AM',
        detail: 'Writes the assignment and confirms the visit with the carrier.',
        action: 'repair',
      },
      {
        id: 'someone-else',
        label: 'Hold for a different assignee',
        detail: 'Keeps the job unassigned; the alert stays open.',
        action: 'reject',
      },
      {
        id: 'recheck',
        label: 'Re-check the claim first',
        detail: 'The verifier re-opens the portal read-only and reports back.',
        action: 'recheck',
      },
    ],
    status: 'open',
    chosenOption: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-08-01T11:20:00Z',
  },
];

/* ------------------------------------------------------------------- CRM */

const LEADS: Array<Record<string, any>> = [
  { id: 'ld-1', title: 'Westlake townhomes — burst riser, 6 units', status: 'estimate_sent', source: 'insurance_carrier', workType: 'mitigation', lossType: 'water', estimatedValue: 48200, description: 'Six units affected off a single riser. Carrier wants one estimate covering all of them.', updatedAt: '2026-08-01T09:10:00Z' },
  { id: 'ld-2', title: 'Verano Apartments — roof hail claim', status: 'qualified', source: 'referral', workType: 'construction', lossType: 'storm', estimatedValue: 96500, description: 'Property manager walked the roof with us; adjuster inspection booked.', updatedAt: '2026-07-31T14:40:00Z' },
  { id: 'ld-3', title: 'Delgado residence — kitchen supply line', status: 'contacted', source: 'web', workType: 'mitigation', lossType: 'water', estimatedValue: 12400, description: 'Homeowner available after 4pm. Cabinets likely affected.', updatedAt: '2026-08-01T11:05:00Z' },
  { id: 'ld-4', title: 'Riverbend Church — sanctuary water damage', status: 'new', source: 'phone', workType: 'mitigation', lossType: 'water', estimatedValue: 31000, description: 'Called Sunday evening. Services Wednesday — timing matters.', updatedAt: '2026-08-01T12:30:00Z' },
  { id: 'ld-5', title: 'Nguyen residence — storm siding', status: 'new', source: 'referral', workType: 'construction', lossType: 'storm', estimatedValue: 8700, updatedAt: '2026-07-30T16:20:00Z' },
  { id: 'ld-6', title: 'Foster Dental — sprinkler discharge', status: 'qualified', source: 'insurance_carrier', workType: 'mitigation', lossType: 'water', estimatedValue: 27300, description: 'After-hours discharge; practice closed until dry.', updatedAt: '2026-07-29T10:15:00Z' },
  { id: 'ld-7', title: 'Cedar Ridge — storm damage', status: 'won', source: 'referral', estimatedValue: 13980, convertedJobId: 'job-1038', updatedAt: '2026-07-19T08:30:00Z' },
  { id: 'ld-8', title: 'Meridian Ave — water loss', status: 'won', source: 'insurance_carrier', estimatedValue: 18420, convertedJobId: 'job-1041', updatedAt: '2026-07-24T15:02:00Z' },
  { id: 'ld-9', title: 'Alder Court — mold survey', status: 'lost', source: 'web', estimatedValue: 6400, lostReason: 'Went with the carrier preferred vendor', updatedAt: '2026-07-22T09:00:00Z' },
];

const ACCOUNTS: Array<Record<string, any>> = [
  { id: 'acc-1', name: 'Alliance Mutual Insurance', kind: 'insurance_carrier', email: 'claims@alliancemutual.com', phone: '(512) 555-0184', city: 'Austin', region: 'TX' },
  { id: 'acc-2', name: 'Camden Court HOA', kind: 'property_management', email: 'board@camdencourt.org', phone: '(512) 555-0139', city: 'Austin', region: 'TX' },
  { id: 'acc-3', name: 'Hollis Family', kind: 'other', email: 'j.hollis@example.com', phone: '(512) 555-0122', city: 'Round Rock', region: 'TX' },
  { id: 'acc-4', name: 'Brightway Dental', kind: 'property_management', email: 'office@brightwaydental.com', phone: '(512) 555-0166', city: 'Austin', region: 'TX' },
];

const CONTACTS: Array<Record<string, any>> = [
  { id: 'ct-1', firstName: 'Jordan', lastName: 'Hollis', companyName: null, email: 'j.hollis@example.com', phone: '(512) 555-0122', mobile: null },
  { id: 'ct-2', firstName: 'Rita', lastName: 'Calloway', companyName: 'Alliance Mutual', email: 'r.calloway@alliancemutual.com', phone: '(512) 555-0184', mobile: null },
  { id: 'ct-3', firstName: 'Sam', lastName: 'Okafor', companyName: 'Camden Court HOA', email: 'sam@camdencourt.org', phone: null, mobile: '(512) 555-0171' },
  // Deliberately the same person as sandbox sbx-5, so the walkthrough actually
  // demonstrates the rule rather than asserting it: search greys Devon out, and
  // a reveal called directly is refused instead of selling back data the org
  // already owns.
  { id: 'ct-4', firstName: 'Devon', lastName: 'Ashby', companyName: 'Camden Court HOA', email: 'devon@camdencourt.org', phone: '(512) 555-0139', mobile: null },
];

const ACTIVITIES: Array<Record<string, any>> = [
  { id: 'act-1', kind: 'call', body: 'Spoke with the property manager — adjuster walks it Thursday, wants our scope same day.', leadId: 'ld-2', occurredAt: '2026-07-31T14:40:00Z' },
  { id: 'act-2', kind: 'email', subject: 'Estimate attached — Westlake townhomes', body: 'Sent the six-unit estimate to the carrier desk; asked for confirmation of the program terms.', leadId: 'ld-1', occurredAt: '2026-08-01T09:10:00Z' },
  { id: 'act-3', kind: 'note', body: 'Homeowner prefers texts. Gate code 4417.', leadId: 'ld-3', occurredAt: '2026-08-01T11:05:00Z' },
];

/* ----------------------------------------------------------- prospecting */

/** The sandbox cast, mirroring backend/src/prospecting/sandbox.ts. */
const PEOPLE: Array<Record<string, any>> = [
  { providerPersonId: 'sbx-1', fullName: 'Marcia Delgado', title: 'Regional Property Manager', companyName: 'Vantage Residential', companyDomain: 'vantageresidential.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.94, hasEmail: true, hasPhone: true, email: 'm.delgado@vantageresidential.example', phone: '(512) 555-0110', mobile: '(512) 555-0111', industry: 'property management' },
  { providerPersonId: 'sbx-2', fullName: 'Ray Calloway', title: 'Senior Field Adjuster', companyName: 'Alliance Mutual', companyDomain: 'alliancemutual.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.88, hasEmail: true, hasPhone: false, email: 'r.calloway@alliancemutual.example', phone: null, mobile: null, industry: 'insurance' },
  { providerPersonId: 'sbx-3', fullName: 'Tomas Bergeron', title: 'Facilities Director', companyName: 'Northgate Medical Group', companyDomain: 'northgatemed.example', location: 'Round Rock, TX', linkedinUrl: null, confidence: 0.91, hasEmail: true, hasPhone: true, email: 't.bergeron@northgatemed.example', phone: '(512) 555-0148', mobile: null, industry: 'healthcare' },
  { providerPersonId: 'sbx-4', fullName: 'Priscilla Nunes', title: 'Owner', companyName: 'Nunes General Contracting', companyDomain: 'nunesgc.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.79, hasEmail: false, hasPhone: true, email: null, phone: '(512) 555-0173', mobile: '(512) 555-0174', industry: 'construction' },
  { providerPersonId: 'sbx-5', fullName: 'Devon Ashby', title: 'Director of Operations', companyName: 'Camden Court HOA', companyDomain: 'camdencourt.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.86, hasEmail: true, hasPhone: true, email: 'd.ashby@camdencourt.example', phone: '(512) 555-0139', mobile: null, industry: 'property management' },
  { providerPersonId: 'sbx-6', fullName: 'Karen Whitfield', title: 'Claims Team Lead', companyName: 'Lone Star Casualty', companyDomain: 'lonestarcasualty.example', location: 'San Antonio, TX', linkedinUrl: null, confidence: 0.83, hasEmail: true, hasPhone: true, email: 'k.whitfield@lonestarcasualty.example', phone: '(210) 555-0192', mobile: '(210) 555-0193', industry: 'insurance' },
  { providerPersonId: 'sbx-7', fullName: 'Andre Sokolov', title: 'Portfolio Manager', companyName: 'Hillcrest Commercial Realty', companyDomain: 'hillcrestcre.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.72, hasEmail: false, hasPhone: false, email: null, phone: null, mobile: null, industry: 'real estate' },
  { providerPersonId: 'sbx-8', fullName: 'Lena Ortiz-Park', title: 'Facilities Manager', companyName: 'Brightway Dental Partners', companyDomain: 'brightwaydental.example', location: 'Austin, TX', linkedinUrl: null, confidence: 0.9, hasEmail: true, hasPhone: true, email: 'l.ortizpark@brightwaydental.example', phone: '(512) 555-0166', mobile: null, industry: 'healthcare' },
  { providerPersonId: 'sbx-9', fullName: 'Grant Feasley', title: 'VP Construction', companyName: 'Sundial Property Group', companyDomain: 'sundialpg.example', location: 'Dallas, TX', linkedinUrl: null, confidence: 0.81, hasEmail: true, hasPhone: false, email: 'g.feasley@sundialpg.example', phone: null, mobile: null, industry: 'property management' },
  { providerPersonId: 'sbx-10', fullName: 'Nadia Brennan', title: 'Independent Adjuster', companyName: 'Brennan Claims Services', companyDomain: 'brennanclaims.example', location: 'Round Rock, TX', linkedinUrl: null, confidence: 0.77, hasEmail: true, hasPhone: true, email: 'nadia@brennanclaims.example', phone: '(512) 555-0155', mobile: '(512) 555-0156', industry: 'insurance' },
];

const PROSPECTS: Array<Record<string, any>> = [];
const SUPPRESSIONS: Array<Record<string, any>> = [
  { id: 'sup-1', kind: 'domain', value: 'sundialpg.example', reason: 'Asked us to stop contacting their staff' },
];
const REVEAL_PRICE_NANOS = 250_000_000;
/** Charges already made, so a retried reveal bills once — as the RPC does. */
const CHARGED = new Set<string>();

/** Contribution state for the shared network. Off until somebody decides. */
const NETWORK = { contributing: false, decidedAt: null as string | null, shared: 0 };

/** Territories a restoration company in Central Texas would actually run. */
const TERRITORIES: Array<Record<string, any>> = [
  {
    id: 'terr-1', name: 'North Austin', description: 'Multifamily and HOA focus',
    ownerId: 'u-1', postalCodes: ['78727', '78729', '78750'], cities: ['Cedar Park', 'Round Rock'],
    counties: ['Williamson County'], active: true, createdAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'terr-2', name: 'Central Austin', description: 'Commercial and healthcare',
    ownerId: null, postalCodes: ['78701', '78702', '78703'], cities: ['Austin'],
    counties: [], active: true, createdAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'terr-3', name: 'San Antonio', description: null,
    ownerId: null, postalCodes: [], cities: ['San Antonio'], counties: ['Bexar County'],
    active: true, createdAt: '2026-07-14T00:00:00Z',
  },
];

const CAMPAIGNS: Array<Record<string, any>> = [
  {
    id: 'camp-1', name: 'Q3 property managers — North Austin',
    goal: 'Get on the approved vendor list before storm season',
    channel: 'email', status: 'active', territoryId: 'terr-1', ownerId: 'u-1',
    startsOn: '2026-07-01', endsOn: null, createdAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'camp-3', name: 'Hail watch — North Austin schools',
    goal: 'Be the call they already have when hail hits',
    channel: 'email', status: 'active', territoryId: 'terr-1', ownerId: 'u-1',
    startsOn: null, endsOn: null, createdAt: '2026-07-20T00:00:00Z',
    triggerKind: 'weather',
    triggerConfig: { groups: ['hail', 'wind'], leadTimeHours: 48, cooldownDays: 14 },
    audienceConfig: { placeCategories: ['school', 'hospital', 'senior_living'], includeContacts: true, territoryId: 'terr-1', titleKeywords: ['facilities', 'operations', 'property'] },
    messageSubject: 'Checking in ahead of the weather',
    messageBody: 'Hi {{first_name}}, ...',
  },
  {
    id: 'camp-2', name: 'Adjuster reintroductions',
    goal: 'Re-engage the desk adjusters we worked with last year',
    channel: 'mixed', status: 'paused', territoryId: null, ownerId: 'u-1',
    startsOn: '2026-05-12', endsOn: null, createdAt: '2026-05-12T00:00:00Z',
  },
];

const CAMPAIGN_MEMBERS: Record<string, Array<Record<string, any>>> = {
  'camp-3': [],
  'camp-1': [
    { id: 'cm-1', campaignId: 'camp-1', contactId: 'ct-2', prospectId: null, status: 'replied', lastTouchAt: '2026-07-28T15:00:00Z', touches: 3, note: null, personName: 'Rita Calloway', personEmail: 'r.calloway@alliancemutual.com', personCompany: 'Alliance Mutual' },
    { id: 'cm-2', campaignId: 'camp-1', contactId: 'ct-3', prospectId: null, status: 'opened', lastTouchAt: '2026-07-30T09:20:00Z', touches: 2, note: null, personName: 'Sam Okafor', personEmail: 'sam@camdencourt.org', personCompany: 'Camden Court HOA' },
    { id: 'cm-3', campaignId: 'camp-1', contactId: 'ct-4', prospectId: null, status: 'sent', lastTouchAt: '2026-07-30T09:20:00Z', touches: 1, note: null, personName: 'Devon Ashby', personEmail: 'devon@camdencourt.org', personCompany: 'Camden Court HOA' },
    { id: 'cm-4', campaignId: 'camp-1', contactId: 'ct-1', prospectId: null, status: 'pending', lastTouchAt: null, touches: 0, note: null, personName: 'Jordan Hollis', personEmail: 'j.hollis@example.com', personCompany: null },
  ],
  'camp-2': [
    { id: 'cm-5', campaignId: 'camp-2', contactId: 'ct-2', prospectId: null, status: 'bounced', lastTouchAt: '2026-05-20T11:00:00Z', touches: 1, note: null, personName: 'Rita Calloway', personEmail: 'r.calloway@alliancemutual.com', personCompany: 'Alliance Mutual' },
  ],
};

/** The activities handler needs the query it was called with. */
const LAST_QUERY: { leadId?: string } = {};

const COMPUTER_STATUS: ComputerStatus = {
  enabled: true,
  credential: { connected: true, source: 'organization', hint: 'sk-…-4KQ2', updatedAt: '2026-07-12T10:00:00Z' },
  agents: [
    { id: 'ag-1', name: 'FRONT-DESK-PC', platform: 'windows', version: '1.4.2', screen: { width: 1920, height: 1080 }, capture: { width: 1280, height: 720, scale: 0.67 }, capabilities: ['screen', 'keyboard', 'pointer'], connectedAt: '2026-08-01T08:02:00Z', busy: false },
  ],
  models: [{ id: 'atmosphere-core', label: 'Atmosphere' }],
  defaults: { model: 'atmosphere-core', quality: 'balanced' },
  limits: { maxSteps: 60, runTimeoutMs: 600000 },
};

const TECH_CAPABILITIES: TechnicianCapabilities = {
  assistant: true, transcription: true, maxAudioUploadBytes: 26_214_400,
};

const XACTIMATE_STATUS: XactimateStatus = {
  connected: false, sessionActive: false, driver: 'mock', storageAvailable: true,
  webAutomationEnabled: false, username: null, scopes: [], storageMode: 'session',
  grantedAt: null, expiresAt: null, priceListId: null, availableScopes: [],
};

/* ------------------------------------------------------------ interceptor */

type Handler = (match: RegExpMatchArray, body: Record<string, unknown>) => { status?: number; body: unknown };

const routes: Array<[string, RegExp, Handler]> = [
  ['POST', /^\/api\/auth\/login$/, (_m, b) => {
    state.signedIn = true; state.onboarded = true;
    if (typeof b.email === 'string') state.email = b.email;
    return { body: { user: user() } };
  }],
  ['POST', /^\/api\/auth\/signup$/, (_m, b) => {
    state.signedIn = true; state.onboarded = false; state.fullName = null;
    if (typeof b.email === 'string') state.email = b.email;
    return { body: { user: user(), needsEmailConfirmation: false } };
  }],
  ['POST', /^\/api\/auth\/logout$/, () => { state.signedIn = false; return { body: { ok: true } }; }],
  ['GET', /^\/api\/auth\/me$/, () =>
    state.signedIn ? { body: { user: user() } } : { status: 401, body: { error: 'Not signed in', code: 'unauthenticated' } }],
  ['GET', /^\/api\/auth\/pin\/status$/, () => ({ body: { enrolled: false } })],
  ['POST', /^\/api\/auth\/pin\/enroll$/, () => ({ body: { ok: true } })],
  ['GET', /^\/api\/profile$/, () => ({ body: { profile: profile() } })],
  ['PATCH', /^\/api\/profile$/, (_m, b) => {
    state.fullName = (b.fullName as string | null) ?? null;
    return { body: { profile: profile() } };
  }],

  ['GET', /^\/api\/org\/me$/, () => ({ body: { membership: state.onboarded ? membership() : null } })],
  ['PATCH', /^\/api\/org\/me$/, () => ({ body: { membership: membership() } })],
  ['POST', /^\/api\/org\/join$/, (_m, b) => {
    const code = String(b.joinCode ?? '').toUpperCase();
    if (code !== state.joinCode) {
      return { status: 400, body: { error: 'That join code did not match any organization.', code: 'join_org_failed' } };
    }
    state.onboarded = true;
    return { body: { org: membership().org } };
  }],
  ['POST', /^\/api\/org$/, (_m, b) => {
    if (typeof b.name === 'string' && b.name.trim()) state.orgName = b.name.trim();
    state.onboarded = true;
    return { status: 201, body: { org: membership().org } };
  }],
  ['PATCH', /^\/api\/org$/, () => ({ body: { org: membership().org } })],
  ['GET', /^\/api\/org\/members$/, () => ({ body: { members: MEMBERS } })],

  ['GET', /^\/api\/audit\/agents$/, () => ({ body: { agents: AUDIT_AGENTS } })],
  ['GET', /^\/api\/audit\/stats$/, () => ({ body: { stats: AUDIT_STATS } })],
  ['GET', /^\/api\/audit\/runs\/([\w-]+)$/, (m) => ({
    body: { run: AUDIT_RUNS.find((r) => r.id === m[1]) ?? AUDIT_RUNS[0], steps: RUN_DETAIL_STEPS, moreSteps: false },
  })],
  ['GET', /^\/api\/audit\/runs$/, () => ({ body: { runs: AUDIT_RUNS, nextCursor: null } })],

  ['GET', /^\/api\/jobs\/([\w-]+)\/memory$/, (m) => ({ body: { events: EVENTS.filter((e) => e.jobId === m[1]) } })],
  ['GET', /^\/api\/jobs\/([\w-]+)$/, (m) =>
    m[1] === 'job-1041'
      ? { body: JOB_DETAIL }
      : { status: 404, body: { error: 'Only job #1041 carries full detail in the demo — open Meridian Ave.', code: 'not_found' } }],
  ['GET', /^\/api\/jobs$/, () => ({ body: { jobs: JOBS } })],

  ['GET', /^\/api\/memory\/stats$/, () => ({ body: MEMORY_STATS })],
  ['GET', /^\/api\/memory\/agents\/([\w-]+)$/, (m) => ({
    body: {
      agent: AGENT_MEMORY.find((a) => a.userId === m[1]) ?? AGENT_MEMORY[0],
      openTasks: [], events: EVENTS, nextCursor: null,
    },
  })],
  ['GET', /^\/api\/memory\/agents$/, () => ({ body: { agents: AGENT_MEMORY } })],
  ['GET', /^\/api\/memory$/, () => ({ body: { events: EVENTS, nextCursor: null } })],

  ['GET', /^\/api\/billing\/catalog$/, () => ({ body: CATALOG })],
  ['GET', /^\/api\/billing\/overview$/, () => ({ body: OVERVIEW() })],
  ['GET', /^\/api\/billing\/ledger$/, () => ({ body: { entries: LEDGER } })],
  ['GET', /^\/api\/billing\/purchases$/, () => ({ body: { purchases: PURCHASES } })],
  ['GET', /^\/api\/billing\/payments$/, () => ({ body: { payments: PAYMENTS } })],
  ['PATCH', /^\/api\/billing\/settings$/, (_m, b) => {
    state.settings = { ...state.settings, ...(b as Partial<BillingSettings>) };
    return { body: { settings: state.settings } };
  }],

  ['GET', /^\/api\/usage\/events$/, () => ({ body: { events: USAGE_EVENTS } })],
  ['GET', /^\/api\/usage\/daily$/, () => ({ body: { days: USAGE_DAYS } })],

  ['GET', /^\/api\/pm\/overview$/, () => ({ body: PM_OVERVIEW })],
  ['GET', /^\/api\/pm\/settings$/, () => ({ body: PM_SETTINGS_RESPONSE })],

  ['GET', /^\/api\/technician\/capabilities$/, () => ({ body: TECH_CAPABILITIES })],

  ['GET', /^\/api\/web-access\/connections$/, () => ({ body: { connections: WEB_CONNECTIONS } })],
  ['GET', /^\/api\/web-access\/runs$/, () => ({ body: { runs: WEB_RUNS } })],
  ['GET', /^\/api\/web-access\/capabilities$/, () => ({ body: { enabled: true, capacityAvailable: true, maxSteps: 40 } })],
  ['GET', /^\/api\/verifier\/verifications$/, () => ({ body: { verifications: VERIFICATIONS } })],
  ['GET', /^\/api\/verifier\/escalations$/, () => ({ body: { escalations: ESCALATIONS } })],
  ['POST', /^\/api\/verifier\/escalations\/([\w-]+)\/resolve$/, (m, b) => {
    const esc = ESCALATIONS.find((e) => e.id === m[1]);
    if (esc) {
      esc.status = 'resolved';
      esc.chosenOption = typeof b.optionId === 'string' ? b.optionId : null;
      esc.resolvedAt = '2026-08-01T13:00:00Z';
    }
    return { body: { status: 'resolved', verificationId: esc?.verificationId ?? 'v-2' } };
  }],
  ['POST', /^\/api\/technician\/assist$/, (_m, b) => {
    const q = typeof b.message === 'string' ? b.message : '';
    return {
      body: {
        reply:
          'Here is where that stands: WTR-1041 (Meridian Ave) is day 8 of drying with one stalled area — ' +
          'adding an LGR dehumidifier is the fastest path to dry standard. The $1,840 of performed-but-unbilled ' +
          'work the estimator found is already in the draft supplement. Ask me about a job, a balance, or a ' +
          'schedule and I will pull it from the record.' +
          (q ? `\n\n(You asked: "${q}" — in the live product this answer comes from your own org data.)` : ''),
        model: 'atmosphere-core',
      },
    };
  }],

  // The walkthrough shows the un-configured state, because that is what a new
  // deployment actually looks like and this screen's whole job is to say so.
  // Testing changes nothing here: an integration with no credentials has
  // nothing to test, which is exactly what the real endpoint reports too.
  ['GET', /^\/api\/prospecting\/integrations/, () => ({
    body: {
      mode: 'sandbox',
      sellUnverified: false,
      items: [
        { id: 'people_data_labs', name: 'People Data Labs', kind: 'source', configured: false, reachable: null, detail: null, costNanos: 20_000_000 },
        { id: 'hunter', name: 'Hunter', kind: 'source', configured: false, reachable: null, detail: null, costNanos: 10_000_000 },
        { id: 'zerobounce', name: 'ZeroBounce', kind: 'verifier', configured: false, reachable: null, detail: null, costNanos: 0 },
        { id: 'neverbounce', name: 'NeverBounce', kind: 'verifier', configured: false, reachable: null, detail: null, costNanos: 0 },
        { id: 'smtp', name: 'SMTP', kind: 'verifier', configured: false, reachable: null, detail: null, costNanos: 0 },
      ],
    },
  })],
  ['GET', /^\/api\/integrations\/crm$/, () => ({
    // Unconnected, and honest about why each button is or is not available —
    // which is the state a new deployment is genuinely in.
    body: {
      available: [
        { id: 'salesforce', name: 'Salesforce', method: 'oauth', note: 'Authorise in Salesforce. We never see your password, MFA keeps working, and you can revoke us from your own admin screen.' },
        { id: 'luxor', name: 'Luxor CRM', method: 'browser', note: 'No public API we can use, so this signs in the way you do. Your password is encrypted and only ever sent to Luxor.' },
        { id: 'dash', name: 'Dash', method: 'browser', note: 'Signs in through the browser and reads the pages you would read.' },
        { id: 'custom_rest', name: 'Anything with an API', method: 'rest', note: 'If your CRM publishes a REST API, point us at it — no browser, no stored password.' },
      ],
      connected: [],
      salesforceConfigured: false,
      browserCrmEnabled: false,
      vaultConfigured: false,
    },
  })],

  ['POST', /^\/api\/prospecting\/profile$/, (_m, b) => {
    const name = String(b.fullName ?? '');
    const domain = String(b.companyDomain ?? '').toLowerCase();
    const site = `https://${domain}`;
    return {
      body: {
        fullName: name,
        companyDomain: domain,
        companySummary:
          'Northgate Medical Group operates eleven outpatient clinics across Central Texas, with an in-house facilities team responsible for maintenance, compliance and emergency response.',
        companySummarySource: `${site}/about`,
        facts: [
          { label: 'Title', value: 'Facilities Director', sourceUrl: `${site}/team`, sourceKind: 'company_site' },
          { label: 'With the company since', value: '2021', sourceUrl: `${site}/team`, sourceKind: 'company_site' },
          {
            label: 'From their bio',
            value: `${name} oversees maintenance and capital projects across all eleven Northgate locations, with a focus on minimising disruption to patient care.`,
            sourceUrl: `${site}/team`,
            sourceKind: 'company_site',
          },
        ],
        signals: [
          { headline: 'Northgate announced the opening of its third Round Rock clinic in March.', sourceUrl: `${site}/news` },
          { headline: 'The group completed a facilities-wide HVAC replacement programme last quarter.', sourceUrl: `${site}/news` },
        ],
        talkingPoints: [
          'They run facilities — response time and minimising disruption to tenants will matter more to them than headline price.',
          '5 years in the role — they will have existing vendors, so lead with what those vendors are not doing.',
          'Recent company news to open with: "Northgate announced the opening of its third Round Rock clinic in March."',
        ],
        sourcesChecked: [
          { url: `${site}/about`, ok: true, ms: 340 },
          { url: `${site}/team`, ok: true, ms: 291 },
          { url: `${site}/leadership`, ok: false, ms: 122 },
          { url: `${site}/news`, ok: true, ms: 402 },
          { url: `${site}/careers`, ok: false, ms: 8, skipped: 'robots.txt' },
        ],
        withheld: [],
        excluded: [
          'Home address', 'Family and relationships', 'Age and date of birth', 'Health',
          'Religion', 'Politics', 'Personal finances', 'Personal social media',
        ],
      },
    };
  }],

  /* ------------------------------------------- sending */
  ['GET', /^\/api\/sales\/mail$/, () => ({
    body: {
      providers: [
        { id: 'google_mail', name: 'Gmail / Google Workspace', available: false, note: 'Sends from your own address, lands in your Sent folder, and replies come straight back to you. We ask only for permission to send — never to read your mail.' },
        { id: 'microsoft_mail', name: 'Microsoft 365 / Outlook', available: false, note: 'Same arrangement. Some organizations require an administrator to approve it rather than you.' },
      ],
      connected: [],
      policy: null,
      sentToday: 0,
      vaultConfigured: false,
    },
  })],
  ['PUT', /^\/api\/sales\/send-policy$/, (_m, b) => ({
    body: { policy: { postalAddress: b.postalAddress ?? null, replyTo: null, maxRecipients: b.maxRecipients ?? 200, dailyCeiling: 300 } },
  })],
  ['POST', /^\/api\/sales\/campaigns\/([^/]+)\/send$/, (_m, b) => {
    // The walkthrough shows a dry run, which is the default and the point:
    // nothing sends until somebody has seen who it would reach.
    if (b.confirm) {
      return { status: 400, body: { error: 'Connect a mailbox before sending.', code: 'no_mailbox' } };
    }
    return {
      body: {
        dryRun: true,
        wouldSend: 4,
        from: null,
        blocked: [
          { email: 'info@camdencourt.org', reason: 'role_address' },
          { email: 'sam@gmail.com', reason: 'personal_address' },
          { email: 'r.calloway@alliancemutual.com', reason: 'unsubscribed' },
        ],
        warnings: ['A postal address is required in every commercial email. Add yours in Settings.'],
        sample: 'Hi Tomas,\n\nHope things are good at Northgate Medical Group. We\u2019re watching hail for Williamson County over the next couple of days and wanted to check in before it arrives.\n\nIf anything does come up \u2014 water, roof, anything \u2014 we can have someone out same day. No obligation either way; just wanted you to have a number that answers.\n\n\u2014 Dana',
      },
    };
  }],
  ['GET', /^\/api\/sales\/forecast-providers$/, () => ({
    body: {
      active: 'National Weather Service',
      providers: [
        { id: 'nws', name: 'National Weather Service', cost: 'Free', available: true, note: 'US only. Government-authoritative, and the source the commercial services start from.' },
        { id: 'openweather', name: 'OpenWeather', cost: 'From ~$0 / 1,000 calls', available: false, note: 'Global, self-serve in minutes. Less severe-weather detail.' },
        { id: 'weatherchannel', name: 'The Weather Channel (IBM)', cost: 'Enterprise contract', available: false, note: 'Not self-serve. Sold through IBM Environmental Intelligence Suite and priced by contract.' },
      ],
    },
  })],

  /* ------------------------------------------- places & weather */
  ['GET', /^\/api\/sales\/place-categories$/, () => ({
    body: {
      attribution: '© OpenStreetMap contributors (ODbL)',
      categories: [
        { id: 'school', label: 'Schools', blurb: 'K-12, public and private' },
        { id: 'university', label: 'Colleges & universities', blurb: 'Campuses and community colleges' },
        { id: 'hospital', label: 'Hospitals', blurb: 'Full hospitals with inpatient care' },
        { id: 'clinic', label: 'Clinics & medical offices', blurb: 'Urgent care, doctors, dentists' },
        { id: 'senior_living', label: 'Senior living', blurb: 'Nursing homes and assisted living' },
        { id: 'hotel', label: 'Hotels', blurb: 'Hotels and motels' },
        { id: 'church', label: 'Churches & places of worship', blurb: 'Often self-managed' },
        { id: 'government', label: 'Government buildings', blurb: 'City, county and public offices' },
        { id: 'retail', label: 'Retail & shopping centres', blurb: 'Malls, supermarkets, big box' },
        { id: 'office', label: 'Office buildings', blurb: 'Commercial multi-tenant' },
      ],
    },
  })],
  ['POST', /^\/api\/sales\/places\/search$/, (_m, b) => {
    const cats = Array.isArray(b.categories) ? (b.categories as string[]) : [];
    const pool = [
      { externalId: 'way/1', category: 'school', name: 'Round Rock High School', street: '300 N Lake Creek Dr', city: 'Round Rock', state: 'TX', postalCode: '78681', lat: 30.52, lon: -97.68, phone: '(512) 555-0301', website: null },
      { externalId: 'way/2', category: 'school', name: 'Stony Point High School', street: '1801 Tiger Trail', city: 'Round Rock', state: 'TX', postalCode: '78664', lat: 30.49, lon: -97.65, phone: null, website: null },
      { externalId: 'way/3', category: 'school', name: 'Cedar Ridge High School', street: '2801 Gattis School Rd', city: 'Round Rock', state: 'TX', postalCode: '78664', lat: 30.48, lon: -97.63, phone: '(512) 555-0344', website: null },
      { externalId: 'way/4', category: 'hospital', name: 'Baylor Scott & White Medical Center', street: '300 University Blvd', city: 'Round Rock', state: 'TX', postalCode: '78665', lat: 30.55, lon: -97.67, phone: '(512) 555-0400', website: null },
      { externalId: 'way/5', category: 'hospital', name: 'St. David\u2019s Round Rock Medical Center', street: '2400 Round Rock Ave', city: 'Round Rock', state: 'TX', postalCode: '78681', lat: 30.51, lon: -97.71, phone: null, website: null },
      { externalId: 'node/6', category: 'clinic', name: 'Lone Star Urgent Care', street: '1615 Gattis School Rd', city: 'Round Rock', state: 'TX', postalCode: '78664', lat: 30.49, lon: -97.66, phone: '(512) 555-0455', website: null },
      { externalId: 'node/7', category: 'clinic', name: 'Brightway Dental Partners', street: '211 University Blvd', city: 'Round Rock', state: 'TX', postalCode: '78665', lat: 30.54, lon: -97.68, phone: null, website: null },
      { externalId: 'way/8', category: 'senior_living', name: 'Oakwood Assisted Living', street: '900 Sam Bass Rd', city: 'Round Rock', state: 'TX', postalCode: '78681', lat: 30.53, lon: -97.72, phone: '(512) 555-0512', website: null },
    ];
    const places = pool.filter((p) => cats.includes(p.category));
    return {
      body: {
        places,
        box: { displayName: 'Round Rock, Williamson County, Texas, United States' },
        note: places.length ? null : 'No places of that kind are mapped in that area.',
        attribution: '© OpenStreetMap contributors (ODbL)',
      },
    };
  }],
  ['POST', /^\/api\/sales\/places\/import$/, (_m, b) => ({
    status: 201,
    body: { imported: Array.isArray(b.places) ? b.places.length : 0 },
  })],
  ['GET', /^\/api\/sales\/weather\/events$/, () => ({
    body: {
      attribution: 'Alerts from the US National Weather Service',
      groups: [
        { id: 'hail', label: 'Hail', blurb: 'Roof and siding work. The biggest single driver in Texas.', events: [] },
        { id: 'wind', label: 'High wind', blurb: 'Roof damage, downed trees, envelope failures.', events: [] },
        { id: 'tornado', label: 'Tornado', blurb: 'Structural. Minutes of notice, not days.', events: [] },
        { id: 'flood', label: 'Flooding', blurb: 'Water mitigation — the fastest work to mobilise on.', events: [] },
        { id: 'winter', label: 'Freeze & winter storm', blurb: 'Burst pipes.', events: [] },
        { id: 'hurricane', label: 'Hurricane & tropical', blurb: 'Days of notice, largest events.', events: [] },
      ],
    },
  })],
  ['GET', /^\/api\/sales\/weather\/active/, () => ({
    body: {
      attribution: 'Alerts from the US National Weather Service',
      alerts: [
        {
          id: 'urn:oid:2.49.0.1.840.0.demo1',
          event: 'Severe Thunderstorm Watch', severity: 'Severe', urgency: 'Future',
          headline: 'Severe Thunderstorm Watch until 10 PM CDT',
          areaDesc: 'Williamson; Travis',
          effective: null, onset: null, expires: null, group: 'hail',
          hoursOfNotice: 31,
          territories: [{ id: 'terr-1', name: 'North Austin' }],
        },
        {
          id: 'urn:oid:2.49.0.1.840.0.demo2',
          event: 'Flood Watch', severity: 'Moderate', urgency: 'Expected',
          headline: null, areaDesc: 'Bexar',
          effective: null, onset: null, expires: null, group: 'flood',
          hoursOfNotice: 14, territories: [],
        },
      ],
    },
  })],
  ['GET', /^\/api\/sales\/campaigns\/pending/, () => ({
    body: {
      alertsSeen: 2,
      fire: [
        {
          campaignId: 'camp-3',
          campaignName: 'Hail watch — North Austin schools',
          reason: 'Severe Thunderstorm Watch for Williamson; Travis, about 31h out.',
        },
      ],
      skip: [
        { campaignId: 'camp-1', campaignName: 'Q3 property managers — North Austin', reason: 'Campaign is active but not weather-triggered.' },
        { campaignId: 'camp-2', campaignName: 'Adjuster reintroductions', reason: 'Campaign is paused.' },
      ],
    },
  })],
  ['GET', /^\/api\/sales\/campaigns\/([^/]+)\/audience$/, (m) => {
    const id = String(m).split('/campaigns/')[1]?.split('/')[0] ?? '';
    if (id !== 'camp-3') return { body: { members: [], total: 0, contacts: 0, places: 0 } };
    const members = [
      { kind: 'contact', id: 'ct-4', name: 'Devon Ashby', email: 'devon@camdencourt.org', company: 'Camden Court HOA', title: 'Director of Operations', why: 'Director of Operations in your CRM' },
      { kind: 'place', id: 'pl-1', name: 'Round Rock High School', email: null, company: 'Round Rock High School', title: null, why: 'school in this area — no contact yet' },
      { kind: 'place', id: 'pl-2', name: 'Stony Point High School', email: null, company: 'Stony Point High School', title: null, why: 'school in this area — no contact yet' },
      { kind: 'place', id: 'pl-3', name: 'Cedar Ridge High School', email: null, company: 'Cedar Ridge High School', title: null, why: 'school in this area — no contact yet' },
      { kind: 'place', id: 'pl-4', name: 'Baylor Scott & White Medical Center', email: null, company: 'Baylor Scott & White Medical Center', title: null, why: 'hospital in this area — no contact yet' },
      { kind: 'place', id: 'pl-5', name: 'Oakwood Assisted Living', email: null, company: 'Oakwood Assisted Living', title: null, why: 'senior living in this area — no contact yet' },
    ];
    return { body: { members, total: members.length, contacts: 1, places: 5 } };
  }],

  /* ------------------------------------------- campaigns & territories */
  ['GET', /^\/api\/sales\/territories$/, () => ({ body: { items: TERRITORIES } })],
  ['POST', /^\/api\/sales\/territories$/, (_m, b) => {
    const item = {
      id: `terr-${TERRITORIES.length + 1}`,
      name: String(b.name ?? 'Untitled'),
      description: b.description ?? null,
      ownerId: null,
      postalCodes: b.postalCodes ?? [],
      cities: b.cities ?? [],
      counties: b.counties ?? [],
      active: true,
      createdAt: '2026-08-03T00:00:00Z',
    };
    TERRITORIES.push(item);
    return { status: 201, body: { item } };
  }],
  ['GET', /^\/api\/sales\/campaigns$/, () => ({
    body: {
      items: CAMPAIGNS.map((c) => ({
        ...c,
        counts: (CAMPAIGN_MEMBERS[c.id] ?? []).reduce(
          (acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1, total: (acc.total ?? 0) + 1 }),
          {} as Record<string, number>,
        ),
      })),
    },
  })],
  ['POST', /^\/api\/sales\/campaigns$/, (_m, b) => {
    const item = {
      id: `camp-${CAMPAIGNS.length + 1}`,
      name: String(b.name ?? 'Untitled'),
      goal: b.goal ?? null,
      channel: b.channel ?? 'email',
      status: 'draft',
      territoryId: b.territoryId ?? null,
      ownerId: null,
      startsOn: null,
      endsOn: null,
      createdAt: '2026-08-03T00:00:00Z',
    };
    CAMPAIGNS.unshift(item);
    CAMPAIGN_MEMBERS[item.id] = [];
    return { status: 201, body: { item: { ...item, counts: { total: 0 } } } };
  }],
  ['GET', /^\/api\/sales\/campaigns\/([^/]+)\/members$/, (m) => {
    const id = String(m).split('/campaigns/')[1]?.split('/')[0] ?? '';
    return { body: { items: CAMPAIGN_MEMBERS[id] ?? [] } };
  }],
  ['PATCH', /^\/api\/sales\/campaigns\/([^/]+)\/members\/([^/]+)$/, (m, b) => {
    const parts = String(m).split('/');
    const campaignId = parts[parts.indexOf('campaigns') + 1];
    const memberId = parts[parts.length - 1];
    const member = (CAMPAIGN_MEMBERS[campaignId] ?? []).find((x) => x.id === memberId);
    if (member) member.status = String(b.status ?? member.status);
    return { body: { item: member ?? null } };
  }],

  ['POST', /^\/api\/prospecting\/diagnose$/, (_m, b) => {
    // The walkthrough's honest answer: sources are enabled and find nothing
    // at an unknown domain, so inference has nothing to build from. That is
    // the state a new deployment is genuinely in, and the summary says which
    // stage was empty rather than just reporting no result.
    const name = String(b.fullName ?? '');
    const domain = String(b.companyDomain ?? '').toLowerCase();
    return {
      body: {
        fullName: name,
        companyDomain: domain,
        nameUsable: name.trim().split(/\s+/).length >= 2,
        stages: [
          { name: 'Company website', evidenceFound: 0, directHit: false, ms: 412 },
          { name: 'Common Crawl', evidenceFound: 0, directHit: false, ms: 688 },
        ],
        evidenceTotal: 0,
        inferredPattern: null,
        patternSupport: 0,
        patternConfidence: null,
        candidates: [],
        wouldReturn: null,
        wouldReturnSource: null,
        mailboxVerifier: null,
        phoneVerifier: null,
        sellUnverified: false,
        summary: `No addresses are known at ${domain}, from your CRM or any source. Inference will not guess at a domain with no evidence, so there is nothing to build a candidate from. Connect a source, or add one contact at this company.`,
      },
    };
  }],
  ['GET', /^\/api\/prospecting\/network$/, () => ({
    // Off, like every real org before somebody decides otherwise.
    body: { contributing: NETWORK.contributing, decidedAt: NETWORK.decidedAt, enabled: true },
  })],
  ['PUT', /^\/api\/prospecting\/network$/, (_m, b) => {
    const next = Boolean(b.contributing);
    const withdrawn = !next && NETWORK.contributing ? NETWORK.shared : 0;
    NETWORK.contributing = next;
    NETWORK.decidedAt = '2026-08-03T00:00:00Z';
    if (!next) NETWORK.shared = 0;
    return { body: { contributing: next, withdrawn } };
  }],
  ['POST', /^\/api\/prospecting\/network\/contribute$/, () => {
    // Only business addresses count, which is why the number shared is lower
    // than the number considered — sam@camdencourt.org is fine, a gmail is not.
    const eligible = CONTACTS.filter((c) => c.email && !/gmail|yahoo|outlook/.test(String(c.email)));
    NETWORK.shared = eligible.length;
    return { body: { contributed: eligible.length, considered: CONTACTS.length } };
  }],
  ['GET', /^\/api\/prospecting\/status$/, () => ({
    body: {
      provider: 'Sandbox',
      sandbox: true,
      revealPriceNanos: REVEAL_PRICE_NANOS,
      verifier: null,
      sellUnverified: false,
      sources: ['Sandbox'],
    },
  })],
  ['POST', /^\/api\/prospecting\/search$/, (_m, b) => {
    const q = String(b.q ?? '').toLowerCase();
    const loc = String(b.location ?? '').toLowerCase();
    const titles = Array.isArray(b.titles) ? (b.titles as string[]).map((s) => s.toLowerCase()) : [];
    const suppressedDomains = new Set(
      SUPPRESSIONS.filter((s) => s.kind === 'domain').map((s) => String(s.value).toLowerCase()),
    );
    const hits = PEOPLE.filter((p) => {
      const hay = [p.fullName, p.title, p.companyName, p.industry].join(' ').toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (loc && !String(p.location ?? '').toLowerCase().includes(loc)) return false;
      if (titles.length && !titles.some((t) => String(p.title ?? '').toLowerCase().includes(t))) return false;
      return true;
    });
    const knownNames = new Set(
      CONTACTS.map((c) => [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase()),
    );
    const matches = hits.slice(0, Number(b.limit ?? 25)).map((p) => {
      const saved = PROSPECTS.find((s) => s.providerPersonId === p.providerPersonId) ?? null;
      return {
        providerPersonId: p.providerPersonId, fullName: p.fullName, title: p.title,
        companyName: p.companyName, companyDomain: p.companyDomain, location: p.location,
        linkedinUrl: p.linkedinUrl, confidence: p.confidence,
        hasEmail: p.hasEmail, hasPhone: p.hasPhone,
        knownContactId: knownNames.has(String(p.fullName).toLowerCase()) ? 'ct-known' : null,
        prospectId: saved?.id ?? null,
        revealed: Boolean(saved?.revealedAt),
        suppressed: suppressedDomains.has(String(p.companyDomain ?? '').toLowerCase()),
      };
    });
    return {
      body: { matches, total: hits.length, provider: 'Sandbox', sandbox: true, revealPriceNanos: REVEAL_PRICE_NANOS },
    };
  }],
  ['POST', /^\/api\/prospecting\/reveal$/, (_m, b) => {
    const id = String(b.providerPersonId ?? '');
    const person = PEOPLE.find((p) => p.providerPersonId === id);
    if (!person) {
      return { status: 404, body: { error: 'No such person.', code: 'not_found' } };
    }
    const existing = PROSPECTS.find((p) => p.providerPersonId === id);
    if (existing?.revealedAt) {
      return { body: { prospect: existing, charged: false, reason: 'already_revealed' } };
    }
    // Domain, email, landline AND mobile. The mobile was missing on the server
    // and it is the number the UI shows first, so a suppressed person could
    // still be called.
    const suppressedOf = (kind: string) =>
      new Set(
        SUPPRESSIONS.filter((s) => s.kind === kind).map((s) => String(s.value).toLowerCase()),
      );
    const digitsOnly = (v: string) => v.replace(/\D/g, '');
    const suppressedPhones = new Set([...suppressedOf('phone')].map(digitsOnly));
    const suppressed =
      suppressedOf('domain').has(String(person.companyDomain ?? '').toLowerCase()) ||
      suppressedOf('email').has(String(person.email ?? '').toLowerCase()) ||
      [person.phone, person.mobile].some(
        (n) => n && suppressedPhones.has(digitsOnly(String(n))),
      );
    if (suppressed) {
      return {
        status: 409,
        body: {
          error: 'That contact is on your do-not-contact list — nothing was charged.',
          code: 'suppressed',
        },
      };
    }
    if (!person.email && !person.phone && !person.mobile) {
      return {
        status: 404,
        body: {
          error: 'The provider holds no contact details for that person — nothing was charged.',
          code: 'no_contact_data',
        },
      };
    }
    // Already in the CRM — revealing would sell them back their own data.
    // The server enforces this on name AND employer; so does the demo, or the
    // walkthrough would show a charge the real product refuses to make.
    const wanted = String(person.fullName).trim().toLowerCase();
    const owned = CONTACTS.find((c) => {
      const full = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
      if (full !== wanted) return false;
      if (!c.email && !c.phone && !c.mobile) return false;
      const emailDomain = c.email ? String(c.email).toLowerCase().split('@')[1] ?? '' : '';
      return (
        emailDomain === String(person.companyDomain ?? '').toLowerCase() ||
        String(c.companyName ?? '').trim().toLowerCase() ===
          String(person.companyName ?? '').trim().toLowerCase()
      );
    });
    if (owned) {
      return {
        status: 409,
        body: {
          error: `${person.fullName} is already in your contacts — nothing was charged.`,
          code: 'already_in_crm',
        },
      };
    }
    // The idempotency key is derived from (org, person), never sent by the
    // client — mirroring the server, where letting the caller choose it meant
    // one paid key unlocked every later reveal for nothing.
    const chargeKey = `reveal:demo-org:${id}`;
    const duplicate = CHARGED.has(chargeKey);
    if (!duplicate) CHARGED.add(chargeKey);
    const prospect = {
      id: `pr-${PROSPECTS.length + 1}`,
      fullName: person.fullName, title: person.title, companyName: person.companyName,
      companyDomain: person.companyDomain, location: person.location,
      email: person.email, phone: person.phone, mobile: person.mobile,
      provider: 'Sandbox', providerPersonId: id, confidence: person.confidence,
      // Labelled the way the real waterfall labels them: a vendor's work field
      // is a work line, and a mobile with no business provenance is treated as
      // private. valid:null throughout, because no carrier lookup is
      // configured in the walkthrough and claiming otherwise would be a lie.
      phones: [
        person.phone
          ? { number: person.phone, kind: 'work', lineType: null, carrier: null, valid: null, verifier: null, source: 'Sandbox' }
          : null,
        person.mobile
          ? { number: person.mobile, kind: 'mobile', lineType: null, carrier: null, valid: null, verifier: null, source: 'Sandbox' }
          : null,
      ].filter(Boolean),
      status: 'saved', revealedAt: '2026-08-02T12:00:00Z',
      revealCostNanos: REVEAL_PRICE_NANOS, contactId: null, leadId: null,
      createdAt: '2026-08-02T12:00:00Z',
    };
    PROSPECTS.unshift(prospect);
    return { status: 201, body: { prospect, charged: !duplicate, phones: prospect.phones } };
  }],
  ['GET', /^\/api\/prospecting\/prospects$/, () => ({ body: { items: PROSPECTS } })],
  ['POST', /^\/api\/prospecting\/import$/, (_m, b) => {
    const prospect = PROSPECTS.find((p) => p.id === b.prospectId);
    if (!prospect) return { status: 404, body: { error: 'Prospect not found.', code: 'not_found' } };
    if (prospect.leadId) {
      return { status: 409, body: { error: 'That prospect is already on the pipeline.', code: 'already_imported' } };
    }
    const [first, ...rest] = String(prospect.fullName).split(' ');
    const contact = {
      id: `ct-${CONTACTS.length + 1}`, firstName: first, lastName: rest.join(' '),
      companyName: prospect.companyName, email: prospect.email, phone: prospect.phone,
      mobile: prospect.mobile,
    };
    CONTACTS.unshift(contact);
    const lead = {
      id: `ld-${LEADS.length + 100}`,
      title: `${prospect.fullName} — ${prospect.companyName ?? 'new prospect'}`,
      status: 'new', source: 'marketing', workType: null, lossType: null,
      estimatedValue: null,
      description: prospect.title ? `${prospect.title} at ${prospect.companyName}.` : null,
      updatedAt: '2026-08-02T12:05:00Z', createdAt: '2026-08-02T12:05:00Z',
    };
    LEADS.unshift(lead);
    prospect.contactId = contact.id;
    prospect.leadId = lead.id;
    prospect.status = 'converted';
    return { status: 201, body: { contact, lead } };
  }],
  ['GET', /^\/api\/prospecting\/suppressions$/, () => ({ body: { items: SUPPRESSIONS } })],
  ['POST', /^\/api\/prospecting\/suppressions$/, (_m, b) => {
    const item = {
      id: `sup-${SUPPRESSIONS.length + 1}`, kind: String(b.kind), 
      value: String(b.value ?? '').toLowerCase(), reason: (b.reason as string) ?? null,
    };
    SUPPRESSIONS.unshift(item);
    return { status: 201, body: { item } };
  }],
  ['DELETE', /^\/api\/prospecting\/suppressions\/([\w-]+)$/, (m) => {
    const i = SUPPRESSIONS.findIndex((s) => s.id === m[1]);
    if (i >= 0) SUPPRESSIONS.splice(i, 1);
    return { body: { ok: true } };
  }],
  ['GET', /^\/api\/crm\/accounts$/, () => ({
    body: { items: ACCOUNTS, total: ACCOUNTS.length, limit: 50, offset: 0 },
  })],
  ['GET', /^\/api\/crm\/leads$/, () => ({
    body: { items: LEADS, total: LEADS.length, limit: 50, offset: 0 },
  })],
  ['POST', /^\/api\/crm\/leads$/, (_m, b) => {
    const lead = {
      id: `ld-${LEADS.length + 100}`,
      title: String(b.title ?? 'Untitled lead'),
      status: 'new',
      source: (b.source as string) ?? 'other',
      workType: (b.workType as string) ?? null,
      lossType: (b.lossType as string) ?? null,
      estimatedValue: b.estimatedValue == null ? null : Number(b.estimatedValue),
      description: (b.description as string) ?? null,
      accountId: (b.accountId as string) ?? null,
      updatedAt: '2026-08-01T13:00:00Z',
      createdAt: '2026-08-01T13:00:00Z',
    };
    LEADS.unshift(lead as (typeof LEADS)[number]);
    return { status: 201, body: { item: lead } };
  }],
  ['PATCH', /^\/api\/crm\/leads\/([\w-]+)$/, (m, b) => {
    const lead = LEADS.find((l) => l.id === m[1]);
    if (!lead) return { status: 404, body: { error: 'Lead not found', code: 'not_found' } };
    Object.assign(lead, b, { updatedAt: '2026-08-01T13:05:00Z' });
    return { body: { item: lead } };
  }],
  ['POST', /^\/api\/crm\/leads\/([\w-]+)\/convert$/, (m) => {
    const lead = LEADS.find((l) => l.id === m[1]);
    if (!lead) return { status: 404, body: { error: 'Lead not found', code: 'not_found' } };
    if (lead.convertedJobId) {
      return { status: 409, body: { error: 'This lead has already been converted.', code: 'already_converted' } };
    }
    const jobId = `job-${1100 + LEADS.indexOf(lead)}`;
    lead.status = 'won';
    lead.convertedJobId = jobId;
    JOBS.unshift({
      jobId, jobNumber: 1100 + LEADS.indexOf(lead), title: lead.title, status: 'scheduled',
      priority: 3, workType: (lead.workType as 'mitigation' | 'construction') ?? 'mitigation',
      ownerId: 'demo-user-1', claimNumber: null, taskCount: 0, tasksDone: 0, crewSize: 0,
      minutesLogged: 0, eventCount: 1, lastEvent: 'Converted from a won lead',
      lastEventAt: '2026-08-01T13:05:00Z', contractAmount: lead.estimatedValue ?? null,
      invoicedAmount: 0, paidAmount: 0, scheduledStart: null,
      createdAt: '2026-08-01T13:05:00Z', updatedAt: '2026-08-01T13:05:00Z',
    });
    return { status: 201, body: { job: { id: jobId, title: lead.title }, leadUpdated: true } };
  }],
  ['GET', /^\/api\/crm\/activities$/, (_m, _b) => {
    const url = LAST_QUERY.leadId;
    const items = ACTIVITIES.filter((a) => !url || a.leadId === url);
    return { body: { items, total: items.length, limit: 50, offset: 0 } };
  }],
  ['POST', /^\/api\/crm\/activities$/, (_m, b) => {
    const item = {
      id: `act-${ACTIVITIES.length + 1}`,
      kind: (b.kind as string) ?? 'note',
      subject: (b.subject as string) ?? null,
      body: (b.body as string) ?? null,
      leadId: (b.leadId as string) ?? null,
      accountId: (b.accountId as string) ?? null,
      jobId: (b.jobId as string) ?? null,
      occurredAt: '2026-08-01T13:10:00Z',
      createdAt: '2026-08-01T13:10:00Z',
    };
    ACTIVITIES.unshift(item as (typeof ACTIVITIES)[number]);
    return { status: 201, body: { item } };
  }],
  ['GET', /^\/api\/crm\/summary$/, () => ({
    body: {
      summary: {
        contacts: 3, properties: 4,
        openLeads: LEADS.filter((l) => l.status === 'new').length,
        activeJobs: JOBS.filter((j) => j.status === 'in_progress').length,
        completedJobs: JOBS.filter((j) => j.status === 'completed').length,
      },
    },
  })],
  ['POST', /^\/api\/crm\/accounts$/, (_m, b) => {
    const item = { id: `acc-${Date.parse('2026-08-01')}`, name: String(b.name ?? 'New account'),
      kind: (b.type as string) ?? 'other', email: (b.email as string) ?? null,
      phone: (b.phone as string) ?? null, city: (b.city as string) ?? null,
      region: (b.region as string) ?? null };
    ACCOUNTS.unshift(item);
    return { status: 201, body: { item } };
  }],
  ['POST', /^\/api\/crm\/contacts$/, (_m, b) => {
    const item = { id: `ct-${CONTACTS.length + 1}`, firstName: (b.firstName as string) ?? null,
      lastName: (b.lastName as string) ?? null, companyName: (b.companyName as string) ?? null,
      email: (b.email as string) ?? null, phone: (b.phone as string) ?? null,
      mobile: (b.mobile as string) ?? null };
    CONTACTS.unshift(item);
    return { status: 201, body: { item } };
  }],
  ['GET', /^\/api\/crm\/contacts$/, () => ({
    body: { items: CONTACTS, total: CONTACTS.length, limit: 50, offset: 0 },
  })],
  ['GET', /^\/api\/computer\/status$/, () => ({ body: COMPUTER_STATUS })],
  ['GET', /^\/api\/computer\/agents$/, () => ({ body: { agents: COMPUTER_STATUS.agents } })],

  ['GET', /^\/api\/estimator\/status$/, () => ({
    body: { sandbox: true, modelAvailable: true, credentialStorageAvailable: true, canManageCredentials: true, maxPhotosPerRun: 24, credentials: [] },
  })],
  ['GET', /^\/api\/estimator\/runs$/, () => ({ body: { runs: [] } })],
  ['GET', /^\/api\/xactimate\/status$/, () => ({ body: XACTIMATE_STATUS })],
];

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (!path.startsWith('/api/')) return realFetch(input, init);

  const query = new URLSearchParams((url.split('?')[1] ?? ''));
  LAST_QUERY.leadId = query.get('leadId') ?? undefined;

  const method = (init?.method ?? 'GET').toUpperCase();
  let body: Record<string, unknown> = {};
  if (typeof init?.body === 'string') {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { /* not JSON */ }
  }

  // A short beat so spinners and disabled states read the way they do live.
  await new Promise((resolve) => setTimeout(resolve, 180));

  for (const [m, re, handler] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    const result = handler(match, body);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      error: 'This surface needs the live backend — the demo serves the core workspace.',
      code: 'demo_mode',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
};

export {};
