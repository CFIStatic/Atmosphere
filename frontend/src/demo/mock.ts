/**
 * Demo mode — a mocked backend behind the real UI.
 *
 * Built with `VITE_DEMO=1`, the app installs this fetch interceptor before it
 * boots. Account, org, and the job library prefer the live API whenever it
 * answers, so Settings and Dashboard show the signed-in tenant rather than the
 * Dana Ortiz fixture. Remaining `/api/*` calls are answered in-page from the
 * fixtures below so surfaces without a live backend still render.
 *
 * Nothing here ships in a normal build: `main.tsx` only imports this module
 * when VITE_DEMO is set, so production bundles never contain it.
 */
import { DEMO_ESTIMATE, DEMO_ESTIMATE_SOURCES, DEMO_ESTIMATE_TAKEOFF } from './demoEstimate';
import { isLiveFirstPath } from './liveFirst';
import { jobSharePagePath } from '../lib/jobSharePath';
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

const realFetch = window.fetch.bind(window);

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
  avatarUrl: null as string | null,
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
  avatarUrl: state.avatarUrl,
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
  { userId: 'u-jess', email: 'jess@ortizrestoration.com', fullName: 'Jess Ortega', role: 'field_technician', workType: 'mitigation', usageIntents: ['field_work'], status: 'active' },
  { userId: 'u-devon', email: 'devon@ortizrestoration.com', fullName: 'Devon Hale', role: 'field_technician', workType: 'construction', usageIntents: ['field_work'], status: 'active' },
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

/**
 * Delivery, seen from Sales.
 *
 * Built from the same jobs as everything else in this file so the demo stays
 * coherent — #1041 is the same job on the Sales page as on the Operations
 * board. One of them has deliberately gone quiet, because the flag is the
 * point of the page and a demo where everything is fine does not show it.
 */
const SALES_WORK_JOBS = [
  {
    id: 'job-1038', jobNumber: 1038, title: 'Storm damage — roof tarp and rebuild',
    customer: 'Cedar Ridge HOA', status: 'in_progress', statusLabel: 'On site', open: true,
    scheduledStart: '2026-08-01T15:30:00Z', contractAmount: 13980, invoicedAmount: 13980,
    lastEventAt: '2026-07-26T10:05:00Z',
    lastEventText: 'Supplement approved by carrier — $4,180',
    daysQuiet: 8, quiet: true,
  },
  {
    id: 'job-1041', jobNumber: 1041, title: 'Water loss, Class 3',
    customer: 'Meridian Ave — Elena Nguyen', status: 'in_progress', statusLabel: 'On site', open: true,
    scheduledStart: '2026-08-01T13:00:00Z', contractAmount: 18420, invoicedAmount: 6200,
    lastEventAt: '2026-08-03T09:20:00Z',
    lastEventText: '0.8h logged — Repositioned two air movers to the master bedroom closet; subfloor down to 14.2% from 16.8%',
    daysQuiet: 0, quiet: false,
    projectId: 'pm-1041', projectNumber: 'P-2041', phase: 'drying', phaseLabel: 'Drying',
    phaseProgress: 0.42, deliveryMatchedBy: 'linked', customerEmail: 'elena.nguyen@example.com',
  },
  {
    id: 'job-1042', jobNumber: 1042, title: 'Mould remediation, unit 4B',
    customer: 'Harbor Point Condos', status: 'scheduled', statusLabel: 'Scheduled', open: true,
    scheduledStart: '2026-08-05T14:00:00Z', contractAmount: 9200, invoicedAmount: 0,
    lastEventAt: '2026-08-02T16:44:00Z', lastEventText: 'Scheduled',
    daysQuiet: 1, quiet: false,
    projectId: 'pm-1042', projectNumber: 'P-2042', phase: 'scheduled', phaseLabel: 'Scheduled',
    phaseProgress: 0.25, deliveryMatchedBy: 'claim-number', customerEmail: 'facilities@harborpoint.example',
  },
  {
    id: 'job-1035', jobNumber: 1035, title: 'Contents pack-out',
    customer: 'Lakeview Dental', status: 'invoiced', statusLabel: 'Invoiced', open: false,
    scheduledStart: null, contractAmount: 7600, invoicedAmount: 7600,
    lastEventAt: '2026-07-29T17:30:00Z', lastEventText: 'Invoice sent',
    daysQuiet: 5, quiet: false,
  },
];

const SALES_WORK_LATEST = [
  { id: 'ev-1', seq: 910, jobId: 'job-1041', jobNumber: 1041, jobTitle: 'Water loss, Class 3', customer: 'Meridian Ave — Elena Nguyen', text: '0.8h logged — Repositioned two air movers to the master bedroom closet; subfloor down to 14.2% from 16.8%', tone: 'progress', by: 'marcus@ortizrestoration.com', at: '2026-08-03T09:20:00Z' },
  { id: 'ev-2', seq: 908, jobId: 'job-1041', jobNumber: 1041, jobTitle: 'Water loss, Class 3', customer: 'Meridian Ave — Elena Nguyen', text: 'Finished: Day 8 moisture readings', tone: 'progress', by: 'marcus@ortizrestoration.com', at: '2026-08-03T08:05:00Z' },
  { id: 'ev-3', seq: 902, jobId: 'job-1042', jobNumber: 1042, jobTitle: 'Mould remediation, unit 4B', customer: 'Harbor Point Condos', text: 'Scheduled', tone: 'progress', by: 'priya@ortizrestoration.com', at: '2026-08-02T16:44:00Z' },
  { id: 'ev-4', seq: 899, jobId: 'job-1042', jobNumber: 1042, jobTitle: 'Mould remediation, unit 4B', customer: 'Harbor Point Condos', text: 'Crew assigned', tone: 'crew', by: 'priya@ortizrestoration.com', at: '2026-08-02T16:40:00Z' },
  { id: 'ev-5', seq: 880, jobId: 'job-1041', jobNumber: 1041, jobTitle: 'Water loss, Class 3', customer: 'Meridian Ave — Elena Nguyen', text: '0.3h logged — Adjuster confirmed supplement path for cabinet uppers; send photos with the day-8 update', tone: 'progress', by: 'dana@ortizrestoration.com', at: '2026-08-01T15:00:00Z' },
  { id: 'ev-6', seq: 861, jobId: 'job-1035', jobNumber: 1035, jobTitle: 'Contents pack-out', customer: 'Lakeview Dental', text: 'Invoice sent', tone: 'money', by: 'dana@ortizrestoration.com', at: '2026-07-29T17:30:00Z' },
  { id: 'ev-7', seq: 840, jobId: 'job-1038', jobNumber: 1038, jobTitle: 'Storm damage — roof tarp and rebuild', customer: 'Cedar Ridge HOA', text: 'Supplement approved by carrier — $4,180', tone: 'money', by: 'priya@ortizrestoration.com', at: '2026-07-26T10:05:00Z' },
];

const SALES_WORK_TIMELINES: Record<string, any> = {
  'job-1041': {
    // The Operations and Field half — phase from the project board, drying
    // readings from the Field app.
    delivery: {
      projectId: 'pm-1041', projectNumber: 'P-2041', phase: 'drying',
      phaseLabel: 'Drying', phaseProgress: 0.42, matchedBy: 'linked',
      targetCompletion: '2026-08-08T00:00:00Z',
      customerEmail: 'elena.nguyen@example.com', adjusterEmail: 'c.brandt@meridianmutual.example',
      drying: [
        { label: 'Master bedroom', latestPct: 14.2, goalPct: 16, readingAt: '2026-08-03T09:00:00Z' },
        { label: 'Kitchen', latestPct: 15.1, goalPct: 16, readingAt: '2026-08-03T09:04:00Z' },
        { label: 'Dining', latestPct: 18.6, goalPct: 16, readingAt: '2026-08-03T09:08:00Z' },
      ],
      headline: 'Drying — 2 of 3 areas at dry standard.',
    },
    suggestedUpdate: {
      subject: 'Update on your water loss, class 3',
      body: 'Hi Elena,\n\nWanted to give you a quick update on water loss, class 3.\n\nWhere things stand: drying.\n2 of 3 affected areas are at dry standard so far.\n\nRecently:\n  • Equipment pulled in Master bedroom\n  • Moisture reading — Dining at 18.6%\n  • Carrier approval received — done\n\nAnything you want to ask about, just reply to this and it comes straight to me.\n\n— Dana Ortiz',
    },
    recipients: [
      { label: 'Customer (from Operations)', email: 'elena.nguyen@example.com' },
      { label: 'Adjuster', email: 'c.brandt@meridianmutual.example' },
    ],
    sends: [
      { id: 'snd-1', email: 'elena.nguyen@example.com', subject: 'Day 5 update on your water loss', state: 'sent', blockedReason: null, at: '2026-07-29T15:12:00Z' },
    ],
    crew: [
      { userId: 'u-marcus', name: 'Marcus Webb', role: 'lead', since: '2026-07-24T15:05:00Z' },
      { userId: 'u-tom', name: 'Tom Reyes', role: 'crew', since: '2026-07-25T08:00:00Z' },
    ],
    timeline: [
      { id: 'ev-1', text: '0.8h logged — Repositioned two air movers to the master bedroom closet; subfloor down to 14.2% from 16.8%', tone: 'progress', source: 'sales', by: 'marcus@ortizrestoration.com', at: '2026-08-03T09:20:00Z' },
      { id: 'dv-1', text: 'Moisture reading — Dining at 18.6%', tone: 'progress', source: 'field', by: null, at: '2026-08-03T09:08:00Z' },
      { id: 'dv-2', text: 'Equipment pulled in Master bedroom', tone: 'progress', source: 'field', by: null, at: '2026-08-03T08:30:00Z' },
      { id: 'ev-2', text: 'Finished: Day 8 moisture readings', tone: 'progress', source: 'sales', by: 'marcus@ortizrestoration.com', at: '2026-08-03T08:05:00Z' },
      { id: 'dv-3', text: 'Carrier approval received — done', tone: 'progress', source: 'operations', by: null, at: '2026-08-02T10:00:00Z' },
      { id: 'ev-5', text: '0.3h logged — Adjuster confirmed supplement path for cabinet uppers; send photos with the day-8 update', tone: 'progress', source: 'sales', by: 'dana@ortizrestoration.com', at: '2026-08-01T15:00:00Z' },
      { id: 'dv-4', text: 'Equipment set in Dining', tone: 'crew', source: 'field', by: null, at: '2026-07-30T08:05:00Z' },
      { id: 'ev-8', text: 'Crew started on site', tone: 'progress', source: 'sales', by: 'marcus@ortizrestoration.com', at: '2026-07-24T13:20:00Z' },
      { id: 'ev-9', text: 'Job opened', tone: 'other', source: 'sales', by: 'dana@ortizrestoration.com', at: '2026-07-24T15:02:00Z' },
    ],
    scheduledEnd: '2026-08-08T00:00:00Z',
  },
  'job-1038': {
    // No Operations project paired: this job carries no claim number that
    // matches, which is exactly the case the page has to explain rather than
    // render as an empty panel.
    delivery: null,
    suggestedUpdate: {
      subject: 'Update on your storm damage — roof tarp and rebuild',
      body: 'Hi there,\n\nWanted to give you a quick update on storm damage — roof tarp and rebuild.\n\nWhere things stand: not started.\n\nAnything you want to ask about, just reply to this and it comes straight to me.\n\n— Dana Ortiz',
    },
    recipients: [],
    sends: [],
    crew: [{ userId: 'u-priya', name: 'Priya Shah', role: 'supervisor', since: '2026-07-19T09:00:00Z' }],
    timeline: [
      { id: 'ev-7', text: 'Supplement approved by carrier — $4,180', tone: 'money', source: 'sales', by: 'priya@ortizrestoration.com', at: '2026-07-26T10:05:00Z' },
      { id: 'ev-10', text: 'Crew started on site', tone: 'progress', source: 'sales', by: 'priya@ortizrestoration.com', at: '2026-07-21T14:00:00Z' },
      { id: 'ev-11', text: 'Job opened', tone: 'other', source: 'sales', by: 'dana@ortizrestoration.com', at: '2026-07-19T08:30:00Z' },
    ],
    scheduledEnd: '2026-08-14T00:00:00Z',
  },
};

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
    planCode: 'team', planName: 'Team', billingInterval: 'monthly', seats: 7, status: 'active',
    periodStart: '2026-07-15T00:00:00Z', periodEnd: '2026-08-15T00:00:00Z', cancelAtPeriodEnd: false,
    // Per-seat plan: 7 × $30. The overview carries the computed total, which
    // is what the RPC returns — the invoice below has always said the same.
    monthlyPriceCents: 21000, includedCreditsNanos: 0, rateMultiplier: 5,
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
  { id: 'pay-1', kind: 'subscription' as const, status: 'succeeded' as const, amountCents: 21000, currency: 'usd', description: 'Team — 7 seats, July 15 to August 15', receiptUrl: null, hostedInvoiceUrl: 'about:blank#demo-invoice', invoicePdfUrl: 'about:blank#demo-invoice-pdf', receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: '2026-07-15T00:00:00Z', periodEnd: '2026-08-15T00:00:00Z', failureReason: null, createdAt: '2026-07-15T00:05:00Z' },
  { id: 'pay-2', kind: 'credits' as const, status: 'succeeded' as const, amountCents: 10000, currency: 'usd', description: 'Pro credit pack', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: null, periodEnd: null, failureReason: null, createdAt: '2026-07-28T14:00:05Z' },
  { id: 'pay-3', kind: 'credits' as const, status: 'succeeded' as const, amountCents: 10000, currency: 'usd', description: 'Pro credit pack — auto-reload', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: null, periodEnd: null, failureReason: null, createdAt: '2026-07-18T03:20:04Z' },
  { id: 'pay-4', kind: 'subscription' as const, status: 'failed' as const, amountCents: 21000, currency: 'usd', description: 'Team — 7 seats, June 15 to July 15', receiptUrl: null, hostedInvoiceUrl: null, invoicePdfUrl: null, receiptEmail: 'elena@ortizrestoration.com', cardBrand: 'visa', cardLast4: '4242', periodStart: '2026-06-15T00:00:00Z', periodEnd: '2026-07-15T00:00:00Z', failureReason: 'Card declined — insufficient funds. Retried successfully two days later.', createdAt: '2026-06-15T00:04:00Z' },
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
  { id: 'acc-5', name: 'Vantage Property Management', kind: 'property_management', email: 'ops@vantagepm.com', phone: '(512) 555-0101', city: 'Austin', region: 'TX' },
  // The duplicate. Same customer, arrived from a carrier portal with the
  // punctuation the adjuster typed.
  { id: 'acc-6', name: 'Camden Court H.O.A.', kind: 'property_management', email: 'board@camdencourt.org', phone: null, city: 'Austin', region: 'TX' },
];

/**
 * Account structure. Vantage manages two associations; Alliance insures one of
 * them; a facilities director sits on both boards. None of that is expressible
 * in a flat list, which is the point.
 */
const ACCOUNT_STRUCTURE: Record<string, any> = {
  'acc-5': {
    account: { id: 'acc-5', name: 'Vantage Property Management', type: 'property_management', parentAccountId: null, mergedIntoId: null, city: 'Austin', region: 'TX' },
    ancestors: [],
    children: [
      { id: 'acc-2', name: 'Camden Court HOA', type: 'property_management' },
      { id: 'acc-4', name: 'Brightway Dental', type: 'property_management' },
    ],
    subtreeSize: 3,
    links: [
      { id: 'ln-1', otherId: 'acc-1', otherName: 'Alliance Mutual Insurance', kind: 'insures', direction: 'to', reads: 'is insured by Alliance Mutual Insurance', note: 'Master policy across the managed portfolio', startedOn: '2025-01-01', endedOn: null },
    ],
    people: [
      { id: 'r-1', contactId: 'ct-2', accountId: 'acc-5', name: 'Marcia Ellery', title: 'Director of Facilities', email: 'm.ellery@vantagepm.com', role: 'facilities director', isPrimary: true, endedOn: null },
      { id: 'r-2', contactId: 'ct-2', accountId: 'acc-2', name: 'Marcia Ellery', title: 'Director of Facilities', email: 'm.ellery@vantagepm.com', role: 'board contact', isPrimary: false, endedOn: null },
    ],
    // Nothing booked directly, everything underneath — the shape a flat list
    // reported as a zero.
    rollup: { accounts: 3, jobs: 6, openJobs: 2, contractTotal: 148_600, invoicedTotal: 96_200, paidTotal: 71_400, ownJobs: 0 },
    mergedIn: [],
  },
  'acc-2': {
    account: { id: 'acc-2', name: 'Camden Court HOA', type: 'property_management', parentAccountId: 'acc-5', mergedIntoId: null, city: 'Austin', region: 'TX' },
    ancestors: [{ id: 'acc-5', name: 'Vantage Property Management' }],
    children: [],
    subtreeSize: 1,
    links: [
      { id: 'ln-2', otherId: 'acc-1', otherName: 'Alliance Mutual Insurance', kind: 'insures', direction: 'to', reads: 'is insured by Alliance Mutual Insurance', note: null, startedOn: '2025-01-01', endedOn: null },
    ],
    people: [
      { id: 'r-2', contactId: 'ct-2', accountId: 'acc-2', name: 'Marcia Ellery', title: 'Director of Facilities', email: 'm.ellery@vantagepm.com', role: 'board contact', isPrimary: false, endedOn: null },
    ],
    rollup: { accounts: 1, jobs: 4, openJobs: 1, contractTotal: 96_500, invoicedTotal: 62_000, paidTotal: 44_000, ownJobs: 4 },
    mergedIn: [],
  },
  'acc-1': {
    account: { id: 'acc-1', name: 'Alliance Mutual Insurance', type: 'insurance_carrier', parentAccountId: null, mergedIntoId: null, city: 'Austin', region: 'TX' },
    ancestors: [],
    children: [],
    subtreeSize: 1,
    links: [
      { id: 'ln-1', otherId: 'acc-5', otherName: 'Vantage Property Management', kind: 'insures', direction: 'from', reads: 'insures Vantage Property Management', note: 'Master policy across the managed portfolio', startedOn: '2025-01-01', endedOn: null },
      { id: 'ln-3', otherId: 'acc-3', otherName: 'Hollis Family', kind: 'insures', direction: 'from', reads: 'insures Hollis Family', note: null, startedOn: '2024-06-01', endedOn: '2026-06-01' },
    ],
    people: [],
    // A carrier is a party to the work, not a customer buying it.
    rollup: { accounts: 1, jobs: 0, openJobs: 0, contractTotal: 0, invoicedTotal: 0, paidTotal: 0, ownJobs: 0 },
    mergedIn: [],
  },
};

const DUPLICATE_PAIRS = [
  {
    score: 100,
    suggestedWinner: 'acc-2',
    a: { id: 'acc-2', name: 'Camden Court HOA', attached: 11 },
    b: { id: 'acc-6', name: 'Camden Court H.O.A.', attached: 2 },
  },
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
/** Whether the demo viewer is sharing their own position. Off, like a real one. */
const SHARING = { on: false, at: null as string | null };

const NETWORK = { contributing: false, decidedAt: null as string | null, shared: 0 };

/** Territories a restoration company in Central Texas would actually run. */
const TERRITORIES: Array<Record<string, any>> = [
  {
    id: 'terr-1', name: 'North Austin', description: 'Multifamily and HOA focus',
    ownerId: 'u-1',
    postalCodes: ['78664', '78681', '78717', '78727', '78729', '78750'],
    cities: ['Cedar Park', 'Round Rock'],
    counties: ['Williamson County'], state: 'TX', active: true, createdAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'terr-2', name: 'Central Austin', description: 'Commercial and healthcare',
    ownerId: null, postalCodes: ['78701', '78702', '78703'], cities: ['Austin'],
    counties: [], state: 'TX', active: true, createdAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'terr-3', name: 'Lawton, OK', description: 'Red River expansion',
    ownerId: null, postalCodes: ['73501', '73505'], cities: ['Lawton'],
    counties: ['Comanche County'], state: 'OK', active: true, createdAt: '2026-07-14T00:00:00Z',
  },
];

/**
 * Where those ZIPs are. Real centroids, not sketched — a demo map with the
 * dots in roughly-Texas would be worse than no map.
 */
const TERRITORY_POINTS = [
  {
    id: 'terr-1', name: 'North Austin', states: ['TX'], zipsTotal: 6,
    points: [
      { zip: '78664', lat: 30.5145, lon: -97.668, place: 'Round Rock, TX' },
      { zip: '78681', lat: 30.5083, lon: -97.6789, place: 'Round Rock, TX' },
      { zip: '78717', lat: 30.506, lon: -97.7472, place: 'Austin, TX' },
      { zip: '78727', lat: 30.4254, lon: -97.7195, place: 'Austin, TX' },
      { zip: '78729', lat: 30.4521, lon: -97.7688, place: 'Austin, TX' },
      { zip: '78750', lat: 30.4224, lon: -97.7967, place: 'Austin, TX' },
    ],
  },
  {
    id: 'terr-2', name: 'Central Austin', states: ['TX'], zipsTotal: 3,
    points: [
      { zip: '78701', lat: 30.2713, lon: -97.7426, place: 'Austin, TX' },
      { zip: '78702', lat: 30.2638, lon: -97.7166, place: 'Austin, TX' },
      { zip: '78703', lat: 30.2907, lon: -97.7648, place: 'Austin, TX' },
    ],
  },
  {
    id: 'terr-3', name: 'Lawton, OK', states: ['OK'], zipsTotal: 2,
    points: [
      { zip: '73501', lat: 34.5915, lon: -98.3698, place: 'Lawton, OK' },
      { zip: '73505', lat: 34.6179, lon: -98.4552, place: 'Lawton, OK' },
    ],
  },
];

/**
 * Who the platform has written to. Campaigns and job updates in one list,
 * because a recipient experiences mail from the company, not two subsystems.
 */
const OUTREACH_PEOPLE = [
  { email: 'elena.nguyen@example.com', messages: 3, delivered: 3, bounced: 0, blocked: 0, campaignMessages: 1, updateMessages: 2, lastAt: '2026-08-03T09:30:00Z', unsubscribed: false, suppressed: false },
  { email: 'facilities@harborpoint.example', messages: 4, delivered: 4, bounced: 0, blocked: 0, campaignMessages: 4, updateMessages: 0, lastAt: '2026-08-02T14:10:00Z', unsubscribed: false, suppressed: false },
  { email: 'j.mercer@roundrockisd.example', messages: 2, delivered: 1, bounced: 0, blocked: 1, campaignMessages: 2, updateMessages: 0, lastAt: '2026-08-01T09:05:00Z', unsubscribed: true, suppressed: false },
  { email: 'office@lakeviewdental.example', messages: 5, delivered: 5, bounced: 0, blocked: 0, campaignMessages: 2, updateMessages: 3, lastAt: '2026-07-29T17:35:00Z', unsubscribed: false, suppressed: false },
  { email: 'p.okafor@cedarridgehoa.example', messages: 2, delivered: 1, bounced: 1, blocked: 0, campaignMessages: 2, updateMessages: 0, lastAt: '2026-07-26T11:00:00Z', unsubscribed: false, suppressed: false },
];

const OUTREACH_HISTORY: Record<string, any[]> = {
  'elena.nguyen@example.com': [
    { id: 'h1', kind: 'job_update', subject: 'Update on your water loss, class 3', state: 'sent', blockedReason: null, error: null, about: '#1041 · Water loss, Class 3', at: '2026-08-03T09:30:00Z' },
    { id: 'h2', kind: 'job_update', subject: 'Day 5 update on your water loss', state: 'sent', blockedReason: null, error: null, about: '#1041 · Water loss, Class 3', at: '2026-07-29T15:12:00Z' },
    { id: 'h3', kind: 'campaign', subject: 'Checking in ahead of the weather', state: 'sent', blockedReason: null, error: null, about: 'Hail watch — North Austin schools', at: '2026-07-20T13:00:00Z' },
  ],
  'j.mercer@roundrockisd.example': [
    { id: 'h4', kind: 'campaign', subject: 'Checking in ahead of the weather', state: 'blocked', blockedReason: 'unsubscribed', error: null, about: 'Hail watch — North Austin schools', at: '2026-08-01T09:05:00Z' },
    { id: 'h5', kind: 'campaign', subject: 'Before storm season', state: 'sent', blockedReason: null, error: null, about: 'Q3 property managers — North Austin', at: '2026-07-08T10:00:00Z' },
  ],
  'p.okafor@cedarridgehoa.example': [
    { id: 'h6', kind: 'campaign', subject: 'Before storm season', state: 'bounced', blockedReason: null, error: '550 5.1.1 recipient rejected', about: 'Q3 property managers — North Austin', at: '2026-07-26T11:00:00Z' },
    { id: 'h7', kind: 'campaign', subject: 'Introducing ourselves', state: 'sent', blockedReason: null, error: null, about: 'Q3 property managers — North Austin', at: '2026-07-02T10:00:00Z' },
  ],
};

/**
 * The shared job record. Job #1038 is deliberately in a bad state — a sub on a
 * superseded revision, a request left two days, an unpriced approval — because
 * a demo where everything is fine does not show what the page is for.
 */
const SHARED_JOBS = [
  { jobId: 'job-1038', jobNumber: 1038, title: 'Cedar Ridge — storm damage, roof tarp + rebuild', status: 'in_progress', parties: 3, currentRevision: 4, behind: 2, awaiting: 1, exclusions: 2 },
  { jobId: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3', status: 'in_progress', parties: 1, currentRevision: 2, behind: 0, awaiting: 0, exclusions: 1 },
];

const SHARED_RECORDS: Record<string, any> = {
  'job-1038': {
    job: { id: 'job-1038', jobNumber: 1038, title: 'Cedar Ridge — storm damage, roof tarp + rebuild', status: 'in_progress', claimNumber: 'CLM-88396' },
    brief: {
      id: 'br-4', revision: 4, created_at: '2026-08-04T08:00:00Z',
      note: 'Carrier approved the deck replacement; skylights removed from scope.',
      facts: {
        'Site address': '2214 Cedar Ridge Dr, Round Rock TX',
        'Gate / access': 'Lockbox on the side gate — 4412',
        'Permit': 'BP-2026-8841 (posted on site)',
        'Carrier approval': '$13,980 + $4,180 supplement',
        'Site contact': 'Priya Shah, 512-555-0148',
        'Working hours': '7am–6pm, no Sunday work (HOA)',
        'Dumpster': 'Driveway, right side only — do not block the hydrant',
      },
    },
    revisions: [
      { revision: 4, note: 'Carrier approved the deck replacement; skylights removed from scope.', createdAt: '2026-08-04T08:00:00Z' },
      { revision: 3, note: 'Added HOA working hours.', createdAt: '2026-07-29T10:00:00Z' },
      { revision: 2, note: 'Permit posted.', createdAt: '2026-07-23T14:00:00Z' },
      { revision: 1, note: 'Initial scope.', createdAt: '2026-07-19T09:00:00Z' },
    ],
    currentRevision: 4,
    parties: [
      { id: 'pty-1', company: 'Ortiz Restoration', trade: null, contactName: 'Priya Shah', email: 'priya@ortizrestoration.com', phone: null, role: 'general_contractor', invited_at: '2026-07-19T09:00:00Z', last_seen_at: '2026-08-05T07:40:00Z', revoked_at: null, acknowledgedRevision: 4, clear: true, because: 'Accepted revision 4. Nothing outstanding.' },
      { id: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', contactName: 'Hector Delgado', email: 'hector@delgadoroofing.example', phone: null, role: 'subcontractor', invited_at: '2026-07-19T10:00:00Z', last_seen_at: '2026-08-01T06:20:00Z', revoked_at: null, acknowledgedRevision: 3, clear: false, because: 'They accepted revision 3; the job is on 4.' },
      { id: 'pty-3', company: 'Brightline Electric', trade: 'electrical', contactName: 'Nina Osei', email: 'nina@brightline.example', phone: null, role: 'subcontractor', invited_at: '2026-08-01T09:00:00Z', last_seen_at: null, revoked_at: null, acknowledgedRevision: null, clear: false, because: 'They have not accepted the scope.' },
    ],
    scope: [
      { id: 'sc-1', party_id: null, state: 'excluded', title: 'Do not touch the solar array or its conduit', detail: null, amount: null, reason: 'Owner has a separate contract with the solar installer; disconnect voids their warranty.', revision: 4, decided_at: null, created_at: '2026-07-19T09:10:00Z' },
      { id: 'sc-2', party_id: null, state: 'excluded', title: 'Do not remove the skylights', detail: null, amount: null, reason: 'Carrier declined them on revision 4. Removing them is unpaid work.', revision: 4, decided_at: null, created_at: '2026-08-04T08:05:00Z' },
      { id: 'sc-3', party_id: 'pty-2', state: 'proposed', title: 'Replace 6 sheets of decking — rot found under the north valley', detail: 'Not visible until the tear-off. Photos posted in the thread.', amount: 1240, reason: null, revision: 4, decided_at: null, created_at: '2026-08-03T11:20:00Z' },
      { id: 'sc-4', party_id: 'pty-2', state: 'included', title: 'Tear off and replace roof — architectural shingle, 30yr', detail: null, amount: null, reason: null, revision: 4, decided_at: null, created_at: '2026-07-19T09:05:00Z' },
      { id: 'sc-5', party_id: 'pty-3', state: 'included', title: 'Rewire the two circuits in the affected bedrooms', detail: null, amount: null, reason: null, revision: 4, decided_at: null, created_at: '2026-08-01T09:05:00Z' },
      { id: 'sc-6', party_id: 'pty-2', state: 'approved', title: 'Ridge vent — replace full run', detail: null, amount: null, reason: null, revision: 3, decided_at: '2026-07-28T14:00:00Z', created_at: '2026-07-27T09:00:00Z' },
    ],
    money: { approved: 0, pending: 1240, unpricedApprovals: 1 },
    messages: [
      { id: 'msg-1', party_id: 'pty-2', author_label: 'Hector Delgado, Delgado Roofing', body: 'Tear-off is done on the north slope. Found rot under the valley — six sheets. Photos attached in the request. Not touching it until somebody says yes.', scope_item_id: 'sc-3', is_decision: false, created_at: '2026-08-03T11:22:00Z' },
      { id: 'msg-2', party_id: null, author_label: 'Priya Shah', body: 'Seen. Getting the carrier to look at it today — do not proceed yet.', scope_item_id: 'sc-3', is_decision: false, created_at: '2026-08-03T13:05:00Z' },
      { id: 'msg-3', party_id: null, author_label: 'Priya Shah', body: 'Revision 4 published — carrier approved the deck replacement and pulled the skylights out of scope. Everyone please re-accept.', scope_item_id: null, is_decision: true, created_at: '2026-08-04T08:02:00Z' },
    ],
    risks: [
      { key: 'stale:pty-2', level: 'blocker', title: 'Delgado Roofing accepted revision 3; the job is on 4', action: 'They are working from a superseded scope. Get the new one accepted before more work happens.', partyId: 'pty-2' },
      { key: 'unacked:pty-3', level: 'blocker', title: 'Brightline Electric has not accepted the scope', action: 'They have the link and have not confirmed. Do not let them start.', partyId: 'pty-3' },
      { key: 'proposed:sc-3', level: 'blocker', title: 'Waiting on your answer: Replace 6 sheets of decking — rot found under the north valley', action: 'Asked 2 days ago. Answer it or it gets decided on site.', scopeItemId: 'sc-3' },
      { key: 'never-opened:pty-3', level: 'warn', title: 'Brightline Electric has never opened the job record', action: 'Invited 4 days ago and never viewed. Assume they have not seen any of it.', partyId: 'pty-3' },
      { key: 'unpriced:sc-6', level: 'warn', title: 'Approved with no amount: Ridge vent — replace full run', action: 'Put a number on it now. Agreeing the price after the work is a negotiation.', scopeItemId: 'sc-6' },
    ],
  },
  'job-1041': {
    job: { id: 'job-1041', jobNumber: 1041, title: 'Meridian Ave — water loss, Class 3', status: 'in_progress', claimNumber: 'CLM-88412' },
    brief: {
      id: 'br-2', revision: 2, created_at: '2026-07-26T09:00:00Z', note: 'Added dry standard and equipment plan.',
      facts: {
        'Site address': '1408 Meridian Ave, Austin TX',
        'Gate / access': 'Homeowner on site 8–5; key under the planter otherwise',
        'Dry standard': '16% WME, control reading 12%',
        'Equipment': '4 air movers, 2 LGR dehus — do not remove without a reading',
      },
    },
    revisions: [
      { revision: 2, note: 'Added dry standard and equipment plan.', createdAt: '2026-07-26T09:00:00Z' },
      { revision: 1, note: 'Initial scope.', createdAt: '2026-07-24T15:10:00Z' },
    ],
    currentRevision: 2,
    parties: [
      { id: 'pty-4', company: 'Kestrel Flooring', trade: 'flooring', contactName: 'Sam Ruiz', email: 'sam@kestrelfloors.example', phone: null, role: 'subcontractor', invited_at: '2026-07-26T09:30:00Z', last_seen_at: '2026-08-02T08:15:00Z', revoked_at: null, acknowledgedRevision: 2, clear: true, because: 'Accepted revision 2. Nothing outstanding.' },
    ],
    scope: [
      { id: 'sc-7', party_id: null, state: 'excluded', title: 'Do not pull the hardwood in the dining room', detail: null, amount: null, reason: 'Still drying in place — a reading has to clear it first.', revision: 2, decided_at: null, created_at: '2026-07-26T09:20:00Z' },
      { id: 'sc-8', party_id: 'pty-4', state: 'included', title: 'Replace kitchen LVP after the dry standard is met', detail: null, amount: null, reason: null, revision: 2, decided_at: null, created_at: '2026-07-26T09:22:00Z' },
    ],
    money: { approved: 0, pending: 0, unpricedApprovals: 0 },
    messages: [
      { id: 'msg-4', party_id: 'pty-4', author_label: 'Sam Ruiz, Kestrel Flooring', body: 'Accepted. Holding off on the dining room until I see a reading.', scope_item_id: null, is_decision: false, created_at: '2026-08-02T08:16:00Z' },
    ],
    risks: [],
  },
};

/**
 * Proof of work. One clean day, one that fails a check, one still waiting on
 * its after video, and one that is merely unproven — because "unproven" and
 * "disproven" reading differently is the whole point of the feature.
 */
const PROOF_DAYS: Record<string, any> = {
  'job-1038': {
    siteKnown: true,
    days: [
      {
        partyId: 'pty-2', company: 'Delgado Roofing', workDate: '2026-08-05',
        hasBefore: true, hasAfter: true, contradicted: false,
        summary: 'Before and after both check out.',
        payable: true, payableBecause: 'Before and after both check out on every count.',
        accepted: false, rejected: false,
        materialChange: 'significant', analysisStatus: 'done', analysisError: null,
        reports: {
          before: {
            status: 'done',
            text: 'Opens at the street with the house number in frame, then climbs to the north slope where the tarp is still battened down. The middle of the clip walks the full slope edge to edge, and it ends on the intact skylights, untouched.',
            entries: [
              { frame: 0, atSeconds: 6, stageIndex: 0, note: 'Front elevation, house number visible.' },
              { frame: 2, atSeconds: 41, stageIndex: 1, note: 'Tarp still in place across the north slope.' },
              { frame: 5, atSeconds: 88, stageIndex: 3, note: 'Skylights intact, passed without contact.' },
            ],
            coverage: [
            { stageIndex: 0, label: 'Start outside, facing the front of the building', seen: true },
            { stageIndex: 1, label: 'Walk the area for \u201cStrip north slope to decking\u201d', seen: true },
            { stageIndex: 2, label: 'Walk the area for \u201cInstall synthetic underlayment\u201d', seen: true },
            { stageIndex: 3, label: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d', seen: true },
            { stageIndex: 4, label: 'Finish on anything unexpected you found', seen: true },
          ],
            error: null,
          },
          after: {
            status: 'done',
            text: 'Opens at the front elevation, then shows the north slope stripped to decking with underlayment and new shingles across roughly two thirds of it. New decking sheets are visible in the valley. The clip ends mid-slope; the skylight pass and the wrap shot are not in the footage.',
            entries: [
              { frame: 0, atSeconds: 5, stageIndex: 0, note: 'Front elevation, same vantage as the morning clip.' },
              { frame: 2, atSeconds: 39, stageIndex: 1, note: 'Slope stripped; underlayment laid to the ridge.' },
              { frame: 4, atSeconds: 71, stageIndex: 2, note: 'New shingles across two thirds of the slope.' },
            ],
            coverage: [
            { stageIndex: 0, label: 'Start outside, facing the front of the building', seen: true },
            { stageIndex: 1, label: 'Walk the area for \u201cStrip north slope to decking\u201d', seen: true },
            { stageIndex: 2, label: 'Walk the area for \u201cInstall synthetic underlayment\u201d', seen: true },
            { stageIndex: 3, label: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d', seen: false },
            { stageIndex: 4, label: 'Finish on anything unexpected you found', seen: false },
          ],
            error: null,
          },
        },
        checks: [
          { key: 'before.on_site', verdict: 'pass', detail: 'Filmed at the site.' },
          { key: 'before.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-05.' },
          { key: 'before.uploaded_promptly', verdict: 'pass', detail: 'Uploaded straight away.' },
          { key: 'before.long_enough', verdict: 'pass', detail: '68 seconds.' },
          { key: 'before.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'after.on_site', verdict: 'pass', detail: 'Filmed at the site.' },
          { key: 'after.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-05.' },
          { key: 'after.uploaded_promptly', verdict: 'pass', detail: 'Uploaded straight away.' },
          { key: 'after.long_enough', verdict: 'pass', detail: '94 seconds.' },
          { key: 'after.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'ordered', verdict: 'pass', detail: '7.8 hours of work between the two.' },
        ],
        aiSummary: 'The north slope is stripped to the deck in the before frames and fully dried-in with underlayment and new shingles across roughly two thirds of it in the after. Six sheets of new decking are visible in the valley where the before shows dark, delaminated sheathing.',
        aiFindings: {
          opening: { before: 'exterior', after: 'exterior' },
          materialBecause: 'The before shows bare stripped deck; the after shows underlayment and shingles across two thirds of the slope, with new decking in the valley.',
          changes: [
            'North valley: dark delaminated decking replaced with new sheets',
            'Underlayment laid across the full north slope',
            'Shingles installed to roughly the ridge line on the north slope',
          ],
          cannotTell: ['The south slope is out of frame in both videos'],
          scopeTouched: ['Tear off and replace roof — architectural shingle, 30yr', 'Replace 6 sheets of decking — rot found under the north valley'],
          scopeVerdicts: [
            { title: 'Replace 6 sheets of decking — rot found under the north valley', verdict: 'appears_complete', because: 'Six new sheets visible in the valley where the before showed dark delaminated sheathing.' },
            { title: 'Tear off and replace roof — architectural shingle, 30yr', verdict: 'in_progress', because: 'Shingles laid to the ridge on the north slope only; the south slope is not in frame.' },
            { title: 'Rewire the two circuits in the affected bedrooms', verdict: 'not_visible', because: 'No interior footage in either video.' },
          ],
          concerns: [],
        },
        proofIds: ['pf-1', 'pf-2'],
      },
      {
        partyId: 'pty-2', company: 'Delgado Roofing', workDate: '2026-08-04',
        hasBefore: true, hasAfter: true, contradicted: true,
        summary: '1 check failed. Do not pay against this without asking.',
        payable: false, payableBecause: 'Filmed 2.14 miles from the site — outside the 0.25-mile radius.',
        accepted: false, rejected: false,
        materialChange: 'unclear', analysisStatus: 'done', analysisError: null,
        reports: {
          before: {
            status: 'done',
            text: 'Opens at a roof slope with intact shingles and no visible storm damage. The pitch and the surrounding trees do not match the other footage filed on this job, and no frame shows the house number or street.',
            entries: [
              { frame: 0, atSeconds: 4, stageIndex: -1, note: 'A building exterior, but nothing that identifies which one.' },
              { frame: 3, atSeconds: 52, stageIndex: -1, note: 'Intact shingles; no work area in frame.' },
            ],
            coverage: [
              { stageIndex: 0, label: 'Start outside, facing the front of the building', seen: false },
              { stageIndex: 1, label: 'Walk the area for \u201cStrip north slope to decking\u201d', seen: false },
              { stageIndex: 2, label: 'Walk the area for \u201cInstall synthetic underlayment\u201d', seen: false },
              { stageIndex: 3, label: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d', seen: false },
              { stageIndex: 4, label: 'Finish on anything unexpected you found', seen: false },
            ],
            error: null,
          },
          after: { status: 'queued', text: null, entries: [], coverage: [], error: null },
        },
        checks: [
          { key: 'before.on_site', verdict: 'pass', detail: 'Filmed 0.03 miles from the site.' },
          { key: 'before.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-04.' },
          { key: 'before.uploaded_promptly', verdict: 'pass', detail: 'Uploaded straight away.' },
          { key: 'before.long_enough', verdict: 'pass', detail: '41 seconds.' },
          { key: 'before.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'after.on_site', verdict: 'fail', detail: 'Filmed 2.14 miles from the site — outside the 0.25-mile radius.' },
          { key: 'after.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-04.' },
          { key: 'after.uploaded_promptly', verdict: 'pass', detail: 'Uploaded 3h after filming.' },
          { key: 'after.long_enough', verdict: 'pass', detail: '52 seconds.' },
          { key: 'after.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'ordered', verdict: 'pass', detail: '6.2 hours of work between the two.' },
        ],
        aiSummary: 'The after frames show a different roof pitch and a different street elevation from the before. Both show roofing work in progress.',
        aiFindings: {
          opening: { before: 'exterior', after: 'exterior' },
          materialBecause: 'The two videos do not appear to show the same building, so no before-and-after comparison is possible.',
          changes: [],
          cannotTell: ['The two videos do not appear to show the same building'],
          scopeTouched: [],
          concerns: ['The after footage appears to be a different property'],
        },
        proofIds: ['pf-3', 'pf-4'],
      },
      {
        partyId: 'pty-3', company: 'Brightline Electric', workDate: '2026-08-05',
        hasBefore: true, hasAfter: false, contradicted: false,
        summary: 'Started but not finished: no after video yet.',
        payable: false, payableBecause: 'A day needs both a before and an after.',
        accepted: false, rejected: false,
        materialChange: null, analysisStatus: 'skipped', analysisError: 'The day does not have both videos yet.',
        checks: [
          { key: 'before.on_site', verdict: 'unknown', detail: 'The video carries no location. Ask them to allow location in the app.' },
          { key: 'before.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-05.' },
          { key: 'before.uploaded_promptly', verdict: 'pass', detail: 'Uploaded straight away.' },
          { key: 'before.long_enough', verdict: 'pass', detail: '33 seconds.' },
          { key: 'before.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
        ],
        aiSummary: null, aiFindings: null,
        proofIds: ['pf-5'],
      },
      {
        partyId: 'pty-2', company: 'Delgado Roofing', workDate: '2026-08-01',
        hasBefore: true, hasAfter: true, contradicted: false,
        summary: 'Nothing contradicts it, but 2 things could not be checked.',
        payable: false, payableBecause: '2 things could not be checked — The video carries no location. Ask them to allow location in the app.',
        accepted: true, rejected: false,
        materialChange: 'significant', analysisStatus: 'done', analysisError: null,
        checks: [
          { key: 'before.on_site', verdict: 'unknown', detail: 'The video carries no location. Ask them to allow location in the app.' },
          { key: 'before.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-01.' },
          { key: 'before.uploaded_promptly', verdict: 'pass', detail: 'Uploaded straight away.' },
          { key: 'before.long_enough', verdict: 'pass', detail: '55 seconds.' },
          { key: 'before.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'after.on_site', verdict: 'unknown', detail: 'The video carries no location. Ask them to allow location in the app.' },
          { key: 'after.same_day', verdict: 'pass', detail: 'Filmed on 2026-08-01.' },
          { key: 'after.uploaded_promptly', verdict: 'pass', detail: 'Uploaded 2h after filming.' },
          { key: 'after.long_enough', verdict: 'pass', detail: '71 seconds.' },
          { key: 'after.not_a_reupload', verdict: 'pass', detail: 'Not a copy of anything already on this job.' },
          { key: 'ordered', verdict: 'pass', detail: '8.1 hours of work between the two.' },
        ],
        aiSummary: 'Tear-off of the north slope, from intact shingles in the before to bare deck with the felt stripped in the after. Debris is in a dumpster on the driveway in both.',
        aiFindings: {
          opening: { before: 'exterior', after: 'not_exterior' },
          changes: ['North slope stripped to bare deck', 'Old shingles cleared to the driveway dumpster'],
          cannotTell: ['No close view of the deck condition underneath'],
          scopeTouched: ['Tear off and replace roof — architectural shingle, 30yr'],
          scopeVerdicts: [
            { title: 'Tear off and replace roof — architectural shingle, 30yr', verdict: 'in_progress', because: 'Tear-off complete on the north slope; nothing laid back down yet.' },
          ],
          concerns: [],
        },
        proofIds: ['pf-6', 'pf-7'],
      },
    ],
  },
  'job-1041': { siteKnown: false, days: [] },
};

const PROOF_QUESTIONS: Record<string, any[]> = {
  'job-1038': [
    {
      id: 'q-1',
      question: 'When did the decking replacement actually happen?',
      answer: 'On 2026-08-05. The after footage that day shows six new sheets in the north valley where the before showed dark, delaminated sheathing. The videos on file do not show decking work on any other day.',
      grounded_on: ['2026-08-05', '2026-08-04', '2026-08-01'],
      created_at: '2026-08-05T18:40:00Z',
    },
  ],
};

/**
 * A three-frame clip, drawn rather than filmed. Enough for the player to be
 * demonstrably a player; nobody's actual house ends up in the bundle.
 */
const DEMO_CLIP =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCAtIEguMjY0L01QRUctNCBBVkMgY29kZWM=';

/**
 * The subcontractor's own view, through their job link. Same rows as the
 * general contractor's dashboard, narrowed to what one company can see.
 */
const SHARE_VIEW: Record<string, any> = {
  'demo-token': {
    you: { company: 'Delgado Roofing', trade: 'roofing', role: 'subcontractor' },
    job: { jobNumber: 1038, title: 'Cedar Ridge — storm damage, roof tarp + rebuild', claimNumber: 'CLM-88396', scheduledStart: '2026-08-01T14:00:00Z' },
    brief: {
      revision: 4,
      note: 'Carrier approved the deck replacement; skylights removed from scope.',
      facts: {
        'Site address': '2214 Cedar Ridge Dr, Round Rock TX',
        'Gate / access': 'Lockbox on the side gate — 4412',
        'Working hours': '7am–6pm, no Sunday work (HOA)',
        'Dumpster': 'Driveway, right side only — do not block the hydrant',
        'Site contact': 'Priya Shah, 512-555-0148',
      },
    },
    currentRevision: 4,
    acknowledgedRevision: 3,
    clear: false,
    because: 'They accepted revision 3; the job is on 4.',
    scope: [
      { id: 'sc-1', state: 'excluded', title: 'Do not touch the solar array or its conduit', detail: null, amount: null, reason: 'Owner has a separate contract with the solar installer; disconnect voids their warranty.' },
      { id: 'sc-2', state: 'excluded', title: 'Do not remove the skylights', detail: null, amount: null, reason: 'Carrier declined them on revision 4. Removing them is unpaid work.' },
      { id: 'sc-3', state: 'proposed', title: 'Replace 6 sheets of decking — rot found under the north valley', detail: 'Not visible until the tear-off. Photos posted in the thread.', amount: 1240, reason: null },
      { id: 'sc-4', state: 'included', title: 'Tear off and replace roof — architectural shingle, 30yr', detail: null, amount: null, reason: null },
      { id: 'sc-6', state: 'approved', title: 'Ridge vent — replace full run', detail: null, amount: null, reason: null },
    ],
    messages: [
      { id: 'msg-3', author_label: 'Priya Shah', body: 'Revision 4 published — carrier approved the deck replacement and pulled the skylights out of scope. Everyone please re-accept.', created_at: '2026-08-04T08:02:00Z' },
      { id: 'msg-2', author_label: 'Priya Shah', body: 'Seen. Getting the carrier to look at it today — do not proceed yet.', created_at: '2026-08-03T13:05:00Z' },
    ],
  },
};

const SHARE_PROOF_DAYS = [
  { workDate: '2026-08-05', hasBefore: true, hasAfter: false, summary: 'Before filed this morning. Film the after when the day wraps.', problems: [], accepted: false },
  { workDate: '2026-08-04', hasBefore: true, hasAfter: true, summary: '1 check failed. Do not pay against this without asking.', problems: ['Filmed 2.14 miles from the site — outside the 0.25-mile radius.'], accepted: false },
  { workDate: '2026-08-01', hasBefore: true, hasAfter: true, summary: 'Nothing contradicts it, but 2 things could not be checked.', problems: [], accepted: true },
];

/**
 * The evidence locker. Six files across the two crews, one on legal hold for
 * the disputed day, and a chain of custody that includes views — because "you
 * never showed me that video" is answered by a number.
 */
const EVIDENCE: Record<string, any[]> = {
  'job-1038': [
    { id: 'pf-1', partyId: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', workDate: '2026-08-05', phase: 'before', category: 'before', title: 'Before — Aug 05', tags: ['north slope'], durationSeconds: 68, byteSize: 84_310_000, capturedAt: '2026-08-05T12:58:00Z', receivedAt: '2026-08-05T13:02:00Z', hasLocation: true, state: 'checked', checks: [], aiSummary: null, legalHold: false, retentionUntil: '2028-08-05', contentHash: '4f2a9c1d8b73e5460af1c92d7e3b8054916cfa2d7b04e8135ca6dfe27093b118', viewCount: 3, lastViewedAt: '2026-08-05T18:22:00Z' },
    { id: 'pf-2', partyId: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', workDate: '2026-08-05', phase: 'after', category: 'after', title: 'After — Aug 05', tags: ['north slope', 'decking'], durationSeconds: 94, byteSize: 121_800_000, capturedAt: '2026-08-05T20:46:00Z', receivedAt: '2026-08-05T20:51:00Z', hasLocation: true, state: 'analysed', checks: [], aiSummary: 'The north slope is stripped to the deck in the before frames and fully dried-in with underlayment and new shingles across roughly two thirds of it in the after. Six sheets of new decking are visible in the valley.', legalHold: false, retentionUntil: '2028-08-05', contentHash: 'c81be4079d3a52f6148e0b7d93ac25e1f70648b2ad91c3506fe8b74d2a109c37', viewCount: 2, lastViewedAt: '2026-08-06T07:41:00Z' },
    { id: 'pf-3', partyId: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', workDate: '2026-08-04', phase: 'before', category: 'before', title: 'Before — Aug 04', tags: [], durationSeconds: 41, byteSize: 52_400_000, capturedAt: '2026-08-04T13:05:00Z', receivedAt: '2026-08-04T13:08:00Z', hasLocation: true, state: 'checked', checks: [], aiSummary: null, legalHold: false, retentionUntil: '2028-08-04', contentHash: '9a4c2f81de06b3574c98a1f2b7e04d63951c8a70bd42e6f1039c85ba7d21e4f0', viewCount: 1, lastViewedAt: '2026-08-06T09:12:00Z' },
    { id: 'pf-4', partyId: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', workDate: '2026-08-04', phase: 'after', category: 'issue', title: 'After — Aug 04 (disputed)', tags: ['off-site', 'disputed'], durationSeconds: 52, byteSize: 61_900_000, capturedAt: '2026-08-04T19:30:00Z', receivedAt: '2026-08-04T22:40:00Z', hasLocation: true, state: 'analysed', checks: [{ key: 'on_site', verdict: 'fail', detail: 'Filmed 2.14 miles from the site — outside the 0.25-mile radius.' }], aiSummary: 'The after frames show a different roof pitch and a different street elevation from the before. Both show roofing work in progress.', legalHold: true, retentionUntil: null, contentHash: '2e7b90a4c1d85f36027ea9b41c6d3805f71b29ac04e8d517b3a62ce09f4d1836', viewCount: 5, lastViewedAt: '2026-08-06T09:15:00Z' },
    { id: 'pf-5', partyId: 'pty-3', company: 'Brightline Electric', trade: 'electrical', workDate: '2026-08-05', phase: 'before', category: 'before', title: 'Before — Aug 05', tags: [], durationSeconds: 33, byteSize: 38_200_000, capturedAt: '2026-08-05T14:10:00Z', receivedAt: '2026-08-05T14:12:00Z', hasLocation: false, state: 'checked', checks: [{ key: 'on_site', verdict: 'unknown', detail: 'The video carries no location. Ask them to allow location in the app.' }], aiSummary: null, legalHold: false, retentionUntil: '2028-08-05', contentHash: '7c05fa9138be6247d0a1e83bc4f9d2058ba61374ec802f9de5164a730bc8912e', viewCount: 0, lastViewedAt: null },
    { id: 'pf-6', partyId: 'pty-2', company: 'Delgado Roofing', trade: 'roofing', workDate: '2026-08-01', phase: 'before', category: 'condition', title: 'Pre-existing damage — Aug 01', tags: ['gutter', 'pre-existing'], durationSeconds: 55, byteSize: 66_100_000, capturedAt: '2026-08-01T12:40:00Z', receivedAt: '2026-08-01T12:44:00Z', hasLocation: false, state: 'checked', checks: [{ key: 'on_site', verdict: 'unknown', detail: 'The video carries no location. Ask them to allow location in the app.' }], aiSummary: null, legalHold: false, retentionUntil: '2033-08-01', contentHash: 'b3419e7c05d2a86f14730bce29a5d861f04c73b95e2018da6cf4b7350e9a1d26', viewCount: 1, lastViewedAt: '2026-08-02T08:05:00Z' },
  ],
  'job-1041': [],
};

function evidencePortalLibrary() {
  const jobById = Object.fromEntries(JOBS.map((j) => [j.jobId, j]));
  const items: Record<string, unknown>[] = [];
  for (const [jobId, proofs] of Object.entries(EVIDENCE)) {
    const job = jobById[jobId];
    for (const p of proofs) {
      const checks = (p.checks ?? []) as Array<{ key: string; verdict: string; detail: string }>;
      const flagged = checks.some((c) => c.verdict === 'fail');
      items.push({
        id: p.id,
        jobId,
        jobName: job?.title ?? 'Job',
        jobNumber: job?.jobNumber ?? null,
        company: p.company,
        person: p.company,
        phase: p.phase,
        workDate: p.workDate,
        capturedAt: p.capturedAt,
        uploadedAt: p.receivedAt,
        durationSeconds: p.durationSeconds,
        byteSize: p.byteSize,
        hash: p.contentHash,
        labels: p.tags ?? [],
        checks,
        flagged,
        legalHold: Boolean(p.legalHold),
        tier: 1,
        analysisState: p.state === 'analysed' ? 'done' : p.state === 'checked' ? 'paired' : 'none',
        analysis:
          p.aiSummary != null
            ? {
                summary: p.aiSummary,
                dictation: p.aiSummary,
                materialChange: p.category === 'issue',
                materialBecause: p.category === 'issue' ? 'Integrity check failed' : null,
                changes: [],
                scope: [],
                couldNotTell: [],
              }
            : null,
      });
    }
  }
  const jobs: Array<{ jobId: string; jobName: string; jobNumber: number | null }> = [];
  const seen = new Set<string>();
  for (const j of SHARED_JOBS) {
    jobs.push({ jobId: j.jobId, jobName: j.title, jobNumber: j.jobNumber ?? null });
    seen.add(j.jobId);
  }
  for (const j of JOBS) {
    if (seen.has(j.jobId)) continue;
    jobs.push({ jobId: j.jobId, jobName: j.title, jobNumber: j.jobNumber ?? null });
    seen.add(j.jobId);
  }
  for (const item of items) {
    const id = String(item.jobId ?? '');
    if (!id || seen.has(id)) continue;
    jobs.push({
      jobId: id,
      jobName: String(item.jobName ?? 'Job'),
      jobNumber: (item.jobNumber as number | null) ?? null,
    });
    seen.add(id);
  }
  return {
    items,
    jobs,
    counts: {
      total: items.length,
      flagged: items.filter((i) => i.flagged).length,
      unanalysed: items.filter((i) => i.analysisState !== 'done' && i.analysisState !== 'paired')
        .length,
      onHold: items.filter((i) => i.legalHold).length,
    },
  };
}

const CUSTODY: Record<string, any[]> = {
  'pf-4': [
    { id: 'cu-1', action: 'held', actor_label: 'Priya Shah', actor_role: 'general_contractor', detail: 'Disputed day — mediation pending', occurred_at: '2026-08-06T09:20:00Z' },
    { id: 'cu-2', action: 'viewed', actor_label: 'Priya Shah', actor_role: 'general_contractor', detail: 'after · 2026-08-04', occurred_at: '2026-08-06T09:15:00Z' },
    { id: 'cu-3', action: 'viewed', actor_label: 'Tom Reyes', actor_role: 'general_contractor', detail: 'after · 2026-08-04', occurred_at: '2026-08-05T16:02:00Z' },
    { id: 'cu-4', action: 'analysed', actor_label: 'Atmosphere', actor_role: null, detail: 'Frames read; two videos do not appear to show the same building', occurred_at: '2026-08-04T22:44:00Z' },
    { id: 'cu-5', action: 'uploaded', actor_label: 'Hector Delgado, Delgado Roofing', actor_role: 'subcontractor', detail: 'after · 2026-08-04', occurred_at: '2026-08-04T22:40:00Z' },
  ],
  'pf-2': [
    { id: 'cu-6', action: 'viewed', actor_label: 'Priya Shah', actor_role: 'general_contractor', detail: 'after · 2026-08-05', occurred_at: '2026-08-06T07:41:00Z' },
    { id: 'cu-7', action: 'analysed', actor_label: 'Atmosphere', actor_role: null, detail: 'Frames read against 5 scope lines', occurred_at: '2026-08-05T20:55:00Z' },
    { id: 'cu-8', action: 'uploaded', actor_label: 'Hector Delgado, Delgado Roofing', actor_role: 'subcontractor', detail: 'after · 2026-08-05', occurred_at: '2026-08-05T20:51:00Z' },
  ],
};

/**
 * Verifier shares: who outside holds a way into each job's evidence. One
 * working link (opened, expiring), one revoked (the audit trail of an act),
 * and Meridian's adjuster — the story the platform demo tells from the
 * other side.
 */
const VERIFIER_SHARES: Array<Record<string, any>> = [
  { id: 'vs-1', jobId: 'job-1038', kind: 'evidence', label: 'M. Rhodes — TDI appraisal', recipientEmail: 'm.rhodes@tdi-appraisal.com', path: '/verifier/shared/demo-rhodes', createdAt: '2026-07-22T15:00:00Z', expiresAt: '2026-09-01T00:00:00Z', revokedAt: null, lastOpenedAt: '2026-08-03T10:15:00Z', openCount: 3, state: 'live' },
  { id: 'vs-2', jobId: 'job-1038', kind: 'evidence', label: 'Halcyon PA Group', recipientEmail: 'files@halcyonpa.com', path: '/verifier/shared/demo-halcyon', createdAt: '2026-07-18T09:00:00Z', expiresAt: null, revokedAt: '2026-07-30T16:40:00Z', lastOpenedAt: '2026-07-19T08:20:00Z', openCount: 1, state: 'revoked' },
  { id: 'vs-3', jobId: 'job-1041', kind: 'evidence', label: 'R. Calloway — Alliance Mutual', recipientEmail: 'r.calloway@alliancemutual.com', path: '/verifier/shared/demo-calloway', createdAt: '2026-07-28T12:00:00Z', expiresAt: '2026-09-06T00:00:00Z', revokedAt: null, lastOpenedAt: '2026-08-04T11:15:00Z', openCount: 5, state: 'live' },
  { id: 'vs-4', jobId: 'job-1038', kind: 'progress', label: 'Cedar Ridge HOA — homeowner', recipientEmail: 'board@cedarridgehoa.org', path: '/progress/demo-homeowner', createdAt: '2026-08-01T09:00:00Z', expiresAt: '2026-10-01T00:00:00Z', revokedAt: null, lastOpenedAt: '2026-08-05T14:20:00Z', openCount: 2, state: 'live' },
  { id: 'vs-5', jobId: 'job-1038', kind: 'progress', label: 'Halcyon PA — counsel', recipientEmail: null, path: '/progress/demo-counsel', createdAt: '2026-07-29T11:00:00Z', expiresAt: null, revokedAt: null, lastOpenedAt: null, openCount: 0, state: 'live' },
];

/** Addresses the demo treats as already holding an Atmosphere account. */
const KNOWN_ACCOUNTS = new Set([
  'r.calloway@alliancemutual.com',
  'm.rhodes@tdi-appraisal.com',
  'priya@ortizrestoration.com',
]);

/**
 * Scope documents: upload → the model reads → a person confirms. The demo
 * extraction lands after a beat, with one line the reader should distrust
 * (a hedge in the note) and one thing it could not read — because the
 * honest failure modes are part of the design.
 */
const SCOPE_DOCS: Record<string, any> = {};

const SCOPE_DOC_PROPOSAL = {
  lines: [
    { title: 'Remove temporary roof tarp', state: 'included', reason: null, amount: 450, note: null },
    { title: 'Strip north slope to decking', state: 'included', reason: null, amount: 4800, note: 'p.2 — "as required"' },
    { title: 'Replace damaged decking', state: 'included', reason: null, amount: 1860, note: 'quantity given as "up to 8 sheets"' },
    { title: 'Install synthetic underlayment', state: 'included', reason: null, amount: 1240, note: null },
    { title: 'Skylights', state: 'excluded', reason: 'Carrier declined — owner handling separately', amount: null, note: null },
  ],
  couldNotRead: ['Page 4 is a photograph of a handwritten change order — illegible in the scan.'],
};

/* ---- Job intake and readiness ---------------------------------------------
 *
 * The demo's default job is deliberately not perfect: it has scope and an
 * address, but the address was typed and never resolved to a point, so
 * readiness reports "work only — no location" rather than a clean pass. A
 * demo where everything is already green teaches nothing about the one thing
 * this panel exists to say.
 */
const MANUAL_JOBS: Record<string, any> = {};

const DEMO_JOB_FACTS: Record<string, any> = {
  default: {
    hasAddress: true,
    hasCoordinates: false,
    scopeLineCount: 6,
    scheduledStart: '2026-08-14T13:00:00Z',
    source: 'crm_sync',
  },
};

const SOURCE_WORD: Record<string, string> = {
  crm_sync: 'synced from your CRM',
  scope_document: 'read from an uploaded document',
  manual: 'entered by hand',
};

/**
 * The same rules the backend applies, in miniature.
 *
 * Kept deliberately small: the real logic lives in one tested module on the
 * server, and a demo that reimplements it in full would drift from it. What
 * this needs to reproduce is the shape — a ceiling, gaps that name their
 * price, and the fact that nothing here ever stops a crew filming.
 */
function readinessFor(jobId: string) {
  const scopeDoc = Object.values(SCOPE_DOCS).find((d: any) => d?.status === 'confirmed');
  const base = MANUAL_JOBS[jobId] ?? {
    ...DEMO_JOB_FACTS.default,
    scopeLineCount: DEMO_JOB_FACTS.default.scopeLineCount + (scopeDoc ? 4 : 0),
    source: scopeDoc ? 'scope_document' : DEMO_JOB_FACTS.default.source,
  };

  const gaps: Array<Record<string, any>> = [];
  const strengths: string[] = [];

  if (!base.scopeLineCount) {
    gaps.push({
      key: 'scope',
      what: 'No scope of work',
      costs: 'Footage will be sealed and filed, but nothing is judged — there is no agreed list of work to check it against.',
      fix: 'Upload the work order or estimate, or type the lines. Either one takes a minute and unlocks every verdict.',
      severity: 'blocking',
    });
  } else {
    strengths.push(`${base.scopeLineCount} scope line${base.scopeLineCount === 1 ? '' : 's'}`);
  }

  if (!base.hasAddress) {
    gaps.push({
      key: 'address',
      what: 'No site address',
      costs: 'Every clip will read "location unknown" — the on-site check cannot run without somewhere to check against.',
      fix: 'Add the address. If the job came from your CRM, the property record may already have one.',
      severity: 'weakening',
    });
  } else if (!base.hasCoordinates) {
    gaps.push({
      key: 'coordinates',
      what: 'Address not placed on the map',
      costs: 'The on-site check needs coordinates, not a street line, so it will not run and clips will read "location unknown".',
      fix: 'Confirm the address so it can be resolved to a point.',
      severity: 'weakening',
    });
  } else {
    strengths.push('Address placed, so on-site can be checked');
  }

  if (!base.scheduledStart) {
    gaps.push({
      key: 'schedule',
      what: 'Not scheduled',
      costs: "The job will not appear in anyone's day, so a crew has to be told about it some other way.",
      fix: 'Set a start date.',
      severity: 'weakening',
    });
  } else {
    strengths.push("Scheduled, so it shows up in the crew's day");
  }

  const blocked = gaps.some((g) => g.severity === 'blocking');
  const placeKnown = base.hasAddress && base.hasCoordinates;
  const ceiling = blocked ? 'filed_only' : placeKnown ? 'full' : 'work_only';
  const provenance = base.source ? ` This job was ${SOURCE_WORD[base.source]}.` : '';

  const headline = blocked
    ? `Film it — the footage will be sealed and filed. Nothing will be verified yet, because this job has no scope to check against.${provenance}`
    : placeKnown && !gaps.length
      ? `Ready to verify. Footage can establish the work, the place and the time.${provenance}`
      : `Film it — the work can be verified. What is missing is the place, so clips will read "location unknown".${provenance}`;

  return {
    level: blocked ? 'blocked' : gaps.length ? 'limited' : 'ready',
    ceiling,
    headline,
    gaps,
    strengths,
    source: base.source ?? null,
  };
}

/* ---- The subcontractor across general contractors -------------------------
 *
 * The point of the fixture is the shape of the problem: this crew works for
 * three different GCs, and two of those jobs are today. That is the pile of
 * text messages the feature replaces.
 */
const FIELD_DEMO_CODE = '204815';
const FIELD_CLAIM: { contact: string | null; session: string | null } = { contact: null, session: null };

function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function inDays(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function fieldJobList() {
  const jobs = [
    {
      partyId: 'fp-1',
      accessToken: 'demo-token',
      orgId: 'org-brightwater',
      orgName: 'Brightwater Restoration',
      jobId: 'job-anderson',
      jobTitle: 'Anderson residence — roof',
      jobNumber: 4471,
      address: '18 Larkspur Ln, Cedar Park',
      scheduledStart: todayAt(7),
      status: 'in_progress',
      trade: 'roofing',
      revoked: false,
    },
    {
      partyId: 'fp-2',
      accessToken: 'demo-token',
      orgId: 'org-kestrel',
      orgName: 'Kestrel Builders',
      jobId: 'job-holloway',
      jobTitle: 'Holloway duplex — water damage',
      jobNumber: 209,
      address: '4402 Sunfield Dr, Round Rock',
      scheduledStart: todayAt(13),
      status: 'in_progress',
      trade: 'drywall',
      revoked: false,
    },
    {
      partyId: 'fp-3',
      accessToken: 'demo-token',
      orgId: 'org-brightwater',
      orgName: 'Brightwater Restoration',
      jobId: 'job-pell',
      jobTitle: 'Pell warehouse — interior',
      jobNumber: 4488,
      address: '1200 Commerce Way, Austin',
      scheduledStart: inDays(2, 8),
      status: 'scheduled',
      trade: 'drywall',
      revoked: false,
    },
    {
      partyId: 'fp-4',
      accessToken: 'demo-token',
      orgId: 'org-tallgrass',
      orgName: 'Tallgrass General',
      jobId: 'job-mercer',
      jobTitle: 'Mercer remodel — phase 2',
      jobNumber: 88,
      address: '77 Verbena St, Georgetown',
      scheduledStart: inDays(5, 9),
      status: 'scheduled',
      trade: 'drywall',
      revoked: false,
    },
  ];

  const byOrg = new Map<string, any>();
  for (const job of jobs) {
    if (!byOrg.has(job.orgId)) byOrg.set(job.orgId, { orgId: job.orgId, orgName: job.orgName, jobs: [] });
    byOrg.get(job.orgId).jobs.push(job);
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);

  return {
    identity: {
      displayName: "Mike's Drywall",
      contact: FIELD_CLAIM.contact ?? 'mike@mikesdrywall.co',
      channel: (FIELD_CLAIM.contact ?? '').includes('@') || !FIELD_CLAIM.contact ? 'email' : 'sms',
    },
    generalContractors: [...byOrg.values()],
    today: jobs.filter((j) => {
      const t = new Date(j.scheduledStart).getTime();
      return t >= start.getTime() && t < end.getTime();
    }),
  };
}

/** Invitations: one waiting, one answered, one withdrawn. */
const ORG_INVITES: Array<Record<string, any>> = [
  { id: 'inv-1', email: 'kai.osei@example.com', role: 'field_technician', note: null, status: 'pending', createdAt: '2026-08-04T09:00:00Z', joinedAt: null, revokedAt: null },
  { id: 'inv-2', email: 'elena@ortizrestoration.com', role: 'accountant', note: null, status: 'joined', createdAt: '2026-07-02T10:00:00Z', joinedAt: '2026-07-03T08:15:00Z', revokedAt: null },
  { id: 'inv-3', email: 'wrong.address@example.com', role: 'sales', note: null, status: 'revoked', createdAt: '2026-07-20T14:00:00Z', joinedAt: null, revokedAt: '2026-07-20T14:05:00Z' },
];

/* ---- Purchasing ----------------------------------------------------------
 * One placed order (the record it leaves behind) and one draft awaiting
 * approval (the gate itself). Both stores read as not connected because the
 * store APIs are pending — the demo shows the honest path: approve, order at
 * the pro desk, record the number.
 */

const PURCHASING_SOURCES: Array<Record<string, any>> = [
  { estimateId: 'est-1041', jobName: 'Meridian Ave — water loss, Class 3', claimNumber: 'CLM-88412', total: 18420, createdAt: '2026-07-30T16:20:00Z' },
  { estimateId: 'est-1042', jobName: 'Harbor Point Condos — mold remediation, unit 4B', claimNumber: null, total: 9200, createdAt: '2026-07-31T11:05:00Z' },
];

const TAKEOFF_LINES: Record<string, Array<Record<string, any>>> = {
  'est-1041': [
    { materialKey: 'drywall_half', description: 'Drywall, 1/2 in', detail: '4 × 8 ft sheet (32 SF)', orderUnit: 'sheet', quantity: 6, estUnitPrice: 16.5, estTotal: 99, sourceSummary: '164 SF — Tear out wet drywall — flood cut (Master bedroom, Hallway)', sourceLineIds: ['li-1', 'li-2'] },
    { materialKey: 'joint_compound', description: 'Joint compound, all-purpose', detail: '4.5 gal bucket (~450 SF)', orderUnit: 'bucket', quantity: 1, estUnitPrice: 18.5, estTotal: 18.5, sourceSummary: '164 SF of drywall going back', sourceLineIds: ['li-1', 'li-2'] },
    { materialKey: 'drywall_tape', description: 'Drywall joint tape', detail: '500 ft roll (~400 SF)', orderUnit: 'roll', quantity: 1, estUnitPrice: 9, estTotal: 9, sourceSummary: '164 SF of drywall going back', sourceLineIds: ['li-1', 'li-2'] },
    { materialKey: 'drywall_screws', description: 'Drywall screws, 1-1/4 in', detail: '1 lb box (~250 SF)', orderUnit: 'box', quantity: 1, estUnitPrice: 9.5, estTotal: 9.5, sourceSummary: '164 SF of drywall going back', sourceLineIds: ['li-1', 'li-2'] },
    { materialKey: 'insulation_r13', description: 'Wall insulation, R-13 kraft-faced', detail: 'batt bag (~40 SF)', orderUnit: 'bag', quantity: 3, estUnitPrice: 28, estTotal: 84, sourceSummary: '96 SF — Tear out wet insulation (Master bedroom)', sourceLineIds: ['li-3'] },
    { materialKey: 'baseboard_mdf', description: 'Baseboard, primed MDF 3-1/4 in', detail: '8 ft length', orderUnit: 'stick', quantity: 9, estUnitPrice: 11, estTotal: 99, sourceSummary: '62 LF — Tear out wet baseboard (Master bedroom, Hallway)', sourceLineIds: ['li-4', 'li-5'] },
    { materialKey: 'paintable_caulk', description: 'Paintable latex caulk', detail: '10 oz tube (~100 LF)', orderUnit: 'tube', quantity: 1, estUnitPrice: 4, estTotal: 4, sourceSummary: '62 LF of baseboard going back', sourceLineIds: ['li-4', 'li-5'] },
    { materialKey: 'poly_6mil', description: 'Poly sheeting, 6 mil', detail: '10 × 100 ft roll (1000 SF)', orderUnit: 'roll', quantity: 1, estUnitPrice: 95, estTotal: 95, sourceSummary: '240 SF — Containment barrier / zipper wall (Hallway)', sourceLineIds: ['li-6'] },
    { materialKey: 'zipper_door', description: 'Containment zipper door kit', detail: 'two heavy-duty zippers per kit', orderUnit: 'kit', quantity: 1, estUnitPrice: 22, estTotal: 22, sourceSummary: '240 SF — Containment barrier / zipper wall (Hallway)', sourceLineIds: ['li-6'] },
    { materialKey: 'contractor_bags', description: 'Contractor bags, 42 gal 3 mil', detail: '20-count box', orderUnit: 'box', quantity: 1, estUnitPrice: 23, estTotal: 23, sourceSummary: '424 SF of tear-out debris across four trades', sourceLineIds: ['li-1', 'li-2', 'li-3', 'li-4'] },
    { materialKey: 'ppe_day_kit', description: 'PPE — suit, gloves, respirator cartridges', detail: 'per technician-day', orderUnit: 'kit', quantity: 6, estUnitPrice: 24, estTotal: 144, sourceSummary: '6 DA — Personal protective equipment (Cat 3 water)', sourceLineIds: ['li-7'] },
  ],
  'est-1042': [
    { materialKey: 'poly_6mil', description: 'Poly sheeting, 6 mil', detail: '10 × 100 ft roll (1000 SF)', orderUnit: 'roll', quantity: 2, estUnitPrice: 95, estTotal: 190, sourceSummary: '1520 SF — Containment barrier / zipper wall (unit 4B, corridor)', sourceLineIds: ['li-20'] },
    { materialKey: 'zipper_door', description: 'Containment zipper door kit', detail: 'two heavy-duty zippers per kit', orderUnit: 'kit', quantity: 4, estUnitPrice: 22, estTotal: 88, sourceSummary: '1520 SF — Containment barrier / zipper wall (unit 4B, corridor)', sourceLineIds: ['li-20'] },
    { materialKey: 'floor_film', description: 'Floor protection film, self-adhesive', detail: '24 in × 200 ft roll (400 SF)', orderUnit: 'roll', quantity: 1, estUnitPrice: 47, estTotal: 47, sourceSummary: '380 SF — Floor protection (corridor route)', sourceLineIds: ['li-21'] },
    { materialKey: 'contractor_bags', description: 'Contractor bags, 42 gal 3 mil', detail: '20-count box', orderUnit: 'box', quantity: 1, estUnitPrice: 23, estTotal: 23, sourceSummary: '310 SF of tear-out debris', sourceLineIds: ['li-22'] },
    { materialKey: 'ppe_day_kit', description: 'PPE — suit, gloves, respirator cartridges', detail: 'per technician-day', orderUnit: 'kit', quantity: 8, estUnitPrice: 24, estTotal: 192, sourceSummary: '8 DA — Personal protective equipment (microbial)', sourceLineIds: ['li-23'] },
  ],
};

const TAKEOFFS: Record<string, Record<string, any>> = {
  'est-1041': {
    lines: TAKEOFF_LINES['est-1041'],
    noMaterials: [
      { catalogKey: 'WTRDHMLGR', description: 'Dehumidifier — large (per 24 hour period)', reason: 'drying equipment, billed by the day' },
      { catalogKey: 'WTRAMH', description: 'Air mover (per 24 hour period)', reason: 'drying equipment, billed by the day' },
      { catalogKey: 'WTRXTRC', description: 'Water extraction from carpeted floor', reason: 'extraction — equipment and labour' },
      { catalogKey: 'WTRDRY', description: 'Daily monitoring visit', reason: 'monitoring labour' },
    ],
    unmapped: [],
    zeroQuantity: 0,
    estTotal: 607.5,
  },
  'est-1042': {
    lines: TAKEOFF_LINES['est-1042'],
    noMaterials: [
      { catalogKey: 'CLNHEPAV', description: 'HEPA vacuuming', reason: 'equipment and labour' },
      { catalogKey: 'CLNAM', description: 'Air scrubber (per 24 hour period)', reason: 'equipment, billed by the day' },
      { catalogKey: 'DMONEGP', description: 'Negative pressure setup and monitoring', reason: 'equipment setup' },
    ],
    unmapped: [
      { catalogKey: 'CLNANTIMIC', description: 'Apply antimicrobial agent', quantity: 480, unit: 'SF' },
    ],
    zeroQuantity: 0,
    estTotal: 540,
  },
};

const takeoffToPoLines = (estimateId: string, poId: string): Array<Record<string, any>> =>
  (TAKEOFF_LINES[estimateId] ?? []).map((l, i) => ({
    id: `pol-${poId}-${i}`,
    materialKey: l.materialKey,
    description: l.description,
    detail: l.detail,
    quantity: l.quantity,
    unit: l.orderUnit,
    unitPrice: l.estUnitPrice,
    priceBasis: 'estimate',
    sourceSummary: l.sourceSummary,
  }));

const PURCHASE_ORDERS: Array<Record<string, any>> = [
  { id: 'po-2', estimateId: 'est-1042', jobName: 'Harbor Point Condos — mold remediation, unit 4B', claimNumber: null, supplier: 'lowes', vendorAccountId: null, status: 'draft', approvedBy: null, approvedAt: null, placedAt: null, externalRef: null, note: null, createdAt: '2026-08-02T08:30:00Z', updatedAt: '2026-08-02T08:30:00Z' },
  { id: 'po-1', estimateId: 'est-1041', jobName: 'Meridian Ave — water loss, Class 3', claimNumber: 'CLM-88412', supplier: 'home_depot', vendorAccountId: null, status: 'placed', approvedBy: 'demo-user-1', approvedAt: '2026-07-31T09:12:00Z', placedAt: '2026-07-31T09:40:00Z', externalRef: 'HD-7203-4415', note: 'Pickup — Burnet Rd pro desk, 7am', createdAt: '2026-07-30T17:01:00Z', updatedAt: '2026-07-31T09:40:00Z' },
];

const PO_LINES: Record<string, Array<Record<string, any>>> = {
  'po-1': takeoffToPoLines('est-1041', 'po-1'),
  'po-2': takeoffToPoLines('est-1042', 'po-2'),
};

const PO_EVENTS: Record<string, Array<Record<string, any>>> = {
  'po-1': [
    { id: 'poe-1', actorName: 'Tom Reyes', action: 'created', detail: '11 lines, estimated $607.00, from Meridian Ave — water loss, Class 3', at: '2026-07-30T17:01:00Z' },
    { id: 'poe-2', actorName: 'Dana Ortiz', action: 'approved', detail: 'estimated $607.00', at: '2026-07-31T09:12:00Z' },
    { id: 'poe-3', actorName: 'Dana Ortiz', action: 'placed', detail: 'recorded — ordered outside Atmosphere, ref HD-7203-4415', at: '2026-07-31T09:40:00Z' },
  ],
  'po-2': [
    { id: 'poe-4', actorName: 'Dana Ortiz', action: 'created', detail: '5 lines, estimated $540.00, from Harbor Point Condos — mold remediation, unit 4B', at: '2026-08-02T08:30:00Z' },
  ],
};

const SUPPLIER_STATUS: Array<Record<string, any>> = [
  { id: 'home_depot', label: 'The Home Depot', connected: false, accountLabel: null, connectedAt: null },
  { id: 'lowes', label: "Lowe's", connected: false, accountLabel: null, connectedAt: null },
];

const poTotal = (lines: Array<Record<string, any>>) =>
  Math.round(lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 0), 0) * 100) / 100;

/**
 * Saving an estimate on the Estimating tab registers it as a purchasing
 * source, so "Order the materials" lands on a takeoff that exists — the same
 * automatic flow the live backend gets from both features reading
 * estimator_estimates.
 */
function registerDemoEstimateSource(estimateId: string) {
  if (!PURCHASING_SOURCES.some((s) => s.estimateId === estimateId)) {
    PURCHASING_SOURCES.unshift({
      estimateId,
      jobName: DEMO_ESTIMATE.assessment?.propertyAddress ?? 'Demo estimate',
      claimNumber: DEMO_ESTIMATE.assessment?.claimNumber ?? null,
      total: DEMO_ESTIMATE.lineItems.reduce((sum: number, l: any) => sum + (l.rcv ?? 0), 0),
      createdAt: new Date().toISOString(),
    });
  }
  TAKEOFFS[estimateId] = DEMO_ESTIMATE_TAKEOFF;
  TAKEOFF_LINES[estimateId] = DEMO_ESTIMATE_TAKEOFF.lines;
}

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

/** Handlers that need the query string get it here, since Handler takes only the path match. */
const LAST_QUERY: { leadId?: string; scope?: string; phase?: string; jobId?: string; kind?: string; mine?: string; status?: string } = {};

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

/** Symbility connection — stateful so the demo connect flow actually connects. */
/** The filming shot list, phase-worded like the backend's captureGuide.ts. */
function demoCaptureGuide(phase: string) {
  const before = phase !== 'after';
  return {
    phase: before ? 'before' : 'after',
    targetSeconds: 95,
    steps: [
      {
        kind: 'anchor',
        instruction:
          'Start outside, facing the front of the building. Hold steady for a few seconds \u2014 get the house number, the mailbox, or anything that makes the property unmistakable.',
        why: 'The first thing verification does is prove this footage is this site. A video that opens indoors could be any building anywhere, and every check after that is weaker for it.',
      },
      {
        kind: 'scope',
        instruction: before
          ? 'Walk the area for \u201cStrip north slope to decking\u201d before touching it. Slow pan, arm\u2019s length, corners included.'
          : 'Show the finished state of \u201cStrip north slope to decking\u201d. Slow pan across the whole area \u2014 the edges matter more than the middle.',
        why: before
          ? 'The before is the baseline the after gets compared against. An area skipped now cannot show change later.'
          : 'The comparison can only credit what it can see. Work off-camera reads as work not done.',
      },
      {
        kind: 'scope',
        instruction: before
          ? 'Walk the area for \u201cInstall synthetic underlayment\u201d before touching it. Slow pan, arm\u2019s length, corners included.'
          : 'Show the finished state of \u201cInstall synthetic underlayment\u201d. Slow pan across the whole area \u2014 the edges matter more than the middle.',
        why: before
          ? 'The before is the baseline the after gets compared against. An area skipped now cannot show change later.'
          : 'The comparison can only credit what it can see. Work off-camera reads as work not done.',
      },
      {
        kind: 'exclusion',
        instruction: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d \u2014 and film it untouched. (Carrier pulled them out of scope)',
        why: 'The day somebody asks whether you touched it, the answer is this timestamped pan of it intact.',
      },
      {
        kind: 'wrap',
        instruction: before
          ? 'Finish on anything unexpected you found \u2014 damage, water, access problems. Keep location on for the whole clip.'
          : 'Finish on any meter or reading in use \u2014 numbers on camera count as documentation. Then stop recording before you leave the site.',
        why: before
          ? 'A surprise filmed at 7am is a change order. The same surprise mentioned at 5pm is an argument.'
          : 'A reading in the video is evidence; a reading remembered later is a claim.',
      },
    ],
  };
}

const SYMBILITY_STATE: {
  connected: boolean;
  username: string | null;
  scopes: string[];
  grantedAt: string;
} = { connected: false, username: null, scopes: [], grantedAt: '' };

/**
 * CRM job sync: connect the CRM the customer already runs, and job files
 * create themselves. The first sync seeds three new job files and one
 * address conflict on Cedar Ridge — a job that already holds footage, so
 * the change waits for a person. Stateful, like the symbility connect.
 */
const CRM_SYNC_SYSTEMS_DEMO = [
  ['jobnimbus', 'JobNimbus'],
  ['acculynx', 'AccuLynx'],
  ['dash', 'CoreLogic Dash'],
  ['servicetitan', 'ServiceTitan'],
] as const;

const CRM_SYNC_STATE: {
  connected: Record<string, { accountLabel: string; connectedAt: string; lastSyncAt: string | null; lastSummary: any }>;
  conflicts: any[];
  seeded: boolean;
} = { connected: {}, conflicts: [], seeded: false };

function emptySharedRecord(
  jobId: string,
  jobNumber: number | null,
  title: string,
  claimNumber: string | null,
) {
  return {
    job: { id: jobId, jobNumber, title, status: 'in_progress', claimNumber },
    brief: null,
    revisions: [],
    currentRevision: null,
    parties: [],
    scope: [],
    messages: [],
    risks: [],
    money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  };
}

const XACTIMATE_STATUS: XactimateStatus = {
  connected: false, sessionActive: false, driver: 'mock', storageAvailable: true,
  webAutomationEnabled: false, username: null, scopes: [], storageMode: 'session',
  grantedAt: null, expiresAt: null, priceListId: null, availableScopes: [],
};

/* ------------------------------------------------------------ interceptor */

type HandlerResult = { status?: number; body: unknown };
type Handler = (
  match: RegExpMatchArray,
  body: Record<string, unknown>,
) => HandlerResult | Promise<HandlerResult>;

const routes: Array<[string, RegExp, Handler]> = [
  ['POST', /^\/api\/auth\/login$/, (_m, b) => {
    state.signedIn = true; state.onboarded = true;
    if (typeof b.email === 'string') state.email = b.email;
    return { body: { user: user() } };
  }],
  ['POST', /^\/api\/auth\/signup$/, (_m, b) => {
    state.signedIn = true; state.onboarded = false; state.fullName = null; state.avatarUrl = null;
    if (typeof b.email === 'string') state.email = b.email;
    return { body: { user: user(), needsEmailConfirmation: false } };
  }],
  ['POST', /^\/api\/field-app\/join$/, (_m, b) => {
    const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : '';
    const deviceId = typeof b.deviceId === 'string' ? b.deviceId.trim() : '';
    const joinCode = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
    if (fullName.split(/\s+/).filter(Boolean).length < 2) {
      return { status: 400, body: { error: 'Enter your first and last name', code: 'validation_error' } };
    }
    if (!/^[A-Z0-9]{6,12}$/.test(joinCode)) {
      return { status: 400, body: { error: 'Enter a valid join code', code: 'validation_error' } };
    }
    if (joinCode !== state.joinCode) {
      return { status: 400, body: { error: 'That join code did not match any organization.', code: 'join_org_failed' } };
    }
    state.signedIn = true;
    state.onboarded = true;
    if (fullName) state.fullName = fullName;
    return {
      status: 201,
      body: {
        user: user(),
        needsEmailConfirmation: false,
        session: { accessToken: 'demo-access', refreshToken: 'demo-refresh' },
        org: membership().org,
      },
    };
  }],
  ['POST', /^\/api\/field-app\/register$/, (_m, b) => {
    const email = typeof b.email === 'string' ? b.email : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const joinCode = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
    const orgName = typeof b.orgName === 'string' ? b.orgName.trim() : '';
    if (!email.includes('@') || password.length < 8) {
      return { status: 400, body: { error: 'Password must be at least 8 characters', code: 'validation_error' } };
    }
    if (!joinCode && orgName.length < 2) {
      return { status: 400, body: { error: 'Enter an office join code or a new office name.', code: 'validation_error' } };
    }
    if (joinCode && joinCode !== state.joinCode) {
      state.signedIn = true;
      state.onboarded = false;
      state.email = email;
      if (typeof b.fullName === 'string') state.fullName = b.fullName;
      return {
        status: 201,
        body: {
          user: user(),
          needsEmailConfirmation: false,
          session: { accessToken: 'demo-access', refreshToken: 'demo-refresh' },
          org: null,
          orgError: 'That join code did not match any organization.',
        },
      };
    }
    state.signedIn = true;
    state.onboarded = true;
    state.email = email;
    if (typeof b.fullName === 'string') state.fullName = b.fullName;
    if (orgName) state.orgName = orgName;
    return {
      status: 201,
      body: {
        user: user(),
        needsEmailConfirmation: false,
        session: { accessToken: 'demo-access', refreshToken: 'demo-refresh' },
        org: membership().org,
      },
    };
  }],
  ['POST', /^\/api\/field-app\/office\/preview$/, (_m, b) => {
    const joinCode = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
    if (joinCode !== state.joinCode) {
      return { status: 400, body: { error: 'That join code did not match any organization.', code: 'join_org_failed' } };
    }
    return { body: { org: { name: state.orgName, joinCode } } };
  }],
  ['POST', /^\/api\/field-app\/office$/, (_m, b) => {
    if (!state.signedIn) return { status: 401, body: { error: 'Not authenticated', code: 'unauthorized' } };
    const joinCode = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
    const orgName = typeof b.orgName === 'string' ? b.orgName.trim() : '';
    if (joinCode && joinCode !== state.joinCode) {
      return { status: 400, body: { error: 'That join code did not match any organization.', code: 'join_org_failed' } };
    }
    if (!joinCode && orgName.length < 2) {
      return { status: 400, body: { error: 'Enter an office join code or a new office name.', code: 'validation_error' } };
    }
    if (orgName) state.orgName = orgName;
    state.onboarded = true;
    return { status: 201, body: { org: membership().org } };
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
  ['POST', /^\/api\/profile\/avatar$/, (_m, b) => {
    const mediaType = typeof b.mediaType === 'string' ? b.mediaType : 'image/jpeg';
    const content = typeof b.contentBase64 === 'string' ? b.contentBase64 : '';
    state.avatarUrl = content ? `data:${mediaType};base64,${content}` : null;
    return { body: { profile: profile() } };
  }],
  ['DELETE', /^\/api\/profile\/avatar$/, () => {
    state.avatarUrl = null;
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
  ['GET', /^\/api\/jobs$/, () => {
    let jobs = JOBS;
    if (LAST_QUERY.mine === '1') {
      jobs = jobs.filter((job) => job.ownerId === user().id);
    }
    if (LAST_QUERY.status === 'in_progress') {
      jobs = jobs.filter((job) => job.status === 'in_progress');
    }
    return { body: { jobs } };
  }],

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
  ['GET', /^\/api\/billing\/onboarding$/, () => ({
    body: {
      paymentProvider: CATALOG.paymentProvider,
      required: false,
      complete: true,
      isCreator: true,
      hasSubscription: false,
      plan: {
        name: 'Work Verification',
        baseMonthlyFeeCents: 59900,
        includedJobs: 50,
        additionalJobPriceCents: 3000,
      },
    },
  })],
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

  /* ------------------------------------------- live crew positions */
  ['GET', /^\/api\/locations\/sharing$/, () => ({
    body: { sharing: SHARING.on, shareWindow: 'shift', decidedAt: SHARING.at },
  })],
  ['PUT', /^\/api\/locations\/sharing$/, (_m, b) => {
    SHARING.on = Boolean(b.sharing);
    SHARING.at = '2026-08-04T09:00:00Z';
    return { body: { sharing: SHARING.on, erased: SHARING.on ? undefined : 12 } };
  }],
  ['POST', /^\/api\/locations\/ping$/, () => ({ body: { recorded: SHARING.on } })],
  ['GET', /^\/api\/locations\/crew$/, () => ({
    body: {
      sharing: 3,
      items: [
        { userId: 'u-2', name: 'Ken Ohara', lat: 30.51, lon: -97.68, accuracyM: 12, headingDeg: 140, speedMps: 13.4, capturedAt: new Date(Date.now() - 60_000).toISOString(), nearestPlace: { name: 'Stony Point High School', miles: 1.2 }, territory: { id: 'terr-1', name: 'North Austin' } },
        { userId: 'u-3', name: 'Marisol Vega', lat: 30.27, lon: -97.74, accuracyM: 28, headingDeg: null, speedMps: 0, capturedAt: new Date(Date.now() - 7 * 60_000).toISOString(), nearestPlace: { name: 'Baylor Scott & White Medical Center', miles: 18.4 }, territory: { id: 'terr-2', name: 'Central Austin' } },
        { userId: 'u-4', name: 'Trey Boland', lat: 29.43, lon: -98.49, accuracyM: 1400, headingDeg: null, speedMps: 0, capturedAt: new Date(Date.now() - 22 * 60_000).toISOString(), nearestPlace: null, territory: null },
      ],
    },
  })],

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
      // Derived from the ZIPs in the territories below — TX and OK here,
      // because the demo org works both sides of the Red River.
      statesWatched: ['OK', 'TX'],
      zipsLocated: 9,
      zipsTotal: 11,
      alerts: [
        {
          id: 'urn:oid:2.49.0.1.840.0.demo1',
          event: 'Severe Thunderstorm Watch', severity: 'Severe', urgency: 'Future',
          headline: 'Severe Thunderstorm Watch until 10 PM CDT',
          areaDesc: 'Williamson; Travis',
          effective: null, onset: null, expires: null, group: 'hail',
          hoursOfNotice: 31,
          hasGeometry: true,
          // Exactly which codes are under the warned polygon — not "somewhere
          // in Williamson County".
          territories: [
            { id: 'terr-1', name: 'North Austin', zips: ['78664', '78681', '78717'], matchedBy: 'geometry' },
          ],
        },
        {
          id: 'urn:oid:2.49.0.1.840.0.demo2',
          event: 'Flood Watch', severity: 'Moderate', urgency: 'Expected',
          headline: null, areaDesc: 'Bexar',
          effective: null, onset: null, expires: null, group: 'flood',
          hoursOfNotice: 14, hasGeometry: false, territories: [],
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
          matchedZips: ['78664', '78681', '78717'],
          matchedBy: 'geometry',
          reason: 'Severe Thunderstorm Watch over 3 of your ZIP codes, about 31h out.',
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

  ['GET', /^\/api\/sales\/work$/, () => {
    const scope = LAST_QUERY.scope === 'all' ? 'all' : 'mine';
    // "Mine" is Dana's book; "Everyone" adds the jobs another rep owns.
    const jobs = scope === 'all'
      ? SALES_WORK_JOBS
      : SALES_WORK_JOBS.filter((j) => j.id !== 'job-1038');
    const ids = new Set(jobs.map((j) => j.id));
    return {
      body: {
        scope,
        jobs,
        latest: SALES_WORK_LATEST.filter((e) => ids.has(e.jobId)),
        counts: {
          open: jobs.filter((j) => j.open).length,
          onSite: jobs.filter((j) => j.status === 'in_progress').length,
          quiet: jobs.filter((j) => j.quiet).length,
          awaitingPayment: jobs.filter((j) => j.status === 'invoiced').length,
        },
      },
    };
  }],
  ['GET', /^\/api\/sales\/work\/([\w-]+)$/, (m) => {
    const job = SALES_WORK_JOBS.find((j) => j.id === m[1]);
    if (!job) return { status: 404, body: { error: 'job_not_found' } };
    const extra = SALES_WORK_TIMELINES[job.id] ?? { crew: [], timeline: [], scheduledEnd: null };
    return {
      body: {
        job: { ...job, workType: 'restoration', scheduledEnd: extra.scheduledEnd, actualStart: null, actualEnd: null, paidAmount: 0 },
        delivery: extra.delivery ?? null,
        suggestedUpdate: extra.suggestedUpdate ?? { subject: `Update on your ${job.title.toLowerCase()}`, body: 'Hi there,\n\n— Dana Ortiz' },
        recipients: extra.recipients ?? [],
        sends: extra.sends ?? [],
        crew: extra.crew,
        timeline: extra.timeline,
      },
    };
  }],

  ['POST', /^\/api\/sales\/work\/([\w-]+)\/update$/, (_m, b) => {
    // Same two-step as the live route: a check that screens, then a send.
    const to = String(b.to ?? '');
    const stopped = OUTREACH_PEOPLE.find((p) => p.email === to && (p.unsubscribed || p.suppressed));
    if (!b.confirm) {
      return {
        body: {
          dryRun: true,
          wouldSend: stopped ? 0 : 1,
          blocked: stopped ? [{ email: to, reason: stopped.unsubscribed ? 'unsubscribed' : 'suppressed' }] : [],
          warnings: [],
        },
      };
    }
    if (stopped) return { body: { sent: 0, blocked: [{ email: to, reason: 'unsubscribed' }] } };
    return { body: { sent: 1, blocked: [], from: 'dana@ortizrestoration.com', error: null } };
  }],

  ['GET', /^\/api\/sales\/communications$/, () => ({
    body: {
      people: OUTREACH_PEOPLE,
      totals: {
        people: OUTREACH_PEOPLE.length,
        messages: OUTREACH_PEOPLE.reduce((n, p) => n + p.messages, 0),
        bounced: OUTREACH_PEOPLE.reduce((n, p) => n + p.bounced, 0),
        optedOut: OUTREACH_PEOPLE.filter((p) => p.unsubscribed || p.suppressed).length,
      },
    },
  })],
  ['GET', /^\/api\/sales\/communications\/(.+)$/, (m) => {
    const email = decodeURIComponent(m[1]);
    return { body: { email, messages: OUTREACH_HISTORY[email] ?? [] } };
  }],

  /* ------------------------------------------- the sub's job link */
  ['GET', /^\/api\/job-share\/([\w-]+)\/capture-guide$/, () => ({
    body: { guide: demoCaptureGuide(LAST_QUERY.phase ?? 'before') },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/live-observe$/, (() => {
    // Cycles through the shot list so a demo recording watches the stage
    // chip advance the way a real walkthrough would.
    let tick = -1;
    const STAGES = [
      { stageIndex: 0, stageLabel: 'Start outside, facing the front of the building', stageKind: 'anchor', note: 'Front elevation in frame; hold a beat longer.', confidence: 0.86 },
      { stageIndex: 1, stageLabel: 'Walk the area for \u201cStrip north slope to decking\u201d', stageKind: 'scope', note: 'North slope in frame, panning left to right.', confidence: 0.78 },
      { stageIndex: 1, stageLabel: 'Walk the area for \u201cStrip north slope to decking\u201d', stageKind: 'scope', note: 'Close on the stripped decking at the valley.', confidence: 0.74 },
      { stageIndex: 3, stageLabel: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d', stageKind: 'exclusion', note: 'Skylights in frame, intact.', confidence: 0.81 },
      { stageIndex: 4, stageLabel: 'Finish on anything unexpected you found', stageKind: 'wrap', note: 'Moisture meter held to the lens; reading legible.', confidence: 0.7 },
    ];
    return () => {
      tick += 1;
      return { body: STAGES[Math.min(tick, STAGES.length - 1)] };
    };
  })()],
  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/capture-guide$/, () => ({
    body: { guide: demoCaptureGuide(LAST_QUERY.phase ?? 'before') },
  })],
  ['GET', /^\/api\/job-share\/([\w-]+)$/, (m) => {
    const view = SHARE_VIEW[m[1]] ?? SHARE_VIEW['demo-token'];
    return { body: view };
  }],
  ['GET', /^\/api\/job-share\/([\w-]+)\/proof$/, () => ({ body: { days: SHARE_PROOF_DAYS } })],
  ['POST', /^\/api\/job-share\/([\w-]+)\/accept$/, (m, b) => {
    const view = SHARE_VIEW[m[1]] ?? SHARE_VIEW['demo-token'];
    view.acknowledgedRevision = Number(b.revision ?? view.currentRevision);
    view.clear = view.acknowledgedRevision === view.currentRevision && !view.scope.some((s: any) => s.state === 'proposed');
    view.because = view.clear
      ? `Accepted revision ${view.currentRevision}. Nothing outstanding.`
      : '1 item waiting on an answer.';
    return { body: { ok: true, revision: view.currentRevision } };
  }],
  ['POST', /^\/api\/job-share\/([\w-]+)\/ask$/, (m, b) => {
    const view = SHARE_VIEW[m[1]] ?? SHARE_VIEW['demo-token'];
    view.messages.unshift({ id: `msg-${Date.now()}`, author_label: 'Hector Delgado, Delgado Roofing', body: String(b.body ?? ''), created_at: new Date().toISOString() });
    if (b.asScopeItem) {
      view.scope.unshift({ id: `sc-${Date.now()}`, state: 'proposed', title: String(b.asScopeItem), detail: String(b.body ?? ''), amount: null, reason: null });
    }
    return { status: 201, body: { message: view.messages[0], scopeItemId: null } };
  }],
  ['POST', /^\/api\/job-share\/([\w-]+)\/proof\/upload-url$/, (_m, b) => ({
    body: { path: `demo/${b.workDate}-${b.phase}.mp4`, token: 'demo-upload-token' },
  })],
  ['POST', /^\/api\/job-share\/([\w-]+)\/proof$/, (_m, b) => {
    const day = SHARE_PROOF_DAYS.find((d) => d.workDate === b.workDate) ?? { workDate: String(b.workDate), hasBefore: false, hasAfter: false, summary: '', problems: [] as string[], accepted: false };
    if (!SHARE_PROOF_DAYS.includes(day as any)) SHARE_PROOF_DAYS.unshift(day as any);
    if (b.phase === 'before') day.hasBefore = true;
    else day.hasAfter = true;
    // No location on a desktop browser, so the demo shows the honest outcome:
    // nothing wrong, and something that could not be checked.
    const problems = b.lat === undefined ? [] : [];
    day.problems = problems;
    day.summary = day.hasBefore && day.hasAfter ? 'Nothing contradicts it, but 2 things could not be checked.' : 'Started but not finished: no after video yet.';
    return { status: 201, body: { proof: { id: `pf-${Date.now()}` }, checks: [], problems } };
  }],

  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/evidence$/, (m) => {
    const items = EVIDENCE[m[1]] ?? [];
    return {
      body: {
        items,
        counts: {
          items: items.length,
          onHold: items.filter((i: any) => i.legalHold).length,
          neverViewed: items.filter((i: any) => i.viewCount === 0).length,
        },
      },
    };
  }],
  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/evidence\/([\w-]+)\/custody$/, (m) => ({
    body: { entries: CUSTODY[m[2]] ?? [] },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/evidence\/([\w-]+)\/hold$/, (m, b) => {
    const item = (EVIDENCE[m[1]] ?? []).find((i: any) => i.id === m[2]);
    if (item) {
      item.legalHold = Boolean(b.hold);
      item.retentionUntil = item.legalHold ? null : '2028-08-05';
    }
    (CUSTODY[m[2]] ??= []).unshift({
      id: `cu-${Date.now()}`,
      action: b.hold ? 'held' : 'released',
      actor_label: 'Dana Ortiz',
      actor_role: 'general_contractor',
      detail: (b.reason as string) ?? null,
      occurred_at: new Date().toISOString(),
    });
    return { body: { ok: true } };
  }],

  /* ------------------------------------------- scope documents */
  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/scope-doc$/, (m) => ({
    body: { doc: SCOPE_DOCS[m[1]] ?? null },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/scope-doc$/, (m, b) => {
    const doc = {
      id: `sd-${Date.now()}`,
      filename: String(b.filename ?? 'scope.pdf'),
      mediaType: String(b.mediaType ?? 'application/pdf'),
      byteSize: null,
      status: 'extracting',
      extracted: null,
      extractionError: null,
      confirmedAt: null,
      createdAt: new Date().toISOString(),
    };
    SCOPE_DOCS[m[1]] = doc;
    // The model "reads" for a beat, then the proposal lands.
    setTimeout(() => {
      if (SCOPE_DOCS[m[1]]?.id === doc.id) {
        SCOPE_DOCS[m[1]] = { ...doc, status: 'extracted', extracted: SCOPE_DOC_PROPOSAL };
      }
    }, 2200);
    return { status: 201, body: { doc } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/scope-doc\/([\w-]+)\/confirm$/, (m, b) => {
    const doc = SCOPE_DOCS[m[1]];
    if (!doc || doc.id !== m[2]) return { status: 404, body: { error: 'No such document.', code: 'not_found' } };
    if (doc.status !== 'extracted') return { status: 409, body: { error: 'Not ready.', code: 'not_extracted' } };
    const lines = Array.isArray(b.lines) ? b.lines : [];
    const record = SHARED_RECORDS[m[1]];
    if (record) {
      lines.forEach((line: any, i: number) => {
        record.scope.push({
          id: `sc-doc-${Date.now()}-${i}`,
          title: String(line.title),
          state: line.state === 'excluded' ? 'excluded' : 'included',
          reason: line.reason ?? null,
          detail: `From "${doc.filename}"`,
          amount: line.amount ?? null,
          created_at: new Date().toISOString(),
        });
      });
    }
    SCOPE_DOCS[m[1]] = { ...doc, status: 'confirmed', confirmedAt: new Date().toISOString() };
    return { body: { ok: true, created: lines.length } };
  }],

  /* ------------------------------------------- job readiness + intake */
  ['GET', /^\/api\/operations\/jobs\/([\w-]+)\/readiness$/, (m) => ({
    body: { readiness: readinessFor(m[1]) },
  })],
  ['POST', /^\/api\/operations\/jobs\/quick-start$/, (_m, b) => {
    const id = `job-manual-${Date.now()}`;
    const scope = Array.isArray(b.scope) ? b.scope : [];
    MANUAL_JOBS[id] = {
      hasAddress: Boolean(b.address),
      // The demo mirrors the real thing: an address that was typed has not
      // been resolved to a point yet, so on-site still cannot be checked.
      hasCoordinates: false,
      scopeLineCount: scope.length,
      scheduledStart: b.scheduledStart ?? null,
      source: 'manual',
    };
    return {
      status: 201,
      body: {
        job: { id, title: String(b.title ?? 'New job'), jobNumber: null },
        scopeSaved: scope.length,
        readiness: readinessFor(id),
      },
    };
  }],
  ['POST', /^\/api\/operations\/intake\/propose$/, (_m, b) => {
    const text = String(b.text ?? '');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^(\d+[.)]\s+|[-*•]\s+|do\s*not)/i.test(l))
      .slice(0, 20)
      .map((l) => {
        const excluded = /^do\s*not/i.test(l);
        const title = l
          .replace(/^(\d+[.)]\s+|[-*•]\s+)/, '')
          .replace(/^do\s*not\s*[:\-–]?\s*/i, '')
          .trim();
        return {
          title: title || l,
          state: excluded ? 'excluded' : 'included',
          reason: excluded ? 'Called out as exclusion in the source text.' : undefined,
        };
      });
    const typedAddress = String(b.address ?? '').trim();
    const addressLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\d{1,5}\s+\w+/.test(l) && /(Ave|St|Street|Rd|Road|Blvd|Dr|Court|Ct)\b/i.test(l));
    const address = (typedAddress || addressLine || '1842 Meridian Ave')
      .replace(/^(property|address|site)\s*[:\-]\s*/i, '')
      .slice(0, 200);
    const jobName = (address.split(',')[0] || address).trim();
    return {
      body: {
        proposal: {
          title: jobName,
          workType: /mitigat|water|flood/i.test(text) ? 'mitigation' : 'construction',
          address,
          city: 'Austin',
          postalCode: '78702',
          claimNumber: '',
          briefNote:
            'First published facts for the crew. Edit anything that looks wrong before you approve.',
          facts: { Site: address, Source: 'Scope / claim text (office intake)' },
          scope: lines.length
            ? lines
            : [{ title: 'Confirm scope with the office', state: 'included' }],
          party: {
            company: 'Field Capture',
            trade: 'field_capture',
            contactName: '',
          },
          source: 'heuristic',
          summary: `${lines.length || 1} scope lines drafted from your paste. Nothing is live until you approve and invite Field Capture.`,
        },
        captureTeam: MEMBERS.filter((m) => m.role === 'field_technician').map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
          email: m.email,
          role: m.role,
          workType: m.workType,
          selected: true,
        })),
      },
    };
  }],
  ['POST', /^\/api\/operations\/intake\/approve$/, (_m, b) => {
    const id = `job-intake-${Date.now()}`;
    const scope = Array.isArray(b.scope) ? b.scope : [];
    const invitees = Array.isArray(b.invitees) ? b.invitees : [];
    const people =
      invitees.length > 0
        ? invitees
        : [{ fullName: 'Field Capture', email: null, external: false }];
    const stamp = Date.now().toString(36);
    const knownAccounts = new Set(
      MEMBERS.map((m) => m.email?.toLowerCase()).filter((e): e is string => Boolean(e)),
    );
    const invites = people.map(
      (
        person: {
          fullName?: string;
          company?: string;
          email?: string | null;
          external?: boolean;
          userId?: string;
        },
        i: number,
      ) => {
        const token = `demo-intake-${stamp}-${i}`;
        const email = person.email ? String(person.email).toLowerCase() : null;
        const external = Boolean(person.external || !person.userId);
        const name = String(person.company || person.fullName || 'Field Capture');
        return {
          id: `party-${token}`,
          name,
          email,
          token,
          sharePath: jobSharePagePath(token, email),
          fieldCapturePath: `/fieldcapture/index.html?token=${encodeURIComponent(token)}`,
          external,
          emailed: Boolean(email),
          recipientHasAccount: Boolean(email && knownAccounts.has(email)),
          attachedToAccount: false,
        };
      },
    );
    const primary = invites[0]!;
    MANUAL_JOBS[id] = {
      hasAddress: Boolean(b.address),
      hasCoordinates: false,
      scopeLineCount: scope.length,
      scheduledStart: null,
      source: 'scope_document',
    };
    // Surface on the Dashboard and as an openable record in this demo session.
    const jobNumber = 9000 + (SHARED_JOBS.length % 900);
    const title = String(b.title ?? 'New job');
    SHARED_JOBS.unshift({
      jobId: id,
      jobNumber,
      title,
      status: 'scheduled',
      parties: invites.length,
      currentRevision: 1,
      behind: 0,
      awaiting: invites.length,
      exclusions: scope.filter((s: { state?: string }) => s.state === 'excluded').length,
    });
    const siteLine = [b.address, b.city, b.postalCode].filter(Boolean).join(', ');
    const facts: Record<string, string> =
      b.facts && typeof b.facts === 'object' && !Array.isArray(b.facts)
        ? { ...(b.facts as Record<string, string>) }
        : {};
    if (siteLine && !facts['Site address']) facts['Site address'] = siteLine;
    SHARED_RECORDS[id] = {
      job: {
        id,
        jobNumber,
        title,
        status: 'scheduled',
        claimNumber: (b.claimNumber as string | null) ?? null,
      },
      brief: {
        id: `br-${id}`,
        revision: 1,
        created_at: new Date().toISOString(),
        note: (b.briefNote as string | null) ?? null,
        facts,
      },
      revisions: [
        {
          revision: 1,
          note: (b.briefNote as string | null) ?? 'Intake approved.',
          createdAt: new Date().toISOString(),
        },
      ],
      currentRevision: 1,
      parties: invites.map((inv) => ({
        id: inv.id,
        company: inv.name,
        trade: 'field_capture',
        contactName: inv.name,
        email: inv.email,
        phone: null,
        role: 'subcontractor',
        invited_at: new Date().toISOString(),
        last_seen_at: null,
        revoked_at: null,
        acknowledgedRevision: null,
        clear: false,
        because: 'Invited from intake — waiting for them to accept the brief.',
      })),
      scope: scope.map((line: { title?: string; state?: string; reason?: string }, i: number) => ({
        id: `sc-${id}-${i}`,
        party_id: null,
        state: line.state ?? 'included',
        title: String(line.title ?? 'Scope line'),
        detail: null,
        amount: null,
        reason: line.reason ?? null,
        revision: 1,
        decided_at: null,
        created_at: new Date().toISOString(),
      })),
      money: { approved: 0, pending: 0, unpricedApprovals: 0 },
      messages: [],
      risks: [],
    };
    return {
      status: 201,
      body: {
        job: { id, title, jobNumber },
        briefRevision: 1,
        scopeSaved: scope.length,
        invites,
        jobFile: {
          jobId: id,
          jobNumber,
          title,
          status: 'scheduled',
          parties: invites.length,
          currentRevision: 1,
          behind: 0,
          awaiting: invites.length,
          exclusions: scope.filter((s: { state?: string }) => s.state === 'excluded').length,
        },
        party: { id: primary.id, company: primary.name },
        sharePath: primary.sharePath,
        fieldCapturePath: primary.fieldCapturePath,
        readiness: readinessFor(id),
      },
    };
  }],
  ['GET', /^\/api\/operations\/intake-mix$/, () => ({
    body: { counts: { crm_sync: 21, scope_document: 3, manual: 6 }, total: 30 },
  })],

  /* ------------------------------------------- the sub's own list */
  ['POST', /^\/api\/field\/claim\/start$/, (_m, b) => {
    const contact = String(b.contact ?? '');
    if (!contact.includes('@') && contact.replace(/\D/g, '').length < 10) {
      return {
        status: 400,
        body: { error: 'That does not look like a phone number or an email address.', code: 'bad_contact' },
      };
    }
    const email = contact.includes('@');
    FIELD_CLAIM.contact = contact;
    return {
      body: {
        sentTo: email ? contact : `···${contact.replace(/\D/g, '').slice(-4)}`,
        channel: email ? 'email' : 'sms',
        // Honest in the demo too: the SMS leg is not wired anywhere.
        delivered: email,
        deliveryNote: email ? null : 'Text messages are not switched on yet — use an email address instead.',
      },
    };
  }],
  ['POST', /^\/api\/field\/claim\/verify$/, (_m, b) => {
    if (String(b.code ?? '') !== FIELD_DEMO_CODE) {
      return { status: 400, body: { error: 'That code is not right.', code: 'wrong' } };
    }
    FIELD_CLAIM.session = 'demo-field-session';
    return { body: { session: FIELD_CLAIM.session, ...fieldJobList() } };
  }],
  ['GET', /^\/api\/field\/jobs$/, () => ({ body: fieldJobList() })],
  ['POST', /^\/api\/field\/signout$/, () => {
    FIELD_CLAIM.session = null;
    return { body: { ok: true } };
  }],

  /* ------------------------------------------- verifier shares */
  ['GET', /^\/api\/evidence-portal\/library$/, () => ({ body: evidencePortalLibrary() })],
  ['GET', /^\/api\/evidence-portal\/shares$/, () => {
    let shares = VERIFIER_SHARES;
    if (LAST_QUERY.jobId) shares = shares.filter((s) => s.jobId === LAST_QUERY.jobId);
    if (LAST_QUERY.kind) shares = shares.filter((s) => (s.kind ?? 'evidence') === LAST_QUERY.kind);
    return { body: { shares } };
  }],
  ['POST', /^\/api\/evidence-portal\/shares$/, (_m, b) => {
    const email = b.recipientEmail ? String(b.recipientEmail).toLowerCase() : null;
    const days = Number(b.expiresInDays ?? 30);
    const kind = b.kind === 'progress' ? 'progress' : 'evidence';
    const token = `demo-${Date.now().toString(36)}`;
    const share = {
      id: `vs-${Date.now()}`,
      jobId: String(b.jobId ?? ''),
      kind,
      label: String(b.label ?? ''),
      recipientEmail: email,
      path: kind === 'progress' ? `/progress/${token}` : `/verifier/shared/${token}`,
      createdAt: new Date().toISOString(),
      expiresAt: days === 0 ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      revokedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      state: 'live',
    };
    VERIFIER_SHARES.unshift(share);
    const emailed = email ? !email.includes('nomail') : false;
    return {
      status: 201,
      body: {
        share: { id: share.id, label: share.label, kind: share.kind, expiresAt: share.expiresAt, createdAt: share.createdAt, path: share.path },
        emailed,
        recipientHasAccount: email ? KNOWN_ACCOUNTS.has(email) : false,
      },
    };
  }],
  ['POST', /^\/api\/evidence-portal\/shares\/([\w-]+)\/revoke$/, (m) => {
    const share = VERIFIER_SHARES.find((s) => s.id === m[1]);
    if (share) {
      share.revokedAt = new Date().toISOString();
      share.state = 'revoked';
    }
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/evidence-portal\/evidence\/([^/]+)\/ask$/, (m, b) => {
    const question = String(b.question ?? '').trim();
    let found: { aiSummary?: string | null; workDate?: string } | undefined;
    for (const items of Object.values(EVIDENCE)) {
      found = (items as any[]).find((i) => i.id === m[1]);
      if (found) break;
    }
    const summary = found?.aiSummary;
    const happen = /did anything|anything happen|what (happened|work)|what is visible/i.test(question);
    const answer = !summary
      ? 'This clip has not been read yet, so there is nothing to answer from.'
      : happen
        ? `Yes — the footage${found?.workDate ? ` on ${found.workDate}` : ''} shows: ${summary}`
        : summary.toLowerCase().includes(question.toLowerCase().slice(0, 12))
          ? summary
          : 'The footage on file does not show that.';
    return { status: 201, body: { answer, model: null } };
  }],
  ['POST', /^\/api\/verifier-share\/([^/]+)\/evidence\/([^/]+)\/ask$/, (_m, b) => {
    const question = String(b.question ?? '').trim();
    const happen = /did anything|anything happen|what (happened|work)|what is visible/i.test(question);
    const answer = happen
      ? 'Yes — the footage on this shared clip shows the work described in the reading.'
      : 'The footage on file does not show that.';
    return { status: 201, body: { answer, model: null } };
  }],

  /* ------------------------------------------- progress shares (guest) */
  ['GET', /^\/api\/progress-share\/([\w-]+)$/, (m) => {
    const token = m[1];
    const share = VERIFIER_SHARES.find(
      (s) => s.kind === 'progress' && (s.path === `/progress/${token}` || s.path.endsWith(`/${token}`)),
    );
    if (!share) return { status: 404, body: { error: 'not_found', message: 'This link does not exist.' } };
    if (share.state === 'revoked') return { status: 410, body: { error: 'revoked', message: 'This link was revoked.' } };
    if (share.state === 'expired') return { status: 410, body: { error: 'expired', message: 'This link has expired.' } };
    const record = SHARED_RECORDS[share.jobId];
    const proofRecord = PROOF_DAYS[share.jobId] ?? { siteKnown: false, days: [] };
    const days = proofRecord.days ?? [];
    const scope = record?.scope ?? [];
    const actionable = scope.filter((item: any) => item.state !== 'excluded');
    const scopeApproved = actionable.filter((item: any) => item.state === 'approved').length;
    const scopePct = actionable.length ? Math.round((scopeApproved / actionable.length) * 100) : 0;
    share.openCount = (share.openCount ?? 0) + 1;
    share.lastOpenedAt = new Date().toISOString();
    return {
      body: {
        share: {
          label: share.label,
          expiresAt: share.expiresAt ?? null,
          recipientEmail: share.recipientEmail ?? null,
        },
        org: { name: 'Ortiz Restoration' },
        job: record?.job ?? null,
        progress: {
          scopePct,
          scopeApproved,
          scopeTotal: actionable.length,
          daysLogged: days.length,
          verifiedDays: days.filter((d: any) => d.payable || d.accepted).length,
          inProgress: days.filter((d: any) => d.hasBefore && !d.hasAfter).length,
        },
        proof: {
          days,
          counts: {
            days: days.length,
            payable: days.filter((d: any) => d.payable && !d.accepted).length,
            contradicted: days.filter((d: any) => d.contradicted).length,
            awaitingAfter: days.filter((d: any) => d.hasBefore && !d.hasAfter).length,
          },
          siteKnown: proofRecord.siteKnown ?? false,
        },
      },
    };
  }],
  ['GET', /^\/api\/progress-share\/([\w-]+)\/proof\/([\w-]+)\/video$/, () => ({
    body: { url: DEMO_CLIP, expiresInSeconds: 600 },
  })],

  /* ------------------------------------------- invitations */
  ['GET', /^\/api\/org\/invites$/, () => ({ body: { invites: ORG_INVITES } })],
  ['POST', /^\/api\/org\/invites$/, (_m, b) => {
    const invite = { id: `inv-${Date.now()}`, email: String(b.email ?? '').toLowerCase(), role: b.role ?? 'field_technician', note: b.note ?? null, status: 'pending', createdAt: new Date().toISOString(), joinedAt: null, revokedAt: null };
    ORG_INVITES.unshift(invite);
    // The demo has no connected mailbox, which is also day one in real life —
    // the panel's "send them the code yourself" path is the one worth showing.
    return { status: 201, body: { invite, emailed: false, joinCode: 'ORTIZ-4481' } };
  }],
  ['POST', /^\/api\/org\/invites\/([\w-]+)\/revoke$/, (m) => {
    const invite = ORG_INVITES.find((i) => i.id === m[1] && i.status === 'pending');
    if (!invite) return { status: 409, body: { error: 'That invitation is not pending — it was already answered or withdrawn.' } };
    invite.status = 'revoked';
    invite.revokedAt = new Date().toISOString();
    return { body: { ok: true } };
  }],

  /* ------------------------------------------- account structure */
  ['GET', /^\/api\/crm\/accounts\/duplicates$/, () => ({ body: { pairs: DUPLICATE_PAIRS } })],
  ['GET', /^\/api\/crm\/accounts\/([\w-]+)\/structure$/, (m) => {
    const found = ACCOUNT_STRUCTURE[m[1]];
    if (found) return { body: found };
    // Anything without a fixture still answers honestly: a top-level account
    // with nothing attached, which is what most of them are.
    const account = ACCOUNTS.find((a) => a.id === m[1]);
    return {
      body: {
        account: { id: m[1], name: account?.name ?? 'Account', type: account?.kind ?? null, parentAccountId: null, mergedIntoId: null, city: account?.city ?? null, region: account?.region ?? null },
        ancestors: [], children: [], subtreeSize: 1, links: [], people: [],
        rollup: { accounts: 1, jobs: 0, openJobs: 0, contractTotal: 0, invoicedTotal: 0, paidTotal: 0, ownJobs: 0 },
        mergedIn: [],
      },
    };
  }],
  ['POST', /^\/api\/crm\/accounts\/merge$/, (_m, b) => {
    const moved = { contacts: 2, jobs: 0, leads: 1, properties: 0, activities: 3, childAccounts: 0 };
    const total = Object.values(moved).reduce((x, y) => x + y, 0);
    if (!b.confirm) return { body: { dryRun: true, moved, total } };
    // The loser becomes a tombstone rather than disappearing.
    const loser = ACCOUNTS.findIndex((a) => a.id === b.loserId);
    if (loser >= 0) ACCOUNTS.splice(loser, 1);
    DUPLICATE_PAIRS.length = 0;
    return { body: { dryRun: false, moved, total } };
  }],

  /* ------------------------------------------- Address lookup (intake) */
  ['GET', /^\/api\/operations\/places\/status$/, () => ({
    body: { configured: true, provider: 'osm' },
  })],
  ['POST', /^\/api\/operations\/places\/autocomplete$/, async (_m, b) => {
    const q = String(b.input ?? '').trim();
    if (q.length < 2) return { body: { suggestions: [], configured: true, provider: 'osm' } };
    try {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '8');
      url.searchParams.set('lang', 'en');
      const res = await realFetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      const data = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: Record<string, string | number | undefined>;
        }>;
      };
      const suggestions = (data.features ?? []).flatMap((f) => {
        const p = f.properties ?? {};
        const osmId = p.osm_id;
        if (osmId == null) return [];
        const [lng, lat] = f.geometry?.coordinates ?? [null, null];
        const line1 = [p.housenumber, p.street].filter(Boolean).join(' ').trim() || String(p.name ?? '');
        if (!line1) return [];
        const city = String(p.city || p.locality || p.district || '');
        const secondary = [city, p.state, p.postcode].filter(Boolean).join(', ');
        const type = String(p.osm_type || 'N').slice(0, 1).toUpperCase();
        return [{
          placeId: `osm:${type}:${osmId}:${lng},${lat}`,
          description: [line1, secondary].filter(Boolean).join(', '),
          mainText: line1,
          secondaryText: secondary,
        }];
      });
      return { body: { suggestions, configured: true, provider: 'osm' } };
    } catch {
      return { status: 503, body: { error: 'Address lookup is unavailable.', code: 'places_unavailable' } };
    }
  }],
  ['POST', /^\/api\/operations\/places\/details$/, async (_m, b) => {
    const placeId = String(b.placeId ?? '');
    const m = /^osm:[NWR]:(\d+):(-?[\d.]+),(-?[\d.]+)$/i.exec(placeId);
    if (!m) return { status: 400, body: { error: 'Unknown place.', code: 'osm_place_invalid' } };
    try {
      const url = new URL('https://photon.komoot.io/reverse');
      url.searchParams.set('lon', m[2]!);
      url.searchParams.set('lat', m[3]!);
      url.searchParams.set('lang', 'en');
      const res = await realFetch(url.toString(), { headers: { Accept: 'application/json' } });
      const data = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: Record<string, string | number | undefined>;
        }>;
      };
      const f = data.features?.[0];
      const p = f?.properties ?? {};
      const [lng, lat] = f?.geometry?.coordinates ?? [Number(m[2]), Number(m[3])];
      const line1 = [p.housenumber, p.street].filter(Boolean).join(' ').trim() || String(p.name ?? '');
      const city = String(p.city || p.locality || p.district || '');
      const formatted = [line1, [city, p.state, p.postcode].filter(Boolean).join(', '), p.countrycode || p.country]
        .filter(Boolean)
        .join(', ');
      return {
        body: {
          configured: true,
          provider: 'osm',
          address: {
            placeId,
            formatted,
            addressLine1: line1,
            city,
            postalCode: String(p.postcode || ''),
            state: String(p.state || ''),
            country: String(p.countrycode || p.country || ''),
            lat: typeof lat === 'number' ? lat : null,
            lng: typeof lng === 'number' ? lng : null,
          },
        },
      };
    } catch {
      return { status: 503, body: { error: 'Address lookup is unavailable.', code: 'places_unavailable' } };
    }
  }],

  /* ------------------------------------------- shared job record */
  ['GET', /^\/api\/operations\/shared$/, () => ({
    body: {
      jobs: SHARED_JOBS,
      counts: {
        jobs: SHARED_JOBS.length,
        parties: SHARED_JOBS.reduce((n, j) => n + j.parties, 0),
        blockers: SHARED_JOBS.reduce((n, j) => n + j.behind, 0),
        awaiting: SHARED_JOBS.reduce((n, j) => n + j.awaiting, 0),
      },
    },
  })],
  ['GET', /^\/api\/operations\/shared\/([\w-]+)$/, async (m) => {
    const id = m[1];
    if (SHARED_RECORDS[id]) return { body: SHARED_RECORDS[id] };
    // Dashboard folders may be live org jobs while this mock owns demo ids.
    try {
      const res = await realFetch(`/api/operations/shared/${encodeURIComponent(id)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const body = await res.json();
        SHARED_RECORDS[id] = body;
        return { body };
      }
    } catch {
      /* live API not running */
    }
    const listed = SHARED_JOBS.find((j) => j.jobId === id);
    const record = emptySharedRecord(
      id,
      listed?.jobNumber ?? null,
      listed?.title ?? 'Job',
      null,
    );
    SHARED_RECORDS[id] = record;
    return { body: record };
  }],
  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/parties\/([\w-]+)\/link$/, (m) => {
    const record = SHARED_RECORDS[m[1]];
    const party = record?.parties?.find((p: any) => p.id === m[2]);
    // Every demo party lands on the one sub view there is fixture data for.
    return { body: { company: party?.company ?? 'Company', path: '/shared/demo-token' } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/parties$/, (_m, b) => ({
    status: 201,
    body: { party: { id: `pty-${Date.now()}`, company: String(b.company ?? ''), accessToken: 'k3Jv9QxR2mT8pLwZaN4hC7yD' } },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/brief$/, (m) => {
    const record = SHARED_RECORDS[m[1]];
    const next = (record?.currentRevision ?? 0) + 1;
    return { status: 201, body: { brief: { revision: next }, acceptanceLapsedFor: record?.parties?.length ?? 0 } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/scope$/, (_m, b) => ({
    status: 201,
    body: { item: { id: `sc-${Date.now()}`, title: String(b.title ?? ''), state: b.state ?? 'included' } },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/scope\/([\w-]+)\/decide$/, (m, b) => {
    const record = SHARED_RECORDS[m[1]];
    const item = record?.scope?.find((s: any) => s.id === m[2]);
    if (item) {
      item.state = b.decision;
      item.amount = b.amount ?? null;
      item.decided_at = new Date().toISOString();
      record.risks = record.risks.filter((r: any) => r.scopeItemId !== m[2]);
      record.money = { ...record.money, approved: (record.money.approved ?? 0) + Number(b.amount ?? 0), pending: 0 };
    }
    return { body: { item } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/messages$/, (m, b) => {
    const record = SHARED_RECORDS[m[1]];
    const message = { id: `msg-${Date.now()}`, party_id: null, author_label: state.fullName || state.email, body: String(b.body ?? ''), scope_item_id: null, is_decision: false, created_at: new Date().toISOString() };
    record?.messages?.unshift(message);
    return { status: 201, body: { message } };
  }],

  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/proof$/, (m) => {
    const record = PROOF_DAYS[m[1]] ?? { siteKnown: false, days: [] };
    const days = record.days;
    return {
      body: {
        days,
        counts: {
          days: days.length,
          payable: days.filter((d: any) => d.payable && !d.accepted).length,
          contradicted: days.filter((d: any) => d.contradicted).length,
          awaitingAfter: days.filter((d: any) => d.hasBefore && !d.hasAfter).length,
        },
        siteKnown: record.siteKnown,
      },
    };
  }],
  ['GET', /^\/api\/operations\/shared\/([\w-]+)\/proof\/questions$/, (m) => ({
    body: { questions: PROOF_QUESTIONS[m[1]] ?? [] },
  })],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/proof\/ask$/, (m, b) => {
    const answer = 'The videos on file do not show that. The record covers 2026-08-01, 08-04 and 08-05 for Delgado Roofing and one part-day for Brightline Electric.';
    const entry = { id: `q-${Date.now()}`, question: String(b.question ?? ''), answer, grounded_on: ['2026-08-05', '2026-08-04', '2026-08-01'], created_at: new Date().toISOString() };
    (PROOF_QUESTIONS[m[1]] ??= []).unshift(entry);
    return { status: 201, body: { answer, question: entry, groundedOn: 3 } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/proof\/([\d-]+)\/decide$/, (m, b) => {
    const record = PROOF_DAYS[m[1]];
    const day = record?.days?.find((d: any) => d.workDate === m[2] && d.partyId === b.partyId);
    if (day) {
      day.accepted = b.decision === 'accepted';
      day.rejected = b.decision === 'rejected';
    }
    return { body: { ok: true } };
  }],
  ['GET', /^\/api\/operations\/shared\/proof\/([\w-]+)\/video$/, (m) => {
    for (const items of Object.values(EVIDENCE)) {
      const item = (items as any[]).find((i) => i.id === m[1]);
      if (!item) continue;
      item.viewCount += 1;
      item.lastViewedAt = new Date().toISOString();
      (CUSTODY[m[1]] ??= []).unshift({
        id: `cu-${Date.now()}`,
        action: 'viewed',
        actor_label: 'Dana Ortiz',
        actor_role: 'general_contractor',
        detail: `${item.phase} · ${item.workDate}`,
        occurred_at: new Date().toISOString(),
      });
    }
    return { body: { url: DEMO_CLIP, expiresInSeconds: 600 } };
  }],
  ['POST', /^\/api\/operations\/shared\/([\w-]+)\/proof\/([\d-]+)\/analyse$/, (m, b) => {
    const record = PROOF_DAYS[m[1]];
    const day = record?.days?.find((d: any) => d.workDate === m[2] && d.partyId === b.partyId);
    return { body: { summary: day?.aiSummary ?? null, findings: day?.aiFindings ?? null, model: 'claude' } };
  }],

  /* ------------------------------------------- estimating (demo pipeline) */
  // The estimate is the backend's own demo output, frozen at build time — the
  // Estimating tab builds it, saves it, and hands it to Purchase orders, the
  // same loop the live product runs.
  ['GET', /^\/api\/mitigation\/demo-sources$/, () => ({ body: { sources: DEMO_ESTIMATE_SOURCES } })],
  ['POST', /^\/api\/mitigation\/build$/, () => ({
    body: { estimate: DEMO_ESTIMATE, priceListConnected: false },
  })],
  ['POST', /^\/api\/mitigation\/estimates$/, () => {
    registerDemoEstimateSource('est-demo-1');
    return {
      status: 201,
      body: { estimateId: 'est-demo-1', jobId: DEMO_ESTIMATE.jobId, estimate: DEMO_ESTIMATE },
    };
  }],

  /* ------------------------------------------- purchasing */
  ['GET', /^\/api\/purchasing\/sources$/, () => ({ body: { sources: PURCHASING_SOURCES } })],
  ['GET', /^\/api\/purchasing\/suppliers$/, () => ({ body: { suppliers: SUPPLIER_STATUS } })],
  ['POST', /^\/api\/purchasing\/takeoff$/, (_m, b) => {
    const source = PURCHASING_SOURCES.find((s) => s.estimateId === b.estimateId);
    const takeoff = TAKEOFFS[String(b.estimateId)];
    if (!source || !takeoff) {
      return { status: 404, body: { error: 'That estimate was not found.', code: 'estimate_not_found' } };
    }
    return { body: { source, takeoff } };
  }],
  ['GET', /^\/api\/purchasing\/orders\/([\w-]+)$/, (m) => {
    const order = PURCHASE_ORDERS.find((o) => o.id === m[1]);
    if (!order) return { status: 404, body: { error: 'No such purchase order.', code: 'po_not_found' } };
    const lines = PO_LINES[order.id] ?? [];
    return { body: { order, lines, estTotal: poTotal(lines), events: PO_EVENTS[order.id] ?? [] } };
  }],
  ['GET', /^\/api\/purchasing\/orders$/, () => ({
    body: {
      orders: PURCHASE_ORDERS.map((o) => ({
        ...o,
        lineCount: (PO_LINES[o.id] ?? []).length,
        estTotal: poTotal(PO_LINES[o.id] ?? []),
      })),
    },
  })],
  ['POST', /^\/api\/purchasing\/orders\/([\w-]+)\/approve$/, (m) => {
    const order = PURCHASE_ORDERS.find((o) => o.id === m[1]);
    if (!order) return { status: 404, body: { error: 'No such purchase order.', code: 'po_not_found' } };
    if (order.status !== 'draft') {
      return { status: 409, body: { error: `This order is ${order.status}, not a draft.`, code: 'not_draft' } };
    }
    order.status = 'approved';
    order.approvedBy = 'demo-user-1';
    order.approvedAt = new Date().toISOString();
    (PO_EVENTS[order.id] ??= []).push({
      id: `poe-${Date.now()}`, actorName: 'Dana Ortiz', action: 'approved',
      detail: `estimated $${poTotal(PO_LINES[order.id] ?? []).toFixed(2)}`, at: new Date().toISOString(),
    });
    return { body: { order } };
  }],
  ['POST', /^\/api\/purchasing\/orders\/([\w-]+)\/reopen$/, (m) => {
    const order = PURCHASE_ORDERS.find((o) => o.id === m[1]);
    if (!order) return { status: 404, body: { error: 'No such purchase order.', code: 'po_not_found' } };
    if (order.status !== 'approved') {
      return { status: 409, body: { error: 'Only an approved order can be reopened.', code: 'not_approved' } };
    }
    order.status = 'draft';
    order.approvedBy = null;
    order.approvedAt = null;
    (PO_EVENTS[order.id] ??= []).push({
      id: `poe-${Date.now()}`, actorName: 'Dana Ortiz', action: 'reopened', detail: '', at: new Date().toISOString(),
    });
    return { body: { order } };
  }],
  ['POST', /^\/api\/purchasing\/orders\/([\w-]+)\/place$/, (m, b) => {
    const order = PURCHASE_ORDERS.find((o) => o.id === m[1]);
    if (!order) return { status: 404, body: { error: 'No such purchase order.', code: 'po_not_found' } };
    if (order.status !== 'approved') {
      return { status: 409, body: { error: 'An order is placed only after it is approved.', code: 'not_approved' } };
    }
    const reference = typeof b.reference === 'string' ? b.reference.trim() : '';
    if (!reference && order.supplier !== 'manual') {
      const label = order.supplier === 'home_depot' ? 'The Home Depot' : "Lowe's";
      return {
        status: 409,
        body: {
          error: `${label} is not connected. Connect it in Purchase orders → Suppliers, or place the order there yourself and record the order number here.`,
          code: 'supplier_not_connected',
        },
      };
    }
    order.status = 'placed';
    order.placedAt = new Date().toISOString();
    order.externalRef = reference || null;
    (PO_EVENTS[order.id] ??= []).push({
      id: `poe-${Date.now()}`, actorName: 'Dana Ortiz', action: 'placed',
      detail: reference ? `recorded — ordered outside Atmosphere, ref ${reference}` : 'recorded — ordered outside Atmosphere',
      at: new Date().toISOString(),
    });
    return { body: { order } };
  }],
  ['POST', /^\/api\/purchasing\/orders\/([\w-]+)\/cancel$/, (m) => {
    const order = PURCHASE_ORDERS.find((o) => o.id === m[1]);
    if (!order) return { status: 404, body: { error: 'No such purchase order.', code: 'po_not_found' } };
    if (order.status === 'placed') {
      return { status: 409, body: { error: 'A placed order is a record of money spent — cancel it with the store, then note the outcome on the job.', code: 'already_placed' } };
    }
    order.status = 'cancelled';
    (PO_EVENTS[order.id] ??= []).push({
      id: `poe-${Date.now()}`, actorName: 'Dana Ortiz', action: 'cancelled', detail: '', at: new Date().toISOString(),
    });
    return { body: { order } };
  }],
  ['POST', /^\/api\/purchasing\/orders$/, (_m, b) => {
    const id = `po-new-${PURCHASE_ORDERS.length + 1}`;
    const now = new Date().toISOString();
    const lines = Array.isArray(b.lines) ? (b.lines as Array<Record<string, any>>) : [];
    const order = {
      id,
      estimateId: b.estimateId ?? null,
      jobName: String(b.jobName ?? 'Untitled job'),
      claimNumber: b.claimNumber ?? null,
      supplier: b.supplier ?? 'manual',
      vendorAccountId: null,
      status: 'draft',
      approvedBy: null, approvedAt: null, placedAt: null, externalRef: null,
      note: b.note ?? null,
      createdAt: now, updatedAt: now,
    };
    PURCHASE_ORDERS.unshift(order);
    PO_LINES[id] = lines.map((l, i) => ({
      id: `pol-${id}-${i}`,
      materialKey: l.materialKey, description: l.description, detail: l.detail ?? null,
      quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice ?? null,
      priceBasis: 'estimate', sourceSummary: l.sourceSummary ?? null,
    }));
    PO_EVENTS[id] = [{
      id: `poe-${id}`, actorName: 'Dana Ortiz', action: 'created',
      detail: `${lines.length} lines, estimated $${poTotal(PO_LINES[id]).toFixed(2)}, from ${order.jobName}`,
      at: now,
    }];
    return { status: 201, body: { order } };
  }],

  /* ------------------------------------------- campaigns & territories */
  ['GET', /^\/api\/sales\/territories$/, () => ({ body: { items: TERRITORIES } })],

  // Real ZIP centroids, from the same table the backend carries — the map is
  // only worth looking at if the dots are where the codes actually are.
  ['GET', /^\/api\/sales\/territories\/map$/, () => ({
    body: {
      located: TERRITORY_POINTS.reduce((n, t) => n + t.points.length, 0),
      total: TERRITORIES.reduce((n, t) => n + t.postalCodes.length, 0),
      territories: TERRITORY_POINTS,
    },
  })],
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

  /* ------------------------------------------- symbility */
  ['GET', /^\/api\/symbility\/status$/, () => ({
    body: {
      connected: SYMBILITY_STATE.connected,
      sessionActive: SYMBILITY_STATE.connected,
      driver: 'mock',
      webAutomationEnabled: false,
      storageAvailable: true,
      username: SYMBILITY_STATE.username,
      scopes: SYMBILITY_STATE.connected ? SYMBILITY_STATE.scopes : [],
      storageMode: 'session',
      grantedAt: SYMBILITY_STATE.connected ? SYMBILITY_STATE.grantedAt : null,
      expiresAt: SYMBILITY_STATE.connected
        ? new Date(Date.now() + 30 * 86_400_000).toISOString()
        : null,
      availableScopes: [
        { scope: 'read_profile', label: 'See who is signed in', description: 'Read your name and company so the app can show which account is connected.', defaultGranted: true },
        { scope: 'read_claims', label: 'Read claim assignments', description: 'See the claims assigned to your account in Claims Connect.', defaultGranted: true },
        { scope: 'write_estimate', label: 'Write estimates', description: 'Create or update an estimate on a claim. Never submits without you.', defaultGranted: false },
      ],
    },
  })],
  ['POST', /^\/api\/symbility\/connect$/, (_m, b) => {
    const password = String(b.password ?? '');
    if (password.includes('mfa') && !b.mfaCode) {
      return {
        status: 202,
        body: { status: 'mfa_required', challengeId: 'ch-1', message: 'Claims Connect asked for a verification code. Enter it to finish connecting.' },
      };
    }
    SYMBILITY_STATE.connected = true;
    SYMBILITY_STATE.username = String(b.username ?? '');
    SYMBILITY_STATE.scopes = Array.isArray(b.scopes) ? (b.scopes as string[]) : ['read_profile'];
    SYMBILITY_STATE.grantedAt = new Date().toISOString();
    return {
      status: 201,
      body: {
        status: 'connected',
        profile: { username: SYMBILITY_STATE.username, displayName: SYMBILITY_STATE.username.split('@')[0], companyName: 'Ortiz Restoration' },
        scopes: SYMBILITY_STATE.scopes,
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        storageMode: 'session',
      },
    };
  }],
  ['POST', /^\/api\/symbility\/disconnect$/, () => {
    SYMBILITY_STATE.connected = false;
    SYMBILITY_STATE.username = null;
    return { body: { ok: true } };
  }],

  /* ------------------------------------------- CRM job sync */
  ['GET', /^\/api\/crm-sync\/status$/, () => ({
    body: {
      driver: 'mock',
      conflictsPending: CRM_SYNC_STATE.conflicts.length,
      systems: CRM_SYNC_SYSTEMS_DEMO.map(([system, label]) => {
        const c = CRM_SYNC_STATE.connected[system];
        return {
          system,
          label,
          connected: Boolean(c),
          accountLabel: c?.accountLabel ?? null,
          connectedAt: c?.connectedAt ?? null,
          lastSyncAt: c?.lastSyncAt ?? null,
          lastSummary: c?.lastSummary ?? null,
        };
      }),
    },
  })],
  ['POST', /^\/api\/crm-sync\/connect$/, (_m, b) => {
    const key = String(b.apiKey ?? '');
    const system = String(b.system ?? 'jobnimbus');
    const label = CRM_SYNC_SYSTEMS_DEMO.find(([s]) => s === system)?.[1] ?? system;
    if (!key.trim() || key.includes('bad')) {
      return { status: 401, body: { error: `${label} did not accept that API key.`, code: 'invalid_credentials' } };
    }
    CRM_SYNC_STATE.connected[system] = {
      accountLabel: `${label} · key …${key.trim().slice(-4)}`,
      connectedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastSummary: null,
    };
    return { status: 201, body: { status: 'connected', system, accountLabel: CRM_SYNC_STATE.connected[system].accountLabel } };
  }],
  ['POST', /^\/api\/crm-sync\/disconnect$/, (_m, b) => {
    delete CRM_SYNC_STATE.connected[String(b.system)];
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/crm-sync\/sync$/, (_m, b) => {
    const system = String(b.system ?? 'jobnimbus');
    const connection = CRM_SYNC_STATE.connected[system];
    if (!connection) return { status: 409, body: { error: 'Not connected.', code: 'not_connected' } };
    let summary;
    if (!CRM_SYNC_STATE.seeded) {
      CRM_SYNC_STATE.seeded = true;
      const incoming: Array<[string, number, string, string | null]> = [
        ['job-1051', 1051, 'Kessler Rd — hail, roof replacement', 'CLM-90112'],
        ['job-1052', 1052, 'Barton Creek — water loss, kitchen', 'CLM-90144'],
        ['job-1053', 1053, 'Pine Hollow — fire rebuild, unit 3', null],
      ];
      incoming.forEach(([id, num, title, claim]) => {
        (SHARED_JOBS as any[]).push({ jobId: id, jobNumber: num, title, status: 'in_progress', parties: 0, currentRevision: null, behind: 0, awaiting: 0, exclusions: 0 });
        SHARED_RECORDS[id] = emptySharedRecord(id, num, title, claim);
      });
      // The one change sync refuses to make itself: Cedar Ridge already
      // holds footage, and its CRM row just moved house.
      CRM_SYNC_STATE.conflicts.push({
        linkId: 'cl-1',
        system,
        systemLabel: CRM_SYNC_SYSTEMS_DEMO.find(([s]) => s === system)?.[1] ?? system,
        externalId: `${system}-1180`,
        jobId: 'job-1038',
        jobTitle: 'Cedar Ridge — storm damage, roof tarp + rebuild',
        jobNumber: 1038,
        kind: 'address_moved',
        incoming: {
          title: 'Cedar Ridge — storm damage, roof tarp + rebuild',
          claimNumber: 'CLM-88396',
          address: { line1: '2218 Cedar Ridge Dr', city: 'Round Rock', region: 'TX', postalCode: '78681', lat: 30.51, lon: -97.68 },
        },
        seenAt: new Date().toISOString(),
      });
      summary = { created: 3, updated: 0, conflicts: 1, archived: 0, unchanged: 0 };
    } else {
      summary = { created: 0, updated: 0, conflicts: CRM_SYNC_STATE.conflicts.length, archived: 0, unchanged: 3 };
    }
    connection.lastSyncAt = new Date().toISOString();
    connection.lastSummary = summary;
    return { body: { summary } };
  }],
  ['GET', /^\/api\/crm-sync\/conflicts$/, () => ({ body: { conflicts: CRM_SYNC_STATE.conflicts } })],
  ['POST', /^\/api\/crm-sync\/conflicts\/([\w-]+)$/, (m, b) => {
    CRM_SYNC_STATE.conflicts = CRM_SYNC_STATE.conflicts.filter((c) => c.linkId !== m[1]);
    return { body: { ok: true, decision: b.decision ?? 'keep_current' } };
  }],
];

function adoptLiveIdentity(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const body = data as Record<string, unknown>;
  const user = body.user as { email?: string | null } | undefined;
  if (user?.email) {
    state.email = user.email;
    state.signedIn = true;
  }
  const profile = body.profile as {
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  } | undefined;
  if (profile) {
    if (profile.email) state.email = profile.email;
    if (profile.fullName !== undefined) state.fullName = profile.fullName;
    if (profile.avatarUrl !== undefined) state.avatarUrl = profile.avatarUrl;
  }
  const membership = body.membership as { org?: { name?: string } | null } | undefined;
  if (membership?.org?.name) {
    state.orgName = membership.org.name;
    state.onboarded = true;
  }
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (!path.startsWith('/api/')) return realFetch(input, init);

  // Account, org, and the job library must be the signed-in tenant — never the
  // Dana Ortiz fixture — whenever the live API answers.
  if (isLiveFirstPath(path)) {
    try {
      const live = await realFetch(input, init);
      if (live.ok) {
        try {
          adoptLiveIdentity(await live.clone().json());
        } catch {
          /* not JSON */
        }
        return live;
      }
      // A live 401/403 on the avatar means this browser is not the signed-in
      // tenant. Fall through so the demo Settings page can still store a photo.
      if (!(path === '/api/profile/avatar' && (live.status === 401 || live.status === 403))) {
        return live;
      }
    } catch {
      /* live API unreachable — fall through to demo fixtures */
    }
  }

  const query = new URLSearchParams((url.split('?')[1] ?? ''));
  LAST_QUERY.leadId = query.get('leadId') ?? undefined;
  LAST_QUERY.scope = query.get('scope') ?? undefined;
  LAST_QUERY.phase = query.get('phase') ?? undefined;
  LAST_QUERY.jobId = query.get('jobId') ?? undefined;
  LAST_QUERY.kind = query.get('kind') ?? undefined;
  LAST_QUERY.mine = query.get('mine') ?? undefined;
  LAST_QUERY.status = query.get('status') ?? undefined;

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
    const result = await Promise.resolve(handler(match, body));
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
