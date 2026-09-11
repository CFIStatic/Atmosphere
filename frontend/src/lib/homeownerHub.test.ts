import { describe, expect, it } from 'vitest';
import {
  grantStatusLabel,
  HOMEOWNER_HUB_PATH,
  homeownerAfterSignup,
  isHomeownerHubPath,
  isHomeownerViewerPath,
} from './homeownerHub';

describe('homeowner hub paths', () => {
  it('does not collide with the sub /my-jobs list', () => {
    expect(HOMEOWNER_HUB_PATH).toBe('/my-job-files');
    expect(isHomeownerHubPath('/my-jobs')).toBe(false);
    expect(isHomeownerHubPath('/my-job-files')).toBe(true);
  });

  it('treats progress and claimed job files as viewer deep links', () => {
    expect(isHomeownerViewerPath('/job-progress?job=abc')).toBe(true);
    expect(isHomeownerViewerPath('/progress/tok')).toBe(true);
    expect(isHomeownerViewerPath('/verifier-library')).toBe(false);
    expect(isHomeownerViewerPath('/signup')).toBe(false);
  });

  it('keeps a job deep link after homeowner signup', () => {
    expect(homeownerAfterSignup('/progress/tok')).toBe('/progress/tok');
    expect(homeownerAfterSignup('/verifier-library')).toBe(HOMEOWNER_HUB_PATH);
    expect(homeownerAfterSignup('/job-progress?job=abc')).toBe('/job-progress?job=abc');
  });

  it('labels optional job status in plain words', () => {
    expect(grantStatusLabel('in_progress')).toBe('In progress');
    expect(grantStatusLabel(null)).toBeNull();
  });
});
