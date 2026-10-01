import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { billedUsageRateClause } from './usageDisplayRates.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('pricing shows an AI usage allowance and not internal economics', () => {
  const clause = billedUsageRateClause();
  assert.match(clause, /AI usage allowance/);
  assert.doesNotMatch(clause, /10×|provider cost|10%|per million/i);

  const pricing = readFileSync(resolve(repoRoot, 'website/pricing.html'), 'utf8');
  assert.ok(pricing.includes(clause), 'pricing.html must show billedUsageRateClause()');
  assert.match(pricing, /each plan includes an AI usage allowance/i);
  assert.doesNotMatch(pricing, /10×|provider cost|10% annual|billed the day/i);
});
