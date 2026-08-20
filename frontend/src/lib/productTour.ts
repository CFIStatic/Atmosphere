/**
 * First-run guided tours — device-local completion state, simulated previews,
 * and spotlight steps over real UI where it exists.
 */

export type TourSimulation =
  | 'welcome'
  | 'verification-library'
  | 'field-capture'
  | 'job-intake'
  | 'job-files'
  | 'usage-meter';

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** Navigate here before showing the step. */
  route?: string;
  /** Spotlight a live element via [data-tour="…"]. */
  target?: string;
  /** Mini mock UI when the real surface is an iframe or not mountable yet. */
  simulation?: TourSimulation;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
};

export type ProductTourDefinition = {
  id: string;
  name: string;
  steps: TourStep[];
};

const COMPLETED_KEY = 'atmosphere.tour.completed';
const PENDING_KEY = 'atmosphere.tour.pending';

export const WORK_VERIFICATION_TOUR: ProductTourDefinition = {
  id: 'work-verification-v1',
  name: 'Work Verification walkthrough',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Atmosphere',
      body: 'Work Verification is one system with two sides: Field Capture films daily proof on site, and the Evidence Platform checks, reads, and holds that work in a chain of custody. This walkthrough shows both.',
      simulation: 'welcome',
      placement: 'center',
    },
    {
      id: 'start-job',
      title: 'Start a job',
      body: 'Before anyone films, name the job, add the site, then invite Field Capture.',
      route: '/intake',
      target: 'nav-start-job',
      simulation: 'job-intake',
      placement: 'right',
    },
    {
      id: 'verification-library',
      title: 'Dashboard',
      body: 'Jobs and clips land here after you start a job. Use + to invite people, the share icon to send a homeowner or adjuster a link, and the dots for more actions. Expand a folder to review footage.',
      route: '/verifier-library',
      simulation: 'verification-library',
      placement: 'center',
    },
    {
      id: 'job-record',
      title: 'The job record',
      body: 'Open a job to see what is happening on site, what has already been done, and what is still ahead. Scope, crew, and documents stay under job setup.',
      route: '/verifier-library',
      simulation: 'job-files',
      placement: 'center',
    },
    {
      id: 'field-capture',
      title: 'Film on site',
      body: 'Technicians pick the job, choose before or after, and follow the shot list. Detection runs on-device — clips upload when connectivity allows.',
      route: '/technician',
      target: 'capture-panel',
      simulation: 'field-capture',
      placement: 'left',
    },
    {
      id: 'usage',
      title: 'Usage & billing',
      body: 'Your dashboard shows processed jobs this period, included allowance, and estimated charges — no token counts on the invoice.',
      route: '/usage',
      simulation: 'usage-meter',
      placement: 'center',
    },
    {
      id: 'finish',
      title: 'You are ready',
      body: 'Replay this tour anytime from Settings → Preferences. Start with Start a job, hand subs the capture link, and let the record build itself.',
      placement: 'center',
    },
  ],
};

export const PRODUCT_TOURS: Record<string, ProductTourDefinition> = {
  [WORK_VERIFICATION_TOUR.id]: WORK_VERIFICATION_TOUR,
};

function readCompleted(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeCompleted(ids: string[]) {
  try {
    window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(ids));
  } catch {
    /* session-only */
  }
}

export function isTourCompleted(tourId: string): boolean {
  return readCompleted().includes(tourId);
}

export function markTourCompleted(tourId: string) {
  const ids = readCompleted();
  if (!ids.includes(tourId)) writeCompleted([...ids, tourId]);
}

export function queueProductTour(tourId: string) {
  try {
    window.localStorage.setItem(PENDING_KEY, tourId);
  } catch {
    /* ignore */
  }
}

export function takePendingTour(): string | null {
  try {
    const id = window.localStorage.getItem(PENDING_KEY);
    if (id) window.localStorage.removeItem(PENDING_KEY);
    return id;
  } catch {
    return null;
  }
}

export function clearPendingTour() {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Append ?tour=1 so ProductTourHost starts the walkthrough after navigation. */
export function withTourQuery(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('tour', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}
