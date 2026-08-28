import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overageInvoiceLines } from './stripeOverage.js';
import type { MeteringPeriodCalculation } from '../metering/types.js';

function summary(partial: Partial<MeteringPeriodCalculation>): MeteringPeriodCalculation {
  return {
    periodStart: '2026-08-01',
    periodEnd: '2026-09-01',
    terms: {
      planCode: 'work_verification',
      planName: 'Work Verification',
      planVersion: 1,
      planVersionId: 'pv-1',
      baseMonthlyFeeCents: 59900,
      includedJobs: 50,
      additionalJobPriceCents: 3000,
      includedComputeUnits: 0,
      computeUnitOverageNanos: 0,
      videoHourPriceCents: null,
      billingPeriodDays: 30,
      periodAnchorDay: 1,
      hardStopAtLimit: false,
      usageLimitJobs: null,
      usageLimitComputeUnits: null,
      alertThresholdPct: 80,
      marginAlertPct: null,
    },
    processedJobs: 50,
    includedJobs: 50,
    excessJobs: 0,
    jobOverageChargeCents: 0,
    computeUnitsConsumed: 0,
    includedComputeUnits: 0,
    excessComputeUnits: 0,
    computeOverageChargeCents: 0,
    videoVerificationHours: 0,
    videoProcessingChargeCents: 0,
    basePlatformChargeCents: 59900,
    estimatedAiCostCents: 0,
    estimatedGrossProfitCents: 0,
    estimatedGrossMarginPct: null,
    estimatedCustomerChargeCents: 59900,
    ...partial,
  };
}

describe('overageInvoiceLines', () => {
  it('is empty when the org stayed inside the allowance', () => {
    assert.deepEqual(overageInvoiceLines(summary({})), []);
  });

  it('invoices extra jobs, not the $599 base fee', () => {
    const lines = overageInvoiceLines(
      summary({ excessJobs: 3, jobOverageChargeCents: 9000, processedJobs: 53 }),
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.amountCents, 9000);
    assert.match(lines[0]?.description ?? '', /3 additional jobs/);
  });

  it('includes compute and video lines when they have a charge', () => {
    const lines = overageInvoiceLines(
      summary({
        computeOverageChargeCents: 1500,
        videoProcessingChargeCents: 4000,
      }),
    );
    assert.equal(lines.length, 2);
    assert.equal(
      lines.reduce((sum, line) => sum + line.amountCents, 0),
      5500,
    );
  });
});
