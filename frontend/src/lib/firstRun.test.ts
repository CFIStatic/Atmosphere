import { describe, expect, it } from 'vitest';
import {
  FIELD_CAPTURE_WEB_ORIGIN,
  FIRST_RUN_HOME,
  captureAfterSignup,
  fieldCaptureInviteOpenUrl,
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

  it('promotes invite paths to the app host with the token and account gate', () => {
    expect(fieldCaptureOpenUrl('/fieldcapture/?token=tok-1')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=tok-1&account=1`,
    );
    expect(fieldCaptureOpenUrl('/fieldcapture/index.html?token=abc&email=crew%40example.com')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=abc&email=crew%40example.com&account=1`,
    );
  });
});

describe('fieldCaptureInviteOpenUrl', () => {
  it('opens classic Field Capture with token, email, and account=1', () => {
    expect(fieldCaptureInviteOpenUrl('tok123', 'Crew@Example.com')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=tok123&email=crew%40example.com&account=1`,
    );
    expect(fieldCaptureInviteOpenUrl('tok123')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=tok123&account=1`,
    );
  });

  it('returns the invitee to classic Field Capture after account create', () => {
    expect(captureAfterSignup('tok123', 'jack@roitechai.com')).toBe(
      `${FIELD_CAPTURE_WEB_ORIGIN}/?token=tok123&email=jack%40roitechai.com&account=1`,
    );
    expect(captureAfterSignup(null)).toBe(FIELD_CAPTURE_WEB_ORIGIN);
  });
});
