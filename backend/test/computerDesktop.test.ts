/**
 * Windows desktop Computer: configuration (off by default), task routing to
 * the right surface, the pinned/signed agent client, SigV4, the EC2 parser,
 * the live-view token, and the desktop driver's sign-in address check.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopAppForTask,
  desktopAppForUrl,
  desktopHostFor,
  desktopStartUrl,
  enabledDesktopApps,
  isDesktopUrl,
} from '../src/computer/desktop/config.js';
import { signAgentRequest, DesktopAgentClient, type AgentTransport, type AgentEndpoint } from '../src/computer/desktop/agentClient.js';
import { signV4 } from '../src/computer/desktop/sigv4.js';
import { parseDescribe } from '../src/computer/desktop/ec2.js';
import { mintLiveToken, verifyLiveToken, liveTokenOrg } from '../src/computer/desktop/liveView.js';
import { DesktopDriver, signalsFromText, toTarget } from '../src/computer/desktop/driver.js';
import { startComputerTask } from '../src/computer/service.js';
import { MockComputerProvider } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { setComputerWorkerDepsForTests } from '../src/computer/worker.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const CERT = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----';
const SECRET = 'x'.repeat(40);

const ENV = ['COMPUTER_DESKTOP_HOSTS', 'COMPUTER_DESKTOP_APPS', 'COMPUTER_DESKTOP_AGENT_SECRET'];
const saved: Record<string, string | undefined> = {};
function setEnv(vals: Record<string, string | undefined>) {
  for (const k of ENV) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vals)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

function hostsJson(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ [ORG]: { url: 'https://10.0.0.5:8443', cert: Buffer.from(CERT).toString('base64'), ...extra } });
}

test('off by default: no hosts, no apps, nothing routes to the desktop', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: undefined, COMPUTER_DESKTOP_APPS: undefined, COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  assert.equal(desktopHostFor(ORG), null);
  assert.deepEqual(enabledDesktopApps(), []);
  assert.equal(desktopAppForTask(ORG, { instructions: 'build the estimate in xactimate' }), null);
});

test('a host without the app switched on still does not route to the desktop', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: undefined, COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  assert.ok(desktopHostFor(ORG));
  assert.equal(desktopAppForTask(ORG, { instructions: 'do this in xactimate' }), null);
});

test('app switched on but another org has no host: that org stays on the browser', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: 'xactimate', COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  const other = '0a000000-0000-4000-8000-0000000000ff';
  assert.equal(desktopAppForTask(other, { instructions: 'xactimate please' }), null);
  const app = desktopAppForTask(ORG, { instructions: 'xactimate please' });
  assert.equal(app?.id, 'xactimate');
  assert.equal(desktopStartUrl(app!), 'app://xactimate/');
});

test('desktopAppForTask matches by start-url host and by keyword, not by unrelated text', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: 'xactimate', COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  assert.equal(desktopAppForTask(ORG, { startUrl: 'https://identity.xactware.com/' })?.id, 'xactimate');
  assert.equal(desktopAppForTask(ORG, { instructions: 'open Xactware and build it' })?.id, 'xactimate');
  // "relaxation" contains "xa" but not the word; must not match.
  assert.equal(desktopAppForTask(ORG, { instructions: 'send a relaxation email to the adjuster' }), null);
});

test('a bad host entry (missing cert) is skipped', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: JSON.stringify({ [ORG]: { url: 'https://10.0.0.5:8443' } }), COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  assert.equal(desktopHostFor(ORG), null);
});

test('a host with neither url nor ec2 is skipped', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: JSON.stringify({ [ORG]: { cert: Buffer.from(CERT).toString('base64') } }), COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  assert.equal(desktopHostFor(ORG), null);
});

test('a too-short secret rejects the host', () => {
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: 'xactimate', COMPUTER_DESKTOP_AGENT_SECRET: 'short' });
  assert.equal(desktopHostFor(ORG), null);
});

test('isDesktopUrl / desktopAppForUrl', () => {
  assert.equal(isDesktopUrl('app://xactimate/'), true);
  assert.equal(isDesktopUrl('https://x.com'), false);
  assert.equal(desktopAppForUrl('app://xactimate/projects')?.id, 'xactimate');
  assert.equal(desktopAppForUrl('app://unknown/'), null);
  assert.equal(desktopAppForUrl('https://x.com'), null);
});

test('agent request signature is stable and body-bound', () => {
  const a = signAgentRequest(SECRET, 'POST', '/input', '1700000000000', '{"action":"click"}');
  const b = signAgentRequest(SECRET, 'POST', '/input', '1700000000000', '{"action":"click"}');
  const c = signAgentRequest(SECRET, 'POST', '/input', '1700000000000', '{"action":"type"}');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('SigV4 matches the AWS published GET example', () => {
  const url = new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08');
  const headers = signV4({
    method: 'GET',
    url,
    headers: { host: 'iam.amazonaws.com', 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: '',
    service: 'iam',
    region: 'us-east-1',
    keys: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
    now: new Date('2015-08-30T12:36:00Z'),
  });
  assert.match(headers.Authorization, /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7/);
});

test('parseDescribe reads state and public IP', () => {
  const xml =
    '<DescribeInstancesResponse><reservationSet><item><instancesSet><item>' +
    '<instanceState><code>16</code><name>running</name></instanceState>' +
    '<ipAddress>203.0.113.10</ipAddress>' +
    '</item></instancesSet></item></reservationSet></DescribeInstancesResponse>';
  assert.deepEqual(parseDescribe(xml), { state: 'running', publicIp: '203.0.113.10' });
  assert.deepEqual(parseDescribe('<x><instanceState><name>stopped</name></instanceState></x>'), { state: 'stopped', publicIp: null });
});

test('live-view token round-trips, expires, and rejects a wrong secret', () => {
  const now = 1_000_000;
  const token = mintLiveToken(SECRET, { s: `${ORG}.abc`, o: ORG, e: now + 60_000, c: 1 });
  assert.equal(liveTokenOrg(token), ORG);
  const ok = verifyLiveToken(SECRET, token, now);
  assert.equal(ok?.c, 1);
  assert.equal(verifyLiveToken(SECRET, token, now + 120_000), null, 'expired');
  assert.equal(verifyLiveToken('y'.repeat(40), token, now), null, 'wrong secret');
  assert.equal(verifyLiveToken(SECRET, token + 'x', now), null, 'tampered');
});

test('signalsFromText reads MFA number, code and sign-in error from desktop text', () => {
  assert.equal(signalsFromText('Approve 42 on your phone to continue').approvalNumber, '42');
  assert.equal(signalsFromText('Your code is 884422 — enter it').visibleOtpCode, '884422');
  assert.equal(signalsFromText('The password you entered is incorrect').signInError, 'The password you entered is incorrect');
  assert.equal(signalsFromText('Welcome back').approvalNumber, null);
});

test('toTarget coerces agent output and forces web-only fields off', () => {
  const t = toTarget({ tag: 'button', label: 'Upload', isPassword: true, inForm: true });
  assert.equal(t?.label, 'Upload');
  assert.equal(t?.isPassword, true);
  assert.equal(t?.isFileInput, false);
  assert.equal(t?.href, null);
  assert.equal(toTarget(null), null);
});

/** A transport that records calls and returns scripted replies. */
class FakeTransport implements AgentTransport {
  calls: Array<{ path: string; body: unknown }> = [];
  constructor(private readonly replies: Record<string, unknown>) {}
  async request(_e: AgentEndpoint, _m: string, path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ path, body });
    return this.replies[path] ?? {};
  }
}

function driverWith(replies: Record<string, unknown>) {
  const transport = new FakeTransport(replies);
  const endpoint: AgentEndpoint = { baseUrl: 'https://10.0.0.5:8443', certPem: CERT, secret: SECRET };
  const client = new DesktopAgentClient(endpoint, transport);
  return { driver: new DesktopDriver(client, { width: 1280, height: 800 }), transport };
}

test('desktop currentUrl reports the app sign-in address only while signing in', async () => {
  const signing = driverWith({ '/window': { kind: 'app', app: 'xactimate', signIn: true } }).driver;
  assert.equal(await signing.currentUrl(), 'https://identity.xactware.com/');
  const inApp = driverWith({ '/window': { kind: 'app', app: 'xactimate', signIn: false } }).driver;
  assert.equal(await inApp.currentUrl(), 'app://xactimate/');
});

test('fillSignIn only types into the allowed sign-in host', async () => {
  const { driver, transport } = driverWith({
    '/window': { kind: 'app', app: 'xactimate', signIn: true },
    '/signin': { result: 'submitted' },
  });
  const onXactware = await driver.fillSignIn({ username: 'u', password: 'p' }, { allowHost: (h) => h === 'identity.xactware.com' });
  assert.equal(onXactware, 'submitted');
  assert.ok(transport.calls.some((c) => c.path === '/signin'));

  const blocked = driverWith({
    '/window': { kind: 'app', app: 'xactimate', signIn: true },
    '/signin': { result: 'submitted' },
  });
  const other = await blocked.driver.fillSignIn({ username: 'u', password: 'p' }, { allowHost: (h) => h === 'login.example.com' });
  assert.equal(other, 'other_site');
  assert.ok(!blocked.transport.calls.some((c) => c.path === '/signin'), 'password never sent to a disallowed host');
});

test('fillSignIn never types while an app (not its sign-in window) is in front', async () => {
  const { driver, transport } = driverWith({ '/window': { kind: 'app', app: 'xactimate', signIn: false } });
  assert.equal(await driver.fillSignIn({ username: 'u', password: 'p' }), 'no_form');
  assert.ok(!transport.calls.some((c) => c.path === '/signin'));
});


test('startComputerTask routes a Xactimate request to the desktop only when the app is on', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null, assertAiAllowed: async () => {} });

  // Off by default: the Xactimate request stays a browser task.
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: undefined, COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  const off = await startComputerTask({ orgId: ORG, userId: null, jobId: null, instructions: 'build the estimate in Xactimate for this job' });
  assert.notEqual(off.start_url, 'app://xactimate/');

  // Switched on for this org: it opens the desktop app.
  setEnv({ COMPUTER_DESKTOP_HOSTS: hostsJson(), COMPUTER_DESKTOP_APPS: 'xactimate', COMPUTER_DESKTOP_AGENT_SECRET: SECRET });
  const on = await startComputerTask({ orgId: ORG, userId: null, jobId: null, instructions: 'build the estimate in Xactimate for this job' });
  assert.equal(on.start_url, 'app://xactimate/');

  // A non-Xactimate request still goes to the browser even with the app on.
  const web = await startComputerTask({ orgId: ORG, userId: null, jobId: null, instructions: 'fill the form on https://portal.example-carrier.test/' });
  assert.equal(web.start_url, 'https://portal.example-carrier.test/');
});
