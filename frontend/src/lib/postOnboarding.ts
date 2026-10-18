import { isInAppShell } from './appShell';
import { isFieldEmbedMarked, isPhoneShellViewport } from './fieldEmbed';
import { FIELD_CAPTURE_WEB_ORIGIN } from './firstRun';

/** The office Platform (Dashboard, Start a job, Settings). */
export const PLATFORM_WEB_ORIGIN = 'https://platform.atmosphereteam.com';

const ATMOSPHERE_SITE = 'atmosphereteam.com';
const PLATFORM_HOST = 'platform.atmosphereteam.com';

export interface PostOnboardingEnv {
  /** Current page host, e.g. platform.atmosphereteam.com. */
  hostname: string;
  /** Phone: the iPhone/Android app (user agent) or a viewport ≤ 640px wide. */
  phone: boolean;
  /** This console is inside Field Capture's Dashboard iframe. */
  embedded: boolean;
  /** Platform-only seat: never sent to Field Capture, even from a phone. */
  platformSeat?: boolean;
}

/**
 * Phone vs computer, for where onboarding ends. A phone is the native
 * Field Capture app (its web view appends "AtmosphereFieldCapture" to the user
 * agent) or a browser window no wider than the phone shell (640px). Anything
 * wider is a computer.
 */
export function currentPostOnboardingEnv(): PostOnboardingEnv {
  const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
  return {
    hostname,
    phone: isInAppShell() || isPhoneShellViewport(),
    embedded: isFieldEmbedMarked(),
  };
}

function onAtmosphereSite(hostname: string): boolean {
  return hostname === ATMOSPHERE_SITE || hostname.endsWith(`.${ATMOSPHERE_SITE}`);
}

/**
 * Where a Global Admin lands once onboarding is done (paid checkout, or a
 * comped / billing-exempt workspace). Computers open the office Platform at
 * `path`; phones open Field Capture. The session cookie is scoped to
 * atmosphereteam.com, so either host is already signed in.
 *
 * Off atmosphereteam.com (staging on *.up.railway.app, local dev) the cookie
 * is host-only, so we stay on this host rather than drop the session.
 * Inside Field Capture's iframe the frame keeps its own navigation.
 */
export function postOnboardingHref(path: string, env: PostOnboardingEnv = currentPostOnboardingEnv()): string {
  if (env.embedded) return path;
  const host = env.hostname.toLowerCase();
  if (!onAtmosphereSite(host)) return path;
  if (env.phone && !env.platformSeat) return FIELD_CAPTURE_WEB_ORIGIN;
  if (host === PLATFORM_HOST) return path;
  return `${PLATFORM_WEB_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The optional Invite team screen is for computers only; phones go straight to Field Capture. */
export function offersInviteStep(env: PostOnboardingEnv = currentPostOnboardingEnv()): boolean {
  return !env.phone && !env.embedded;
}

export function isAbsoluteHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
