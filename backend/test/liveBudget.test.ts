import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyBudget } from '../src/shared/liveBudget.js';

/**
 * The cost fuse. Small on purpose — the properties that matter are that the
 * cap holds, the day resets it, and one org's spending never touches another's.
 */

const at = (iso: string) => new Date(iso);

test('spending is allowed up to the cap and refused past it, with honest remainders', () => {
  const budget = new DailyBudget(3);
  const now = at('2026-08-10T09:00:00Z');
  assert.deepEqual(budget.spend('org-1', now), { allowed: true, remaining: 2 });
  assert.deepEqual(budget.spend('org-1', now), { allowed: true, remaining: 1 });
  assert.deepEqual(budget.spend('org-1', now), { allowed: true, remaining: 0 });
  assert.deepEqual(budget.spend('org-1', now), { allowed: false, remaining: 0 });
  assert.equal(budget.usedToday('org-1', now), 3, 'a refused spend is not counted as spent');
});

test('midnight UTC pays off the meter — including mid-recording', () => {
  const budget = new DailyBudget(2);
  assert.equal(budget.spend('org-1', at('2026-08-10T23:59:50Z')).allowed, true);
  assert.equal(budget.spend('org-1', at('2026-08-10T23:59:58Z')).allowed, true);
  assert.equal(budget.spend('org-1', at('2026-08-10T23:59:59Z')).allowed, false);
  // Eight seconds later it is tomorrow, and the walkthrough carries on.
  assert.deepEqual(budget.spend('org-1', at('2026-08-11T00:00:07Z')), { allowed: true, remaining: 1 });
  assert.equal(budget.usedToday('org-1', at('2026-08-11T00:00:07Z')), 1);
});

test('orgs meter separately', () => {
  const budget = new DailyBudget(1);
  const now = at('2026-08-10T12:00:00Z');
  assert.equal(budget.spend('org-1', now).allowed, true);
  assert.equal(budget.spend('org-1', now).allowed, false);
  assert.equal(budget.spend('org-2', now).allowed, true, 'a noisy neighbour is not my ceiling');
});
