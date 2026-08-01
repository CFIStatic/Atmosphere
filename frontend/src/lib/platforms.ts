import {
  ArtifactIcon,
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
  SettingsIcon,
  ShieldIcon,
  ThoughtIcon,
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

/** Every platform carries these — the money and the machine are shared. */
const SHARED_GROUPS: NavGroup[] = [
  {
    label: 'Finance',
    items: [
      { to: '/billing', label: 'Billing', Icon: CreditCardIcon },
      { to: '/usage', label: 'Usage', Icon: ChartIcon },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/audit', label: 'Agents', Icon: BoltIcon },
      { to: '/memory', label: 'Memory', Icon: ThoughtIcon },
      { to: '/team', label: 'Team', Icon: UsersIcon },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', Icon: SettingsIcon }],
  },
];

const OPERATE = (home: string): NavGroup => ({
  label: 'Operate',
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
    tagline: 'Win the work',
    homeBlurb:
      'The pipeline, and the agent that keeps it moving — leads, accounts, and the estimates that turn them into jobs.',
    Icon: BuildingIcon,
    metrics: ['accounts', 'openJobs', 'revenueInProgress', 'awaitingApproval', 'agentActions24h', 'verifierPassRate'],
    groups: [
      OPERATE('/sales'),
      {
        label: 'Pipeline',
        items: [
          { to: '/customers', label: 'Customers', Icon: BuildingIcon },
          { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
          { to: '/estimator', label: 'Bids & estimates', Icon: ArtifactIcon },
          { to: '/web-access', label: 'Portals', Icon: GlobeIcon },
        ],
      },
      ...SHARED_GROUPS,
    ],
  },

  operations: {
    id: 'operations',
    name: 'Operations Platform',
    tagline: 'Run the work',
    homeBlurb:
      'Project management, estimating, and assistance — nineteen rules watching every open job so nothing waits on someone remembering.',
    Icon: DecisionIcon,
    metrics: ['openJobs', 'blockedJobs', 'atRiskProjects', 'avgDaysDrying', 'awaitingApproval', 'agentActions24h'],
    groups: [
      OPERATE('/operations'),
      {
        label: 'Delivery',
        items: [
          { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
          { to: '/pm', label: 'Workflows', Icon: DecisionIcon },
          { to: '/schedule', label: 'Schedule', Icon: HistoryIcon },
          { to: '/mitigation', label: 'Estimates', Icon: ArtifactIcon },
          { to: '/web-access', label: 'Web Access', Icon: GlobeIcon },
          { to: '/computer-use', label: 'Computer', Icon: MonitorIcon },
        ],
      },
      ...SHARED_GROUPS,
    ],
  },

  field: {
    id: 'field',
    name: 'Field Platform',
    tagline: 'Capture the job site',
    homeBlurb:
      'Recording, a spoken assistant, and a camera that names what it sees — built for gloved hands and a phone in the rain.',
    Icon: MicIcon,
    metrics: ['scheduledToday', 'crewOnJobs', 'openJobs', 'unscheduled', 'avgDaysDrying', 'agentActions24h'],
    groups: [
      OPERATE('/field'),
      {
        label: 'On site',
        items: [
          { to: '/technician', label: 'Capture', Icon: MicIcon },
          { to: '/schedule', label: 'Schedule', Icon: HistoryIcon },
          { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
          { to: '/mitigation', label: 'Estimates', Icon: ArtifactIcon },
        ],
      },
      ...SHARED_GROUPS,
    ],
  },

  manager: {
    id: 'manager',
    name: 'Manager Platform',
    tagline: 'Run the business',
    homeBlurb:
      'Live job costing, the accounting work around your books, and insight into which work actually pays.',
    Icon: ChartIcon,
    metrics: ['revenueInProgress', 'receivablesOpen', 'collectedThisPeriod', 'creditBalance', 'usageThisPeriod', 'openJobs'],
    groups: [
      OPERATE('/manager'),
      {
        label: 'Business',
        items: [
          { to: '/billing', label: 'Billing', Icon: CreditCardIcon },
          { to: '/usage', label: 'Usage', Icon: ChartIcon },
          { to: '/jobs', label: 'Job costing', Icon: BriefcaseIcon },
          { to: '/customers', label: 'Customers', Icon: BuildingIcon },
        ],
      },
      {
        label: 'Intelligence',
        items: [
          { to: '/audit', label: 'Agents', Icon: BoltIcon },
          { to: '/memory', label: 'Memory', Icon: ThoughtIcon },
          { to: '/team', label: 'Team', Icon: UsersIcon },
        ],
      },
      {
        label: 'System',
        items: [{ to: '/settings', label: 'Settings', Icon: SettingsIcon }],
      },
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
