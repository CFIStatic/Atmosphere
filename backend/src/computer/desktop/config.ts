/**
 * Desktop Computer settings: which orgs have a Windows desktop, how to reach
 * it, and which desktop apps Computer may open there.
 *
 * Everything is off until an operator sets it. Read from the environment on
 * every call, like the rest of Computer's settings, so a redeploy with new
 * variables takes effect without a code change.
 *
 *   COMPUTER_DESKTOP_AGENT_SECRET  HMAC key every desktop agent shares with this server (32+ chars).
 *   COMPUTER_DESKTOP_HOSTS         JSON map of org id → host (below).
 *   COMPUTER_DESKTOP_APPS          Comma list of desktop apps Computer may open (e.g. "xactimate").
 *                                  Empty (the default) = no desktop app is offered to anyone.
 *   COMPUTER_DESKTOP_IDLE_STOP_MIN Minutes a started EC2 desktop stays on with nothing to do [15].
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  Only for hosts with "ec2" (start/stop on demand).
 *
 * A host is either always on:
 *   { "url": "https://203.0.113.10:8443", "cert": "<base64 of the agent's cert.pem>" }
 * or an EC2 instance Computer starts for a task and stops when idle:
 *   { "ec2": { "instanceId": "i-0abc…", "region": "us-east-1" }, "port": 8443, "cert": "…" }
 *
 * "cert" is the agent's self-signed certificate. It is the only certificate
 * trusted for that host, so a machine that takes over the IP cannot pose as
 * the agent. "secret" on a host overrides the shared secret for that org.
 */
import { cleanEnvSecret } from '../config.js';

export interface DesktopEc2Target {
  instanceId: string;
  region: string;
}

export interface DesktopHostConfig {
  orgId: string;
  /** Fixed agent URL (always-on host). */
  url: string | null;
  ec2: DesktopEc2Target | null;
  port: number;
  /** PEM of the agent's own certificate (pinned). */
  certPem: string;
  secret: string;
}

/** A desktop app Computer can open on an org's Windows desktop. */
export interface DesktopApp {
  id: string;
  name: string;
  /**
   * Web address the app's own sign-in window belongs to. While that window is
   * up, the driver reports this address so a saved login for that site (and
   * only that site) can be typed into it.
   */
  signInUrl: string | null;
  /** Web hosts that mean "this app" when a task's start URL points at one. */
  webHosts: string[];
  /** Words in a request that mean "this app" (whole-word, case-insensitive). */
  keywords: string[];
  /** Short guide lines for the agent's prompt. */
  guide: string[];
}

export const DESKTOP_APPS: readonly DesktopApp[] = [
  {
    id: 'xactimate',
    name: 'Xactimate (desktop)',
    signInUrl: 'https://identity.xactware.com/',
    webHosts: ['identity.xactware.com', 'xactware.com', 'xactimate.com'],
    keywords: ['xactimate', 'xactware'],
    guide: [
      'This is Xactimate desktop on a Windows computer, not a website. Click and type on the screen; there is no address bar.',
      'If Xactimate is not open, call open_url with "app://xactimate" to start it.',
      'Sign-in: when Xactimate shows its Verisk sign-in window, call sign_in_saved with site "identity.xactware.com". A verification code or phone approval is done by the person: ask for it with needs_you.',
      'Projects live on the Projects dashboard. Open the project for this job only (claim number, insured name or address).',
      'Request approval before Upload, Send, Sync to XactAnalysis, Finalize, Delete or any control that sends the estimate anywhere.',
    ],
  },
];

export const DESKTOP_URL_SCHEME = 'app:';

export function desktopAppById(id: string | null | undefined): DesktopApp | null {
  if (!id) return null;
  return DESKTOP_APPS.find((a) => a.id === id.toLowerCase()) ?? null;
}

/** "app://xactimate/…" → the Xactimate app entry; anything else → null. */
export function desktopAppForUrl(url: string | null | undefined): DesktopApp | null {
  if (!url || !url.toLowerCase().startsWith('app://')) return null;
  try {
    return desktopAppById(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function isDesktopUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.toLowerCase().startsWith('app://'));
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

export function desktopIdleStopMs(): number {
  return intEnv('COMPUTER_DESKTOP_IDLE_STOP_MIN', 15, 1, 24 * 60) * 60_000;
}

function sharedSecret(): string {
  return cleanEnvSecret('COMPUTER_DESKTOP_AGENT_SECRET', process.env.COMPUTER_DESKTOP_AGENT_SECRET);
}

const MIN_SECRET = 32;

function decodePem(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const pem = text.includes('BEGIN CERTIFICATE') ? text : Buffer.from(text, 'base64').toString('utf8');
  return pem.includes('-----BEGIN CERTIFICATE-----') ? pem : null;
}

function parseHost(orgId: string, raw: unknown): DesktopHostConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const certPem = decodePem(r.cert);
  const secret = typeof r.secret === 'string' && r.secret.trim() ? r.secret.trim() : sharedSecret();
  if (!certPem || secret.length < MIN_SECRET) return null;
  const port = Number.isInteger(r.port) && (r.port as number) > 0 && (r.port as number) < 65536 ? (r.port as number) : 8443;
  let url: string | null = null;
  if (typeof r.url === 'string') {
    try {
      const u = new URL(r.url);
      if (u.protocol === 'https:') url = `https://${u.host}`;
    } catch {
      url = null;
    }
  }
  let ec2: DesktopEc2Target | null = null;
  const e = r.ec2 as Record<string, unknown> | undefined;
  if (e && typeof e.instanceId === 'string' && /^i-[0-9a-f]{8,32}$/.test(e.instanceId) && typeof e.region === 'string' && /^[a-z]{2}(-[a-z]+)+-\d$/.test(e.region)) {
    ec2 = { instanceId: e.instanceId, region: e.region };
  }
  if (!url && !ec2) return null;
  return { orgId, url, ec2, port, certPem, secret };
}

/** Every configured desktop host, by org id. Bad entries are skipped. */
export function desktopHosts(): Map<string, DesktopHostConfig> {
  const out = new Map<string, DesktopHostConfig>();
  const raw = (process.env.COMPUTER_DESKTOP_HOSTS ?? '').trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [orgId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const host = parseHost(orgId, value);
    if (host) out.set(orgId, host);
  }
  return out;
}

export function desktopHostFor(orgId: string): DesktopHostConfig | null {
  return desktopHosts().get(orgId) ?? null;
}

/** Apps switched on by the operator (COMPUTER_DESKTOP_APPS). */
export function enabledDesktopApps(): DesktopApp[] {
  const ids = (process.env.COMPUTER_DESKTOP_APPS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return DESKTOP_APPS.filter((a) => ids.includes(a.id));
}

/** The app is switched on AND this org has a desktop. Both are needed. */
export function desktopAppEnabledFor(orgId: string, appId: string): boolean {
  return enabledDesktopApps().some((a) => a.id === appId) && desktopHostFor(orgId) !== null;
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/**
 * The enabled desktop app a task should open, if any: the task's start URL
 * points at the app's web host, or its request names the app. Returns null
 * unless the app is switched on and the org has a computer — so with nothing
 * configured (the default) every task stays in the cloud browser.
 */
export function desktopAppForTask(orgId: string, task: { startUrl?: string | null; instructions?: string | null }): DesktopApp | null {
  if (!desktopHostFor(orgId)) return null;
  const host = hostOf(task.startUrl);
  const text = (task.instructions ?? '').toLowerCase();
  for (const app of enabledDesktopApps()) {
    if (host && app.webHosts.some((h) => hostMatches(host, h))) return app;
    if (app.keywords.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(text))) return app;
  }
  return null;
}

/** The start URL that opens a desktop app ("app://xactimate/"). */
export function desktopStartUrl(app: DesktopApp): string {
  return `app://${app.id}/`;
}

export function awsCredentials(): { accessKeyId: string; secretAccessKey: string; sessionToken: string | null } | null {
  const accessKeyId = cleanEnvSecret('AWS_ACCESS_KEY_ID', process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = cleanEnvSecret('AWS_SECRET_ACCESS_KEY', process.env.AWS_SECRET_ACCESS_KEY);
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = cleanEnvSecret('AWS_SESSION_TOKEN', process.env.AWS_SESSION_TOKEN) || null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

/** Customer-facing: the org asked for a desktop app it does not have. */
export const DESKTOP_NOT_SET_UP_MESSAGE =
  "Your company's Windows computer for Computer isn't set up yet, so Computer can't open desktop apps for you.";
