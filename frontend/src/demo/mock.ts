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

  ['GET', /^\/api\/crm\/accounts$/, () => ({
    body: {
      items: [
        { id: 'acc-1', name: 'Alliance Mutual Insurance', kind: 'carrier', email: 'claims@alliancemutual.com', phone: '(512) 555-0184', city: 'Austin', region: 'TX' },
        { id: 'acc-2', name: 'Camden Court HOA', kind: 'commercial', email: 'board@camdencourt.org', phone: '(512) 555-0139', city: 'Austin', region: 'TX' },
        { id: 'acc-3', name: 'Hollis Family', kind: 'residential', email: 'j.hollis@example.com', phone: '(512) 555-0122', city: 'Round Rock', region: 'TX' },
        { id: 'acc-4', name: 'Brightway Dental', kind: 'commercial', email: 'office@brightwaydental.com', phone: '(512) 555-0166', city: 'Austin', region: 'TX' },
      ],
      total: 4, limit: 50, offset: 0,
    },
  })],
  ['GET', /^\/api\/crm\/leads$/, () => ({
    body: {
      items: [
        { id: 'ld-1', title: 'Westlake townhomes — burst riser, 6 units', status: 'estimate_sent', source: 'insurance_carrier', workType: 'mitigation', estimatedValue: 48200, updatedAt: '2026-08-01T09:10:00Z' },
        { id: 'ld-2', title: 'Verano Apartments — roof hail claim', status: 'qualified', source: 'referral', workType: 'construction', estimatedValue: 96500, updatedAt: '2026-07-31T14:40:00Z' },
        { id: 'ld-3', title: 'Delgado residence — kitchen supply line', status: 'contacted', source: 'web', workType: 'mitigation', estimatedValue: 12400, updatedAt: '2026-08-01T11:05:00Z' },
        { id: 'ld-4', title: 'Riverbend Church — sanctuary water damage', status: 'new', source: 'phone', workType: 'mitigation', estimatedValue: 31000, updatedAt: '2026-08-01T12:30:00Z' },
        { id: 'ld-5', title: 'Nguyen residence — storm siding', status: 'new', source: 'referral', workType: 'construction', estimatedValue: 8700, updatedAt: '2026-07-30T16:20:00Z' },
        { id: 'ld-6', title: 'Foster Dental — sprinkler discharge', status: 'qualified', source: 'insurance_carrier', workType: 'mitigation', estimatedValue: 27300, updatedAt: '2026-07-29T10:15:00Z' },
        { id: 'ld-7', title: 'Cedar Ridge — storm damage', status: 'won', source: 'referral', estimatedValue: 13980, updatedAt: '2026-07-19T08:30:00Z' },
        { id: 'ld-8', title: 'Meridian Ave — water loss', status: 'won', source: 'insurance_carrier', estimatedValue: 18420, updatedAt: '2026-07-24T15:02:00Z' },
        { id: 'ld-9', title: 'Alder Court — mold survey', status: 'lost', source: 'web', estimatedValue: 6400, lostReason: 'Went with the carrier preferred vendor', updatedAt: '2026-07-22T09:00:00Z' },
      ],
      total: 9, limit: 50, offset: 0,
    },
  })],
  ['GET', /^\/api\/crm\/contacts$/, () => ({
    body: {
      items: [
        { id: 'ct-1', firstName: 'Jordan', lastName: 'Hollis', companyName: null, email: 'j.hollis@example.com', phone: '(512) 555-0122', mobile: null },
        { id: 'ct-2', firstName: 'Rita', lastName: 'Calloway', companyName: 'Alliance Mutual', email: 'r.calloway@alliancemutual.com', phone: '(512) 555-0184', mobile: null },
        { id: 'ct-3', firstName: 'Sam', lastName: 'Okafor', companyName: 'Camden Court HOA', email: 'sam@camdencourt.org', phone: null, mobile: '(512) 555-0171' },
      ],
      total: 3, limit: 50, offset: 0,
    },
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
