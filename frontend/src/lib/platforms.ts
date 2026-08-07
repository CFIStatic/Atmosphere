import {
  ArtifactIcon,
  ChartIcon as LedgerIcon,
  ChartIcon as TrendIcon,
  BoltIcon,
  BriefcaseIcon,
  BuildingIcon,
  ChartIcon,
  CheckIcon,
  CreditCardIcon,
  DecisionIcon,
  GaugeIcon,
  GlobeIcon,
  MicIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  ThoughtIcon,
  ToolIcon,
  UsersIcon,
} from '../components/icons';

/**
 * The platforms — one current product and the later ones.
 *
 * The Work Verification Platform is the product; Field is its capture side.
 * Sales and Manager are built, kept, and deliberately not displayed: they
 * are later products, and a switcher that offers four things dilutes the one
 * being sold. VISIBLE_PLATFORM_IDS is the curtain — everything behind it
 * stays wired (routes, pages, data) so unveiling a platform later is a
 * one-line change, not a resurrection.
 *
 * Everything here is the single source of truth for the switcher, the
 * sidebar, and each platform's home page. Adding a screen means adding it to
 * one platform's groups; the route itself is declared in App.tsx.
 */
export type PlatformId = 'sales' | 'operations' | 'field' | 'manager';

export interface NavItem {
  to: string;
  label: string;
  Icon: typeof GaugeIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** One metric on a platform's home screen, resolved against loaded data. */
export type MetricKey =
  | 'openJobs'
  | 'blockedJobs'
  | 'atRiskProjects'
  | 'revenueInProgress'
  | 'receivablesOpen'
  | 'collectedThisPeriod'
  | 'avgDaysDrying'
  | 'agentActions24h'
  | 'verifierPassRate'
  | 'awaitingApproval'
  | 'crewOnJobs'
  | 'accounts'
  | 'scheduledToday'
  | 'unscheduled'
  | 'creditBalance'
  | 'usageThisPeriod';

export interface Platform {
  id: PlatformId;
  name: string;
  /** Fits the sidebar; the full name shows in the switcher's menu. */
  short: string;
  /** The one-line promise, lifted from the platform's page on the website. */
  tagline: string;
  /** What the home screen says under the greeting. */
  homeBlurb: string;
  Icon: typeof GaugeIcon;
  /** Six tiles across the top of the platform's home screen. */
  metrics: MetricKey[];
  /** The sidebar, for as long as this platform is the active one. */
  groups: NavGroup[];
}

/**
 * Only Settings is common to all four — it is about the person and the
 * device, not the work. Everything else in a platform's panel is chosen for
 * that platform, including which shared screen belongs in it and what it is
 * called there: "Portals" in Sales is the same route as "Web Access" in
 * Operations, because a salesperson and a coordinator do not mean the same
 * thing by it.
 */
const SYSTEM: NavGroup = {
  label: 'System',
  items: [{ to: '/settings', label: 'Settings', Icon: SettingsIcon }],
};

const OPERATE = (home: string, label: string): NavGroup => ({
  label,
  items: [
    { to: home, label: 'Overview', Icon: GaugeIcon },
    { to: '/my-work', label: 'My Work', Icon: CheckIcon },
    { to: '/approvals', label: 'Approvals', Icon: ShieldIcon },
  ],
});

export const PLATFORMS: Record<PlatformId, Platform> = {
  sales: {
    id: 'sales',
    name: 'Sales Platform',
    short: 'Sales',
    tagline: 'Win the work',
    homeBlurb:
      'The pipeline, and the agent that keeps it moving — leads, accounts, and the estimates that turn them into jobs.',
    Icon: BuildingIcon,
    metrics: ['accounts', 'openJobs', 'revenueInProgress', 'awaitingApproval', 'agentActions24h', 'verifierPassRate'],
    groups: [
      OPERATE('/sales', 'Sell'),
      {
        label: 'Pipeline',
        items: [
          { to: '/prospector', label: 'Find contacts', Icon: SearchIcon },
          { to: '/profiler', label: 'Profiler', Icon: ThoughtIcon },
          { to: '/pipeline', label: 'Leads', Icon: TrendIcon },
          { to: '/customers', label: 'Accounts & contacts', Icon: BuildingIcon },
          { to: '/estimator', label: 'Bids', Icon: ArtifactIcon },
          { to: '/jobs', label: 'Won work', Icon: BriefcaseIcon },
        ],
      },
      {
        label: 'Reach',
        items: [
          // Campaigns and Territories are Sales' alone — nobody in Operations
          // or Field runs outreach or owns a patch of map, and putting them in
          // the shared groups would have them appear for everyone.
          { to: '/campaigns', label: 'Campaigns', Icon: BoltIcon },
          { to: '/territories', label: 'Territories', Icon: GlobeIcon },
          { to: '/web-access', label: 'Carrier portals', Icon: GlobeIcon },
          // Was pointed at the agent audit trail, which is an operations
          // concern wearing a sales label. Delivery visibility is what somebody
          // selling actually needs from this slot.
          { to: '/work', label: "What's happening", Icon: ToolIcon },
          { to: '/memory', label: 'Account history', Icon: ThoughtIcon },
        ],
      },
      SYSTEM,
    ],
  },

  // The operations workspace, rebranded as what it now is: the home of the
  // Work Verification Platform. The id stays 'operations' so routes, stored
  // preferences, and the demo boot value all keep working — the brand is the
  // display fields, not the key.
  operations: {
    id: 'operations',
    name: 'Work Verification Platform',
    short: 'Verification',
    tagline: 'Prove the work',
    homeBlurb:
      'Every day of work filmed against the scope, checked at the door, read by the assistant, and held in a chain of custody — job files that create themselves from your CRM.',
    Icon: DecisionIcon,
    metrics: ['openJobs', 'crewOnJobs', 'awaitingApproval', 'scheduledToday', 'blockedJobs', 'atRiskProjects'],
    groups: [
      // The platform IS the Verifier, full screen with its own sidebar — so
      // this rail carries no duplicate entry for it. Settings remains for
      // the shell pages (the portal's sidebar links to it), and the wordmark
      // and switcher both lead back to the portal.
      //
      // Job files is the one exception, not a resurrection of the old rail:
      // it is where a job's scope gets set (typed or read from a document),
      // where readiness says what the footage will be able to prove, and
      // where a subcontractor is invited — office work the Verifier has no
      // screen for. Its own sidebar links here exactly the way it already
      // links to Settings.
      {
        label: 'Set up',
        items: [
          { to: '/intake', label: 'Start a job', Icon: BoltIcon },
          { to: '/shared', label: 'Job files', Icon: UsersIcon },
        ],
      },
      /* Earlier workspace surfaces — kept, not displayed. The routes still
         answer; restore by moving groups back.
      OPERATE('/operations', 'Run the day'),
      {
        label: 'The record',
        items: [
          { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
          { to: '/schedule', label: 'Schedule', Icon: HistoryIcon },
          { to: '/team', label: 'Crew', Icon: UsersIcon },
        ],
      },
      */
      /* Later products — built, kept, not displayed while the Work
         Verification Platform is the sole focus. Restore by moving items
         back into a visible group.
      {
        label: 'Delivery',
        items: [
          { to: '/pm', label: 'Project board', Icon: DecisionIcon },
          { to: '/mitigation', label: 'Estimating', Icon: ArtifactIcon },
          { to: '/purchase-orders', label: 'Purchase orders', Icon: CreditCardIcon },
        ],
      },
      {
        label: 'Automation',
        items: [
          { to: '/web-access', label: 'Web access', Icon: GlobeIcon },
          { to: '/computer-use', label: 'Computer use', Icon: MonitorIcon },  // re-import MonitorIcon when restoring
          { to: '/audit', label: 'Agent runs', Icon: BoltIcon },
        ],
      },
      */
      SYSTEM,
    ],
  },

  field: {
    id: 'field',
    name: 'Field Platform',
    short: 'Field',
    tagline: 'Capture the job site',
    homeBlurb:
      'Recording, a spoken assistant, and a camera that names what it sees — built for gloved hands and a phone in the rain.',
    Icon: MicIcon,
    // Capture-only: no drying stats, no agent counters — a crew's numbers
    // are where they are due and what is open.
    metrics: ['scheduledToday', 'crewOnJobs', 'openJobs', 'unscheduled'],
    groups: [
      // Not OPERATE(): a crew's day is capture, not a work queue — My Work
      // and Approvals are office surfaces and stay off the truck.
      {
        label: 'Today',
        items: [{ to: '/field', label: 'Overview', Icon: GaugeIcon }],
      },
      {
        label: 'On site',
        items: [
          { to: '/technician', label: 'Capture', Icon: MicIcon },
          { to: '/jobs', label: 'My jobs', Icon: BriefcaseIcon },
        ],
      },
      /* Later products — kept, not displayed while capture is the whole job.
      {
        label: 'On site (more)',
        items: [{ to: '/schedule', label: 'Route', Icon: HistoryIcon }],
      },
      {
        label: 'Hand off',
        items: [
          { to: '/mitigation', label: 'Readings to estimate', Icon: ArtifactIcon },
          { to: '/memory', label: 'What I logged', Icon: ThoughtIcon },
        ],
      },
      */
      SYSTEM,
    ],
  },

  manager: {
    id: 'manager',
    name: 'Manager Platform',
    short: 'Manager',
    tagline: 'Run the business',
    homeBlurb:
      'Live job costing, the accounting work around your books, and insight into which work actually pays.',
    Icon: ChartIcon,
    metrics: ['revenueInProgress', 'receivablesOpen', 'collectedThisPeriod', 'creditBalance', 'usageThisPeriod', 'openJobs'],
    groups: [
      OPERATE('/manager', 'Oversee'),
      {
        label: 'The books',
        items: [
          { to: '/costing', label: 'Job costing', Icon: LedgerIcon },
          { to: '/billing', label: 'Plan & credits', Icon: CreditCardIcon },
          { to: '/usage', label: 'Spend', Icon: ChartIcon },
          { to: '/customers', label: 'Accounts', Icon: BuildingIcon },
        ],
      },
      {
        label: 'Insight',
        items: [
          { to: '/audit', label: 'What agents did', Icon: BoltIcon },
          { to: '/team', label: 'People', Icon: UsersIcon },
          { to: '/memory', label: 'The record', Icon: ThoughtIcon },
        ],
      },
      SYSTEM,
    ],
  },
};

export const PLATFORM_IDS: PlatformId[] = ['sales', 'operations', 'field', 'manager'];

/**
 * What the switcher offers, office first.
 *
 * The Verification platform IS the office's view, and its home is the
 * Verifier — so it leads, and a fresh device lands there. Field is the same
 * product from the truck. Sales and Manager are later products: fully wired,
 * reachable by URL, and deliberately absent from every menu until they are
 * current again.
 *
 * Verification has to be listed, not merely be the default. Leaving it out
 * made it a one-way door: the office landed on the Verifier, switched to
 * Field once, and had no way back to the product they had just been using.
 */
export const VISIBLE_PLATFORM_IDS: PlatformId[] = ['operations', 'field'];

export const PLATFORM_HOME: Record<PlatformId, string> = {
  sales: '/sales',
  // The Verification platform opens on the Verifier — the platform is the
  // portal. The old overview still answers at /operations, unlisted.
  operations: '/verifier-library',
  field: '/field',
  manager: '/manager',
};

/**
 * Which platform a path belongs to. Shared screens (Jobs, Billing, Settings)
 * deliberately return null: they keep whichever platform the person is in,
 * so opening a job from Sales does not throw them into Operations.
 */
export function platformOfPath(path: string): PlatformId | null {
  for (const id of PLATFORM_IDS) {
    if (path === PLATFORM_HOME[id]) return id;
  }
  return null;
}

/** Metric labels and their one-line meaning, shared by every platform home. */
export const METRIC_LABELS: Record<MetricKey, { label: string; hint: string }> = {
  openJobs: { label: 'Active jobs', hint: 'Open across the organization' },
  blockedJobs: { label: 'Blocked', hint: 'Waiting on someone or something' },
  atRiskProjects: { label: 'At risk', hint: 'Health scored watch or worse' },
  revenueInProgress: { label: 'Revenue in progress', hint: 'Approved scope on open jobs' },
  receivablesOpen: { label: 'Receivables open', hint: 'Invoiced, not yet paid' },
  collectedThisPeriod: { label: 'Collected', hint: 'Paid against invoiced work' },
  avgDaysDrying: { label: 'Avg. days drying', hint: 'Across projects still drying' },
  agentActions24h: { label: 'Agent actions (24h)', hint: 'Runs started in the last day' },
  verifierPassRate: { label: 'Verifier pass rate', hint: 'Runs confirmed by the second agent' },
  awaitingApproval: { label: 'Awaiting approval', hint: 'Decisions waiting on a person' },
  crewOnJobs: { label: 'Crew assigned', hint: 'People on open jobs' },
  accounts: { label: 'Accounts', hint: 'Customers on the books' },
  scheduledToday: { label: 'Scheduled today', hint: 'Jobs with a start time today' },
  unscheduled: { label: 'Unscheduled', hint: 'Open jobs with no start date' },
  creditBalance: { label: 'Credit balance', hint: 'Prepaid, available to spend' },
  usageThisPeriod: { label: 'Usage this period', hint: 'Drawn down since the period opened' },
};
