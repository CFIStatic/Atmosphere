import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dryingReportsFromMicaExport } from '../src/estimator/mitigation/capture/fromMica.js';
import {
  dryingReportsFromOutlookMessage,
  dryingReportsFromOutlookPayload,
} from '../src/estimator/mitigation/capture/fromOutlook.js';
import { importCapturePayload, connectorFor } from '../src/estimator/mitigation/capture/connectors.js';
import { SAMPLE_MICA } from '../src/estimator/mitigation/fixtures/sampleJob.js';
import { buildEstimate, DEFAULT_ESTIMATOR_CONFIG } from '../src/estimator/mitigation/agent.js';
import { SAMPLE_DOCUSKETCH, SAMPLE_NOTES, SAMPLE_PHOTOS } from '../src/estimator/mitigation/fixtures/sampleJob.js';

describe('dryingReportsFromMicaExport', () => {
  it('splits SAMPLE_MICA monitoring visits into a timeline', () => {
    const reports = dryingReportsFromMicaExport(SAMPLE_MICA);
    assert.equal(reports.length, SAMPLE_MICA.monitoring.length);
    assert.ok(reports.every((r) => r.source === 'mica'));
    assert.ok(reports[0].takenAt.startsWith('2026-06-17'));
    assert.match(reports[0].notes ?? '', /readings falling/i);
    // Final visit carries the full equipment snapshot.
    const last = reports[reports.length - 1];
    assert.ok((last.equipment?.length ?? 0) > 0);
    assert.ok((last.roomsAtDryStandard?.length ?? 0) + (last.roomsStillWet?.length ?? 0) > 0);
  });

  it('is idempotent on content ids across identical exports', () => {
    const a = dryingReportsFromMicaExport(SAMPLE_MICA);
    const b = dryingReportsFromMicaExport(SAMPLE_MICA);
    assert.deepEqual(
      a.map((r) => r.id),
      b.map((r) => r.id),
    );
  });
});

describe('Outlook drying report parser', () => {
  it('parses psychro, moisture, equipment, and dry/wet rooms from a mail body', () => {
    const parsed = dryingReportsFromOutlookMessage({
      id: 'msg-1',
      subject: 'Drying Report — FL-2026-0417839 Day 3',
      receivedAt: '2026-06-19T09:15:00Z',
      body: `Claim: FL-2026-0417839
Affected: 84°F / 38% RH / 58 GPP
Unaffected: 77°F / 52% RH
Kitchen drywall 11% (goal 12)
Still wet: Kitchen
At dry standard: Dining Room, Hallway
15 air movers, 3 LGR, 1 scrubber
`,
    });
    assert.equal(parsed.claimNumber, 'FL-2026-0417839');
    assert.equal(parsed.reports.length, 1);
    const report = parsed.reports[0];
    assert.equal(report.source, 'outlook');
    assert.ok((report.psychrometrics?.length ?? 0) >= 2);
    assert.ok((report.moistureReadings?.length ?? 0) >= 1);
    assert.ok(report.roomsStillWet?.includes('Kitchen'));
    assert.ok(report.roomsAtDryStandard?.some((r) => /dining/i.test(r)));
    assert.ok(report.equipment?.some((e) => e.kind === 'air_mover' && e.quantity === 15));
  });

  it('ignores unrelated mail', () => {
    const parsed = dryingReportsFromOutlookMessage({
      subject: 'Lunch orders',
      body: 'Please bring sandwiches.',
    });
    assert.equal(parsed.reports.length, 0);
    assert.ok(parsed.warnings.length > 0);
  });

  it('accepts a Graph-style message list payload', () => {
    const parsed = dryingReportsFromOutlookPayload({
      value: [
        {
          id: 'g1',
          subject: 'Drying Report claim FL-2026-0417839',
          receivedDateTime: '2026-06-19T10:00:00Z',
          body: { content: 'Affected: 80 F / 40% RH\n6 air movers\nStill wet: Kitchen' },
          from: { emailAddress: { address: 'tech@example.com' } },
        },
      ],
    });
    assert.equal(parsed.reports.length, 1);
    assert.equal(parsed.reports[0].source, 'outlook');
  });
});

describe('capture import → modified estimate', () => {
  it('imports MICA Dash payload and modifies the estimate automatically', () => {
    const pull = importCapturePayload('mica_dash', SAMPLE_MICA, {
      jobId: 'capture-demo',
      claimNumber: SAMPLE_MICA.job.claimNumber,
    });
    assert.ok(pull.reports.length >= 4);

    const baseline = buildEstimate(
      {
        jobId: 'capture-demo',
        docusketch: SAMPLE_DOCUSKETCH,
        mica: SAMPLE_MICA,
        photos: SAMPLE_PHOTOS,
        notes: SAMPLE_NOTES,
      },
      DEFAULT_ESTIMATOR_CONFIG,
    );

    const updated = buildEstimate(
      {
        jobId: 'capture-demo',
        docusketch: SAMPLE_DOCUSKETCH,
        mica: SAMPLE_MICA,
        photos: SAMPLE_PHOTOS,
        notes: SAMPLE_NOTES,
        dryingReports: pull.reports,
      },
      DEFAULT_ESTIMATOR_CONFIG,
    );

    assert.ok(updated.dryingProgress);
    assert.ok(updated.dryingProgress!.visitCount >= pull.reports.length);
    assert.ok(updated.assessment.dryingDays >= baseline.assessment.dryingDays);
    assert.ok(updated.equipmentPlan);
    // Narrative / progress should reflect the capture timeline.
    assert.ok(
      updated.dryingProgress!.timeline.some((t) => t.source === 'mica'),
      'timeline should cite mica visits',
    );
  });

  it('sandbox connectors return pullable visits without credentials', async () => {
    const mica = connectorFor('mica_dash');
    const outlook = connectorFor('outlook');
    const micaPull = await mica.pull({ jobId: 'sandbox-job' });
    const outlookPull = await outlook.pull({
      jobId: 'sandbox-job',
      claimNumber: SAMPLE_MICA.job.claimNumber,
    });
    assert.equal(micaPull.mode, 'sandbox');
    assert.ok(micaPull.reports.length > 0);
    assert.equal(outlookPull.mode, 'sandbox');
    assert.ok(outlookPull.reports.length > 0);
    assert.equal(outlookPull.reports[0].source, 'outlook');
  });
});
