import { describe, expect, it } from 'vitest';
import {
  FIELD_CAPTURE_WEB_ORIGIN,
  FIRST_RUN_HOME,
  fieldCaptureOpenUrl,
  firstRunDestination,
} from './firstRun';

describe('firstRunDestination', () => {
  it('sends generic post-auth homes to Start a job', () => {
    expect(firstRunDestination(null, '/verifier-library')).toBe(FIRST_RUN_HOME);
    expect(firstRunDestination('/verifier-library', '/verifier-library')).toBe(FIRST_RUN_HOME);
    expect(firstRunDestination('/jobs', '/verifier-library')).toBe(FIRST_RUN_HOME);
    expect(firstRunDestination('/signup?step=2', '/verifier-library')).toBe(FIRST_RUN_HOME);
  });

  it('keeps a specific deep link', () => {
    expect(firstRunDestination('/job-progress?job=abc', '/verifier-library')).toBe(
      '/job-progress?job=abc',
    );
    expect(firstRunDestination('/settings?section=billing', '/verifier-library')).toBe(
      '/settings?section=billing',
    );
  });
});

describe('fieldCaptureOpenUrl', () => {
  it('opens the public Field Capture host by default', () => {
    expect(fieldCaptureOpenUrl(null)).toBe(FIELD_CAPTURE_WEB_ORIGIN);
    expect(fieldCaptureOpenUrl('')).toBe(FIELD_CAPTURE_WEB_ORIGIN);
  });

  it('promotes invite paths to the app host with the token', () => {
    expect(fieldCaptureOpenUrl('/fieldcapture/?token=tok-1')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=tok-1`,
    );
    expect(fieldCaptureOpenUrl('/fieldcapture/index.html?token=abc')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=abc`,
    );
  });
});
