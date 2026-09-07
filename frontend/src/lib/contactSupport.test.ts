import { describe, expect, it } from 'vitest';
import {
  buildPlatformSupportNote,
  buildPlatformSupportUrl,
  CONTACT_PUBLIC_URL,
  PLATFORM_SUPPORT_NOTE,
} from './contactSupport';

describe('platform contact support URL', () => {
  it('opens the same marketing contact form as hardware Support', () => {
    const url = buildPlatformSupportUrl();
    expect(url.startsWith(`${CONTACT_PUBLIC_URL}?`)).toBe(true);
    expect(url).toContain('contact.html');
    expect(new URL(url).searchParams.get('note')).toBe(PLATFORM_SUPPORT_NOTE);
  });

  it('prefills the form and puts org, plan, page, and email in the note', () => {
    const url = buildPlatformSupportUrl({
      email: 'jack@jettx.ai',
      name: 'Jack Cyganiak',
      orgName: 'Jettx LLC',
      orgId: 'org-1',
      plan: 'Work Verification',
      path: '/settings?section=support',
    });
    const params = new URL(url).searchParams;
    expect(params.get('email')).toBe('jack@jettx.ai');
    expect(params.get('name')).toBe('Jack Cyganiak');
    expect(params.get('company')).toBe('Jettx LLC');
    expect(params.get('note')).toBe(
      [
        PLATFORM_SUPPORT_NOTE,
        '',
        'Organization: Jettx LLC (org-1)',
        'Plan: Work Verification',
        'Page: /settings?section=support',
        'Email: jack@jettx.ai',
      ].join('\n'),
    );
  });

  it('omits empty context lines from the note', () => {
    expect(buildPlatformSupportNote({ path: '/verifier-library' })).toBe(
      `${PLATFORM_SUPPORT_NOTE}\n\nPage: /verifier-library`,
    );
  });
});
