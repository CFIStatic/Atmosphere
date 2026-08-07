import { describe, expect, it, beforeEach } from 'vitest';
import {
  isTourCompleted,
  markTourCompleted,
  queueProductTour,
  takePendingTour,
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
});
