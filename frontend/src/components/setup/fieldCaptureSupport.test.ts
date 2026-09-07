import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const coreSrc = readFileSync(resolve(repoRoot, 'fieldcapture/js/capture-core.js'), 'utf8');
const fieldHtml = readFileSync(resolve(repoRoot, 'fieldcapture/index.html'), 'utf8');
const fieldApp = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');

function loadCore() {
  const sandbox: Record<string, unknown> = { console, URL, URLSearchParams };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(coreSrc, sandbox);
  return sandbox.FieldCaptureCore as {
    CONTACT_PUBLIC_URL: string;
    FIELD_CAPTURE_SUPPORT_NOTE: string;
    fieldCaptureSupportPath: (loc?: { pathname?: string; search?: string; hash?: string }) => string;
    buildFieldCaptureSupportNote: (ctx?: {
      email?: string | null;
      name?: string | null;
      orgName?: string | null;
      orgId?: string | null;
      path?: string | null;
    }) => string;
    buildFieldCaptureSupportUrl: (ctx?: {
      email?: string | null;
      name?: string | null;
      orgName?: string | null;
      orgId?: string | null;
      path?: string | null;
    }) => string;
  };
}

describe('Field Capture contact support URL', () => {
  it('opens the same marketing contact form as hardware and Platform Support', () => {
    const Core = loadCore();
    const url = Core.buildFieldCaptureSupportUrl();
    expect(url.startsWith(`${Core.CONTACT_PUBLIC_URL}?`)).toBe(true);
    expect(url).toContain('contact.html');
    expect(new URL(url).searchParams.get('note')).toBe(Core.FIELD_CAPTURE_SUPPORT_NOTE);
    expect(Core.FIELD_CAPTURE_SUPPORT_NOTE).toContain('Field Capture');
    expect(Core.FIELD_CAPTURE_SUPPORT_NOTE).not.toContain('Platform');
  });

  it('prefills the form and puts org, page, and email in the Field Capture note', () => {
    const Core = loadCore();
    const url = Core.buildFieldCaptureSupportUrl({
      email: 'jack@jettx.ai',
      name: 'Jack Cyganiak',
      orgName: 'Jettx LLC',
      orgId: 'org-1',
      path: '/fieldcapture/?screen=s-home',
    });
    const params = new URL(url).searchParams;
    expect(params.get('email')).toBe('jack@jettx.ai');
    expect(params.get('name')).toBe('Jack Cyganiak');
    expect(params.get('company')).toBe('Jettx LLC');
    expect(params.get('note')).toBe(
      [
        Core.FIELD_CAPTURE_SUPPORT_NOTE,
        '',
        'Organization: Jettx LLC (org-1)',
        'Page: /fieldcapture/?screen=s-home',
        'Email: jack@jettx.ai',
      ].join('\n'),
    );
  });

  it('omits empty context lines and strips share tokens from the page path', () => {
    const Core = loadCore();
    expect(Core.buildFieldCaptureSupportNote({ path: '/fieldcapture/' })).toBe(
      `${Core.FIELD_CAPTURE_SUPPORT_NOTE}\n\nPage: /fieldcapture/`,
    );
    expect(
      Core.fieldCaptureSupportPath({
        pathname: '/fieldcapture/',
        search: '?token=secret&demo=1',
        hash: '',
      }),
    ).toBe('/fieldcapture/?demo=1');
  });

  it('puts Support in the Field Capture account menu next to Settings', () => {
    const menu = fieldHtml.indexOf('id="who-menu"');
    const settings = fieldHtml.indexOf('id="fc-menu-settings"', menu);
    const support = fieldHtml.indexOf('id="fc-menu-support"', menu);
    const signout = fieldHtml.indexOf('id="fc-menu-signout"', menu);
    expect(menu).toBeGreaterThan(-1);
    expect(settings).toBeGreaterThan(menu);
    expect(support).toBeGreaterThan(settings);
    expect(signout).toBeGreaterThan(support);
    expect(fieldApp).toContain('refreshFieldSupportLink');
    expect(fieldApp).not.toContain('openPlatformSupport');
  });
});
