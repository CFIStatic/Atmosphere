import { describe, expect, it, beforeEach } from 'vitest';
import {
  isTourCompleted,
  markTourCompleted,
  queueProductTour,
  takePendingTour,
  withTourQuery,
  WORK_VERIFICATION_TOUR,
} from './productTour';

describe('productTour storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('queues and takes a pending tour once', () => {
    queueProductTour(WORK_VERIFICATION_TOUR.id);
    expect(takePendingTour()).toBe(WORK_VERIFICATION_TOUR.id);
    expect(takePendingTour()).toBeNull();
  });

  it('tracks completion', () => {
    expect(isTourCompleted(WORK_VERIFICATION_TOUR.id)).toBe(false);
    markTourCompleted(WORK_VERIFICATION_TOUR.id);
    expect(isTourCompleted(WORK_VERIFICATION_TOUR.id)).toBe(true);
  });

  it('appends tour query param to redirect paths', () => {
    expect(withTourQuery('/verifier-library')).toBe('/verifier-library?tour=1');
    expect(withTourQuery('/usage?period=month')).toBe('/usage?period=month&tour=1');
  });
});
