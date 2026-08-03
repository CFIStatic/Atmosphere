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
  HistoryIcon,
  MicIcon,
  MonitorIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  ThoughtIcon,
  ToolIcon,
  UsersIcon,
} from '../components/icons';

/**
 * The four products, as the website sells them.
 *
 * Each platform is a different job of work — win it, run it, capture it,
 * account for it — but they share one console: the same shell, the same
 * layout, the same audit trail underneath. Switching platforms changes the
 * navigation and the home screen, never the shape of the UI.
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

  operations: {
    id: 'operations',
    name: 'Operations Platform',
    short: 'Operations',
    tagline: 'Run the work',
    homeBlurb:
      'Project management, estimating, and assistance — nineteen rules watching every open job so nothing waits on someone remembering.',
    Icon: DecisionIcon,
    metrics: ['openJobs', 'blockedJobs', 'atRiskProjects', 'avgDaysDrying', 'awaitingApproval', 'agentActions24h'],
    groups: [
      OPERATE('/operations', 'Run the day'),
      {
        label: 'Delivery',
        items: [
          { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
          { to: '/pm', label: 'Project board', Icon: DecisionIcon },
          // Operations' alone: it is the general contractor's record of what a
          // sub was told, and neither Sales nor Field is a party to that.
          { to: '/shared', label: 'Shared Dashboard', Icon: UsersIcon },
          { to: '/schedule', label: 'Schedule', Icon: HistoryIcon },
          { to: '/mitigation', label: 'Estimating', Icon: ArtifactIcon },
        ],
      },
      {
        label: 'Automation',
        items: [
          { to: '/web-access', label: 'Web access', Icon: GlobeIcon },
          { to: '/computer-use', label: 'Computer use', Icon: MonitorIcon },
          { to: '/audit', label: 'Agent runs', Icon: BoltIcon },
          { to: '/team', label: 'Crew', Icon: UsersIcon },
        ],
      },
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
    metrics: ['scheduledToday', 'crewOnJobs', 'openJobs', 'unscheduled', 'avgDaysDrying', 'agentActions24h'],
    groups: [
      OPERATE('/field', 'Today'),
      {
        label: 'On site',
        items: [
          { to: '/technician', label: 'Capture', Icon: MicIcon },
          { to: '/schedule', label: 'Route', Icon: HistoryIcon },
          { to: '/jobs', label: 'My jobs', Icon: BriefcaseIcon },
        ],
      },
      {
        label: 'Hand off',
        items: [
          { to: '/mitigation', label: 'Readings to estimate', Icon: ArtifactIcon },
          { to: '/memory', label: 'What I logged', Icon: ThoughtIcon },
        ],
      },
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

export const PLATFORM_HOME: Record<PlatformId, string> = {
  sales: '/sales',
  operations: '/operations',
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
