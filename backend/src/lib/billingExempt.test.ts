import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingExemptEmailsFromEnv,
  isBillingExemptEmail,
  isCompedBillingStatus,
  parseBillingExemptEmails,
  shouldSkipUsageBilling,
} from './billingExempt.js';

describe('billing exempt allowlist', () => {
  it('parses a comma-separated list and ignores empty default', () => {
    assert.deepEqual(parseBillingExemptEmails(undefined), []);
    assert.deepEqual(parseBillingExemptEmails(''), []);
    assert.deepEqual(parseBillingExemptEmails('  jack@jettx.ai, Other@Example.com , '), [
      'jack@jettx.ai',
      'other@example.com',
    ]);
  });

  it('matches emails case-insensitively against the allowlist', () => {
    const list = parseBillingExemptEmails('jack@jettx.ai');
    assert.equal(isBillingExemptEmail('Jack@Jettx.ai', list), true);
    assert.equal(isBillingExemptEmail('customer@example.com', list), false);
    assert.equal(isBillingExemptEmail(null, list), false);
    assert.equal(isBillingExemptEmail('jack@jettx.ai', []), false);
  });

  it('reads BILLING_EXEMPT_EMAILS from the environment', () => {
    assert.deepEqual(billingExemptEmailsFromEnv({}), []);
    assert.deepEqual(billingExemptEmailsFromEnv({ BILLING_EXEMPT_EMAILS: 'a@b.co,c@d.co' }), [
      'a@b.co',
      'c@d.co',
    ]);
  });

  it('skips usage billing for comped status or an exempt creator', () => {
    const list = parseBillingExemptEmails('jack@jettx.ai');
    assert.equal(isCompedBillingStatus('comped'), true);
    assert.equal(isCompedBillingStatus('active'), false);
    assert.equal(shouldSkipUsageBilling({ status: 'comped', creatorEmail: 'paid@example.com' }), true);
    assert.equal(
      shouldSkipUsageBilling({ status: 'active', creatorEmail: 'Jack@Jettx.ai', allowlist: list }),
      true,
    );
    assert.equal(
      shouldSkipUsageBilling({ status: 'active', creatorEmail: 'paid@example.com', allowlist: list }),
      false,
    );
  });
});
