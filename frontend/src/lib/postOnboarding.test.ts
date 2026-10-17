import { describe, expect, it } from 'vitest';
import { offersInviteStep, postOnboardingHref } from './postOnboarding';

const desktop = { hostname: 'platform.atmosphereteam.com', phone: false, embedded: false };

describe('postOnboardingHref', () => {
  it('keeps computers on the office Platform, same host, already signed in', () => {
    expect(postOnboardingHref('/verifier-library', desktop)).toBe('/verifier-library');
    expect(postOnboardingHref('/job-progress?job=j1', desktop)).toBe('/job-progress?job=j1');
  });

  it('never sends a computer to Field Capture: other atmosphereteam.com hosts go to the Platform', () => {
    expect(postOnboardingHref('/verifier-library', { ...desktop, hostname: 'app.atmosphereteam.com' })).toBe(
      'https://platform.atmosphereteam.com/verifier-library',
    );
  });

  it('sends phones (native app or a narrow window) to Field Capture', () => {
    expect(postOnboardingHref('/verifier-library', { ...desktop, phone: true })).toBe('https://app.atmosphereteam.com');
  });

  it('stays on this host off atmosphereteam.com (staging, local) so the session is kept', () => {
    const staging = { hostname: 'atmosphere-web-staging.up.railway.app', phone: false, embedded: false };
    expect(postOnboardingHref('/verifier-library', staging)).toBe('/verifier-library');
    expect(postOnboardingHref('/verifier-library', { ...staging, phone: true })).toBe('/verifier-library');
    expect(postOnboardingHref('/verifier-library', { ...staging, hostname: 'localhost' })).toBe('/verifier-library');
  });

  it('leaves navigation alone inside the Field Capture iframe', () => {
    expect(postOnboardingHref('/verifier-library', { ...desktop, phone: true, embedded: true })).toBe('/verifier-library');
  });
});

describe('offersInviteStep', () => {
  it('is for computers only', () => {
    expect(offersInviteStep(desktop)).toBe(true);
    expect(offersInviteStep({ ...desktop, phone: true })).toBe(false);
    expect(offersInviteStep({ ...desktop, embedded: true })).toBe(false);
  });
});
