/**
 * Browser-tab titles for the hosted dashboard.
 *
 * Every surface ends in "Atmosphere" so a deployed tab reads as the product
 * (bars favicon + name), not a generic Vite/React page.
 */
import { parseSignupIntent } from './authRedirect';

export const APP_NAME = 'Atmosphere';

const PAGE_TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/signup': 'Create your organization',
  '/forgot-password': 'Reset password',
  '/reset-password': 'Choose a new password',
  '/onboarding': 'Set up',
  '/verifier-library': 'Dashboard',
  '/intake': 'Start a job',
  '/job-progress': 'Job file',
  '/jobs': 'Jobs',
  '/memory': 'Memory',
  '/team': 'People',
  '/technician': 'Field capture',
  '/pm': 'Projects',
  '/finance': 'Finance',
  '/web-access': 'Web access',
  '/connectors': 'Connections',
  '/billing': 'Billing',
  '/usage': 'Usage',
  '/estimator': 'Estimator',
  '/computer-use': 'Computer use',
  '/mitigation': 'Mitigation',
  '/sales-agent': 'Sales agent',
  '/email-marketing': 'Email',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/analytics': 'Analytics',
  '/analytics/investor': 'Investor analytics',
  '/audit': 'Audit',
  '/my-work': 'My Work',
  '/approvals': 'Approvals',
  '/schedule': 'Schedule',
  '/customers': 'Customers',
  '/pipeline': 'Pipeline',
  '/prospector': 'Find contacts',
  '/profiler': 'Profiler',
  '/campaigns': 'Campaigns',
  '/territories': 'Territories',
  '/work': "What's happening",
  '/purchase-orders': 'Purchase orders',
  '/costing': 'Job costing',
  '/sales': 'Sales',
  '/operations': 'Verification',
  '/field': 'Field',
  '/manager': 'Manager',
  '/my-jobs': 'My jobs',
  '/shared': 'Shared job',
  '/report': 'Report',
  '/progress': 'Job progress',
  '/share/finance': 'Financial share',
};

function pageNameFor(pathname: string): string | undefined {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];

  const match = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => pathname.startsWith(`${prefix}/`));
  return match ? PAGE_TITLES[match] : undefined;
}

/** Title shown in the browser tab for a dashboard path. */
export function documentTitleFor(pathname: string, search = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  if (pathname === '/signup' || pathname.startsWith('/signup/')) {
    const page =
      parseSignupIntent(params.get('intent')) === 'join'
        ? 'Link to the office account'
        : 'Create your organization';
    return `${page} · ${APP_NAME}`;
  }

  const page = pageNameFor(pathname);
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}
