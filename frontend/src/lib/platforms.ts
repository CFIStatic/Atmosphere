import {
  BoltIcon,
  BriefcaseIcon,
  DecisionIcon,
  GaugeIcon,
  MicIcon,
  SettingsIcon,
  UsersIcon,
} from '../components/icons';

/**
 * The two sides of Work Verification: office (Evidence Platform) and field
 * (Field Capture). They share one console and one session.
 */
export type PlatformId = 'operations' | 'field';

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
export type MetricKey = 'openJobs' | 'crewOnJobs' | 'workedToday';

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
  /** Tiles across the top of the platform's home screen. */
  metrics: MetricKey[];
  /** The sidebar, for as long as this platform is the active one. */
  groups: NavGroup[];
}

const SYSTEM: NavGroup = {
  label: 'System',
  items: [{ to: '/settings', label: 'Settings', Icon: SettingsIcon }],
};

/** Office rail — these five labels only, in this order. */
const WORK: NavGroup = {
  label: 'Work',
  items: [
    { to: '/field', label: 'Overview', Icon: GaugeIcon },
    { to: '/my-work', label: 'My work', Icon: UsersIcon },
    { to: '/intake', label: 'Start a job', Icon: BoltIcon },
    { to: '/verifier-library', label: 'Dashboard', Icon: DecisionIcon },
    { to: '/jobs', label: 'Job Files', Icon: BriefcaseIcon },
  ],
};

export const PLATFORMS: Record<PlatformId, Platform> = {
  // The id stays 'operations' so stored preferences keep working — the brand
  // is the display fields, not the key.
  operations: {
    id: 'operations',
    name: 'Work Verification Platform',
    short: 'Verification',
    tagline: 'Prove the work',
    homeBlurb:
      'Every day of work filmed against the scope, checked at the door, read by the assistant, and held in a chain of custody — job files that create themselves from your CRM.',
    Icon: DecisionIcon,
    metrics: ['openJobs', 'crewOnJobs', 'workedToday'],
    groups: [WORK, SYSTEM],
  },

  field: {
    id: 'field',
    name: 'Field Platform',
    short: 'Field',
    tagline: 'Capture the job site',
    homeBlurb:
      'Recording, a spoken assistant, and a camera that names what it sees — built for gloved hands and a phone in the rain.',
    Icon: MicIcon,
    metrics: ['workedToday', 'crewOnJobs', 'openJobs'],
    groups: [WORK, SYSTEM],
  },
};

export const PLATFORM_IDS: PlatformId[] = ['operations', 'field'];

/**
 * What the switcher offers, office first.
 *
 * Verification is the office view (home is the Dashboard). Field is the same
 * product from the truck. Both must stay listed: leaving Verification out
 * made it a one-way door after switching to Field.
 */
export const VISIBLE_PLATFORM_IDS: PlatformId[] = ['operations', 'field'];

export const PLATFORM_HOME: Record<PlatformId, string> = {
  operations: '/verifier-library',
  field: '/field',
};

/** Field technicians land on the worker dashboard, not the office library. */
export const WORKER_HOME = '/my-work';

/** The Work Verification dashboard — logo clicks always return here. */
export const DASHBOARD_HOME = PLATFORM_HOME.operations;

/**
 * Which platform a path belongs to. Shared screens (Jobs, Settings)
 * deliberately return null: they keep whichever platform the person is in.
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
  crewOnJobs: { label: 'Crew assigned', hint: 'People on open jobs' },
  workedToday: { label: 'Worked today', hint: 'Jobs filmed or in progress today' },
};
