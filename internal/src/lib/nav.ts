interface NavItem {
  to: string;
  label: string;
  internal?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Grouped like a report's table of contents. Internal-only rows hide for investors. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Summary',
    items: [
      { to: '/overview', label: 'Overview' },
      { to: '/north-star', label: 'North star' },
    ],
  },
  {
    title: 'Growth & revenue',
    items: [
      { to: '/growth', label: 'Revenue & customers' },
      { to: '/experiments', label: 'Experiments', internal: true },
    ],
  },
  {
    title: 'Product usage',
    items: [
      { to: '/usage', label: 'Feature usage' },
      { to: '/motion-clips', label: 'Motion clips', internal: true },
    ],
  },
  {
    title: 'Capture pipeline',
    items: [{ to: '/capture', label: 'Uploads, analysis & evidence' }],
  },
  {
    title: 'AI & Ask',
    items: [
      { to: '/ai', label: 'Ask quality' },
      { to: '/token-usage', label: 'Token usage', internal: true },
      { to: '/ai-budgets', label: 'AI budgets', internal: true },
      { to: '/metering', label: 'Metering', internal: true },
    ],
  },
  { title: 'Accounts', items: [{ to: '/accounts', label: 'Organizations', internal: true }] },
  {
    title: 'Contacts & campaigns',
    items: [
      { to: '/contacts', label: 'Contacts', internal: true },
      { to: '/campaigns', label: 'Campaigns', internal: true },
    ],
  },
  {
    title: 'System & access',
    items: [
      { to: '/access', label: 'Access', internal: true },
      { to: '/legal', label: 'Legal holds', internal: true },
      { to: '/safety', label: 'Safety', internal: true },
      { to: '/system', label: 'System status' },
    ],
  },
];

