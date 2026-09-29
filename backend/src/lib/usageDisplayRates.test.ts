import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { billedUsageRateClause } from './usageDisplayRates.js';
import { verificationConfig } from '../verification/config.js';
import { usageCustomerMarkup } from '../metering/customerMarkup.js';
import { ANALYSIS_UNIT_CENTS } from './stripeInvoices.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('displayed usage rates match the billed constants', () => {
  const markup = usageCustomerMarkup(process.env);
  const videoIn = verificationConfig.geminiInputPerMTokUsd * markup;
  const videoOut = verificationConfig.geminiOutputPerMTokUsd * markup;
  const escIn = verificationConfig.anthropicInputPerMTokUsd * markup;
  const escOut = verificationConfig.anthropicOutputPerMTokUsd * markup;
  const clause = billedUsageRateClause();
  assert.match(clause, new RegExp(`\\$${videoIn.toFixed(2)} per million input tokens`));
  assert.match(clause, new RegExp(`\\$${videoOut.toFixed(2)} per million output tokens`));
  assert.match(clause, new RegExp(`\\$${escIn.toFixed(2)} per million input tokens`));
  assert.match(clause, new RegExp(`\\$${escOut.toFixed(2)} per million output tokens`));
  assert.match(clause, new RegExp(`\\$${(ANALYSIS_UNIT_CENTS / 100).toFixed(2)} each`));
  assert.doesNotMatch(clause, /10×|provider cost|10% annual/i);

  const pricing = readFileSync(resolve(repoRoot, 'website/pricing.html'), 'utf8');
  assert.ok(pricing.includes(clause), 'pricing.html must show billedUsageRateClause()');
  assert.match(pricing, /\$1\.00 per million input tokens/);
  assert.doesNotMatch(pricing, /10×|provider cost/);
});
