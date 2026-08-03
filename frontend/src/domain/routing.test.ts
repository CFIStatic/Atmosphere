import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLD, needsClarification, routeRequest } from './routing';

/**
 * Routing decides which capability acts on a request. Users never pick an
 * agent, so a misroute is invisible to them until something wrong happens —
 * which makes these cases worth pinning down.
 */

describe('routeRequest', () => {
  it('routes scheduling language to scheduling', () => {
    expect(routeRequest('reschedule the crew for tomorrow').capability).toBe('scheduling');
    expect(routeRequest('who is available to dispatch on Monday?').capability).toBe('scheduling');
  });

  it('routes money language to collections', () => {
    expect(routeRequest('send a reminder on the past due invoice').capability).toBe('collections');
    expect(routeRequest('what is our overdue balance?').capability).toBe('collections');
  });

  it('routes scope language to estimating', () => {
    expect(routeRequest('file a supplement in Xactimate').capability).toBe('estimating');
  });

  it('routes documentation requirements to compliance', () => {
    expect(routeRequest('is the certificate of completion signed?').capability).toBe('compliance');
  });

  it('routes customer outreach to customer comms', () => {
    expect(routeRequest('email the homeowner an update').capability).toBe('customer_comms');
  });

  it('falls back to project management when nothing matches', () => {
    const result = routeRequest('zzzz qqqq');
    expect(result.capability).toBe('project_management');
    expect(result.matched).toEqual([]);
  });

  it('reports low confidence on an unmatched request', () => {
    expect(needsClarification(routeRequest('zzzz qqqq'))).toBe(true);
  });

  it('is confident on an unambiguous request', () => {
    const result = routeRequest('file a supplement in Xactimate for the scope variance');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(needsClarification(result)).toBe(false);
  });

  it('never exceeds a calibrated ceiling', () => {
    // Confidence is damped on purpose — a keyword classifier claiming certainty
    // would justify acting without confirmation, which it has not earned.
    const result = routeRequest('schedule schedule schedule crew dispatch calendar');
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('is case insensitive', () => {
    expect(routeRequest('RESCHEDULE THE CREW').capability).toBe('scheduling');
  });

  it('reports which terms drove the decision', () => {
    const result = routeRequest('send the overdue invoice reminder');
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.capability).toBe('collections');
  });
});
