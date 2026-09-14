import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_PROOF_PACK_SCHEMA,
  buildJobProofPack,
  formatProofPackClock,
  selectPublicFrames,
} from '../src/shared/jobProofPack.js';
import { PRIVACY_REDACTED_LABEL } from '../src/audio/privacyRedactions.js';
import { renderJobProofPackPdf, proofPackFilename } from '../src/shared/jobProofPackPdf.js';

test('formatProofPackClock formats m:ss and h:mm:ss', () => {
  assert.equal(formatProofPackClock(65), '1:05');
  assert.equal(formatProofPackClock(3661), '1:01:01');
  assert.equal(formatProofPackClock(null), '—');
});

test('selectPublicFrames skips privacy ranges and spreads picks', () => {
  const frames = [0, 10, 20, 30, 40, 50].map((atSeconds) => ({
    proofId: 'pf-1',
    atSeconds,
    storagePath: `frames/${atSeconds}.jpg`,
  }));
  const picked = selectPublicFrames(frames, [{ startSec: 18, endSec: 35, reason: 'bathroom', confidence: 0.9, source: 'vision' }], 3);
  assert.ok(picked.every((f) => f.atSeconds < 18 || f.atSeconds >= 35));
  assert.equal(picked.length, 3);
  assert.ok(!picked.some((f) => f.atSeconds === 20 || f.atSeconds === 30));
});

test('buildJobProofPack omits private quotes and notes redactions', () => {
  const pack = buildJobProofPack({
    exportedAt: '2026-09-14T18:00:00.000Z',
    job: {
      id: 'job-1',
      number: 1042,
      name: 'Cedar Ridge',
      claimNumber: 'CLM-9',
      address: '12 Oak St',
      workType: 'water',
    },
    days: [
      {
        partyId: 'pty-1',
        company: 'Delgado Roofing',
        workDate: '2026-09-10',
        summary: 'Checks passed',
        aiSummary: 'Crew replaced underlayment on the north slope.',
        accepted: true,
        payable: true,
        payableBecause: 'Day verified',
        materialChange: 'significant',
        aiFindings: {
          workPerformed: ['Underlayment replaced'],
          concerns: ['Ladder angle was steep'],
        },
        proofIds: ['pf-1'],
      },
    ],
    videos: [
      {
        id: 'pf-1',
        workDate: '2026-09-10',
        phase: 'after',
        company: 'Delgado Roofing',
        person: 'Hector Delgado',
        aiSummary: 'Crew replaced underlayment on the north slope.',
        people: { people: [{ displayName: 'Hector Delgado' }, { label: 'Homeowner' }] },
        privacyRedactions: {
          version: 1,
          ranges: [{ startSec: 40, endSec: 70, reason: 'bathroom', confidence: 0.8, source: 'vision' }],
        },
        conversation: {
          conversationTurns: [
            { tSec: 12, speakerLabel: 'Hector', text: 'We will finish the ridge tomorrow.' },
            { tSec: 55, speakerLabel: 'Homeowner', text: 'private bathroom talk' },
          ],
          conversationActionItems: [
            { text: 'Finish ridge tomorrow', tSec: 12, quote: 'finish the ridge tomorrow', owner: 'Hector' },
          ],
          conversationAgreementFacts: [
            { text: 'Homeowner approved the underlayment change', tSec: 20, quote: 'that is fine' },
          ],
        },
        evidenceLog: [
          { atSeconds: 12, text: 'We will finish the ridge tomorrow.', type: 'said', speakerLabel: 'Hector' },
          { atSeconds: 55, text: PRIVACY_REDACTED_LABEL, type: 'said', quote: PRIVACY_REDACTED_LABEL },
        ],
      },
    ],
    framesByProof: new Map([
      [
        'pf-1',
        [
          { proofId: 'pf-1', atSeconds: 5, storagePath: 'a.jpg' },
          { proofId: 'pf-1', atSeconds: 55, storagePath: 'private.jpg' },
          { proofId: 'pf-1', atSeconds: 90, storagePath: 'b.jpg' },
        ],
      ],
    ]),
    disputes: [{ title: 'Scope gap', detail: 'Skylight not filmed', severity: 'medium', workDate: '2026-09-10' }],
  });

  assert.equal(pack.schema, JOB_PROOF_PACK_SCHEMA);
  assert.equal(pack.job.number, 1042);
  assert.ok(pack.overview.whatHappened.some((line) => /underlayment/i.test(line)));
  assert.ok(pack.overview.who.some((line) => /Hector/i.test(line)));
  assert.ok(pack.overview.decisions.some((line) => /accepted/i.test(line)));
  assert.ok(pack.overview.nextSteps.some((line) => /ridge/i.test(line)));

  const clip = pack.clips[0]!;
  assert.equal(clip.privacyRangesRedacted, 1);
  assert.ok(clip.quotes.every((q) => q.text !== PRIVACY_REDACTED_LABEL));
  assert.ok(!clip.quotes.some((q) => (q.tSec ?? -1) >= 40 && (q.tSec ?? -1) < 70));
  assert.ok(clip.frames.every((f) => f.atSeconds !== 55));
  assert.ok(clip.frames.some((f) => f.atSeconds === 5));
  assert.match(pack.privacyNotice, /redacted/i);
  assert.equal(pack.disputes.length, 1);
});

test('workDate filter limits days and clips', () => {
  const pack = buildJobProofPack({
    workDateFilter: '2026-09-11',
    job: { id: 'job-1', number: 1, name: 'A' },
    days: [
      { partyId: 'p', company: 'C', workDate: '2026-09-10', proofIds: ['a'] },
      { partyId: 'p', company: 'C', workDate: '2026-09-11', proofIds: ['b'] },
    ],
    videos: [
      { id: 'a', workDate: '2026-09-10', company: 'C' },
      { id: 'b', workDate: '2026-09-11', company: 'C', aiSummary: 'Day two work' },
    ],
  });
  assert.equal(pack.workDateFilter, '2026-09-11');
  assert.equal(pack.days.length, 1);
  assert.equal(pack.clips.length, 1);
  assert.equal(pack.clips[0]!.id, 'b');
});

test('renderJobProofPackPdf returns a PDF buffer', async () => {
  const pack = buildJobProofPack({
    job: { id: 'job-9', number: 9, name: 'Test Job' },
    days: [],
    videos: [
      {
        id: 'pf',
        workDate: '2026-09-01',
        company: 'Crew',
        aiSummary: 'Tarped the south slope.',
        conversation: {
          conversationTurns: [{ tSec: 3, speakerLabel: 'Tech', text: 'Tarp is secure.' }],
        },
      },
    ],
  });
  const pdf = await renderJobProofPackPdf(pack);
  assert.ok(pdf.length > 200);
  assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF');
  assert.equal(proofPackFilename(pack), 'atmosphere-proof-pack-job-9.pdf');
  assert.equal(
    proofPackFilename({ ...pack, workDateFilter: '2026-09-01' }),
    'atmosphere-proof-pack-job-9-2026-09-01.pdf',
  );
});
