import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_READY_PACKET_SCHEMA,
  buildClaimReadyPacket,
  isClaimReadyPacket,
} from '../src/shared/claimReadyPacket.js';
import { PRIVACY_REDACTED_LABEL } from '../src/audio/privacyRedactions.js';

test('claim-ready packet fills carrier-ish fields only from evidence', () => {
  const packet = buildClaimReadyPacket({
    exportedAt: '2026-09-14T19:00:00.000Z',
    job: {
      id: 'job-1038',
      number: 1038,
      name: 'Cedar Ridge — storm damage',
      claimNumber: 'CLM-88412',
      policyNumber: 'HO-99102',
      lossType: 'wind/hail',
      siteAddress: '4118 Cedar Ridge Dr, Austin TX',
    },
    parties: [
      {
        id: 'pty-2',
        company: 'Delgado Roofing',
        contact_name: 'Hector Delgado',
        trade: 'roofing',
      },
      {
        id: 'pty-revoked',
        company: 'Old Co',
        contact_name: 'Gone',
        trade: 'demo',
        revoked_at: '2026-08-01T00:00:00Z',
      },
    ],
    scopeItems: [
      { title: 'Replace damaged decking', state: 'open', reason: 'Hail cracked three sheets.' },
    ],
    proofs: [
      {
        id: 'pf-4',
        work_date: '2026-08-04',
        phase: 'after',
        party_id: 'pty-2',
        company: 'Delgado Roofing',
        captured_at: '2026-08-04T19:30:00Z',
        ai_summary: 'North slope stripped; underlayment down on two thirds.',
        ai_material_change: 'significant',
        transcript_text: '[00:12] Hector: The hail punched through the decking.',
        ai_findings: {
          conversation: {
            version: 2,
            source: 'deterministic',
            summary: 'Crew discusses hail damage.',
            details: [],
            agreements: [],
            concerns: [],
            rooms: ['roof'],
            turns: [
              { tSec: 12, speakerLabel: 'Hector', text: 'The hail punched through the decking.' },
              { tSec: 40, speakerLabel: 'Homeowner', text: 'Insurance said it was caused by the storm.' },
            ],
            insurance: [
              {
                text: 'Loss caused by the hail storm on August 2.',
                tSec: 40,
                quote: 'caused by the storm',
                confidence: 0.8,
              },
            ],
            concernFacts: [
              {
                text: 'Missing shingles and cracked decking on the north slope.',
                tSec: 18,
                quote: 'cracked decking',
              },
            ],
          },
          evidenceLog: {
            version: 1,
            entries: [
              {
                atSeconds: 22,
                type: 'work',
                text: 'Damaged decking exposed on north slope',
                confidence: 0.9,
              },
              {
                atSeconds: 30,
                type: 'scene',
                text: 'Underlayment rolled across slope',
                confidence: 0.7,
              },
            ],
          },
        },
      },
    ],
    frames: [
      { proof_id: 'pf-4', at_seconds: 22, storage_path: 'org/job/pf-4/22.jpg' },
      { proof_id: 'pf-4', at_seconds: 40, storage_path: 'org/job/pf-4/40.jpg' },
    ],
  });

  assert.equal(packet.schema, CLAIM_READY_PACKET_SCHEMA);
  assert.equal(isClaimReadyPacket(packet), true);
  assert.deepEqual(packet.datesOnSite, ['2026-08-04']);
  assert.equal(packet.parties.length, 1);
  assert.equal(packet.parties[0]!.company, 'Delgado Roofing');
  assert.ok(packet.damageObservations.some((o) => /decking/i.test(o.text)));
  assert.ok(packet.cause);
  assert.match(packet.cause!.text, /hail|storm/i);
  assert.equal(packet.photosFrames.length, 2);
  assert.ok(packet.statements.some((s) => s.speakerLabel === 'Hector'));
  assert.equal(packet.job.claimNumber, 'CLM-88412');
  assert.equal(packet.gaps.length, 0);
});

test('never invents cause, dates, or parties when evidence is absent', () => {
  const packet = buildClaimReadyPacket({
    job: { id: 'job-empty', name: 'Empty file' },
    parties: [],
    proofs: [],
    frames: [],
  });
  assert.equal(packet.cause, null);
  assert.deepEqual(packet.datesOnSite, []);
  assert.deepEqual(packet.parties, []);
  assert.deepEqual(packet.damageObservations, []);
  assert.deepEqual(packet.photosFrames, []);
  assert.deepEqual(packet.statements, []);
  assert.ok(packet.gaps.some((g) => /cause/i.test(g)));
  assert.ok(packet.gaps.some((g) => /Claim number/i.test(g)));
});

test('privacy redactions scrub statements inside private ranges', () => {
  const packet = buildClaimReadyPacket({
    job: { id: 'job-priv', claimNumber: 'CLM-1' },
    parties: [{ id: 'p1', company: 'Crew Co', contact_name: 'Sam' }],
    proofs: [
      {
        id: 'pf-priv',
        work_date: '2026-08-05',
        phase: 'after',
        ai_findings: {
          privacyRedactions: {
            version: 1,
            ranges: [{ startSec: 10, endSec: 50, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
          },
          conversation: {
            version: 2,
            source: 'deterministic',
            summary: 'Crew walking the site.',
            details: ['Site walk'],
            agreements: [],
            concerns: [],
            rooms: ['bathroom', 'roof'],
            turns: [
              { tSec: 20, speakerLabel: 'Sam', text: 'Something private in the bathroom.' },
              { tSec: 80, speakerLabel: 'Sam', text: 'Roof looks fine from here.' },
            ],
          },
        },
      },
    ],
  });
  const privateStmt = packet.statements.find((s) => s.atSeconds === 20);
  const openStmt = packet.statements.find((s) => s.atSeconds === 80);
  assert.ok(privateStmt);
  assert.equal(privateStmt!.text, PRIVACY_REDACTED_LABEL);
  assert.equal(privateStmt!.privacyRedacted, true);
  assert.ok(openStmt);
  assert.match(openStmt!.text, /Roof looks fine/);
  assert.equal(packet.privacy.redactionsApplied, true);
});
