import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generatePlaybookFromAnalysis,
  mergeFindings,
  selectProofsForPlaybook,
  type ProofForGenerate,
} from './generate.js';

const roofingProof: ProofForGenerate = {
  id: 'proof-roof-1',
  phase: 'after',
  analysis_status: 'done',
  ai_summary: 'Crew tore off the old shingles and dried the deck in.',
  ai_findings: {
    workPerformed: [
      'Tear-off of existing asphalt shingles',
      'Install underlayment / dry-in',
      'Nail starter course at eaves',
    ],
    scopeTouched: ['roof covering', 'underlayment'],
    scopeVerdicts: [
      {
        title: 'Tear-off complete',
        verdict: 'appears_complete',
        because: 'Deck is bare in after frames.',
      },
      {
        title: 'Dry-in',
        verdict: 'in_progress',
        because: 'Felt rolled on most slopes; ridge open.',
      },
    ],
    concerns: ['Exposed ridge needs covering before rain'],
  },
  work_date: '2026-09-10',
  captured_at: '2026-09-10T18:00:00Z',
};

describe('selectProofsForPlaybook', () => {
  it('prefers after-phase done proofs', () => {
    const proofs: ProofForGenerate[] = [
      {
        id: 'before',
        phase: 'before',
        analysis_status: 'done',
        ai_summary: 'Before',
        ai_findings: { workPerformed: ['Inspect existing roof'] },
        captured_at: '2026-09-10T10:00:00Z',
      },
      roofingProof,
      {
        id: 'queued',
        phase: 'after',
        analysis_status: 'queued',
        ai_summary: null,
        ai_findings: null,
      },
    ];
    const selected = selectProofsForPlaybook(proofs);
    assert.equal(selected.length, 1);
    assert.equal(selected[0]!.id, 'proof-roof-1');
  });

  it('returns empty when nothing is analysed', () => {
    assert.deepEqual(
      selectProofsForPlaybook([{ id: 'x', analysis_status: 'failed', ai_findings: null }]),
      [],
    );
  });
});

describe('generatePlaybookFromAnalysis', () => {
  it('builds a roofing tear-off → dry-in checklist', () => {
    const draft = generatePlaybookFromAnalysis({
      job: { id: 'job-1', title: '142 Maple roof', work_type: 'construction' },
      proofs: [roofingProof],
      partyTrade: 'roofing',
    });
    assert.ok(draft);
    assert.match(draft!.title.toLowerCase(), /roofing/);
    assert.match(draft!.title.toLowerCase(), /tear-off/);
    assert.match(draft!.title.toLowerCase(), /dry-in/);
    assert.equal(draft!.trade, 'roofing');
    assert.equal(draft!.sourceKind, 'job_analysis');
    assert.ok(draft!.steps.length >= 3);
    assert.ok(draft!.steps.some((s) => s.skillKey === 'remove'));
    assert.ok(draft!.steps.some((s) => s.skillKey === 'protect' || /dry-in/i.test(s.title)));
    assert.ok(draft!.skillTags.includes('remove'));
    assert.deepEqual(draft!.analysisSnapshot.workPerformed, roofingProof.ai_findings!.workPerformed);
  });

  it('returns null when analysis is empty', () => {
    const draft = generatePlaybookFromAnalysis({
      job: { id: 'job-2', title: 'Empty' },
      proofs: [
        {
          id: 'p',
          phase: 'after',
          analysis_status: 'done',
          ai_summary: null,
          ai_findings: {},
        },
      ],
    });
    assert.equal(draft, null);
  });

  it('falls back to a summary-only step', () => {
    const draft = generatePlaybookFromAnalysis({
      job: { id: 'job-3', title: 'Quiet day' },
      proofs: [
        {
          id: 'p2',
          phase: 'after',
          analysis_status: 'done',
          ai_summary: 'Crew walked the site and staged materials.',
          ai_findings: { workPerformed: [], scopeVerdicts: [], concerns: [] },
        },
      ],
    });
    assert.ok(draft);
    assert.equal(draft!.steps.length, 1);
    assert.equal(draft!.steps[0]!.skillKey, 'inspect');
  });
});

describe('mergeFindings', () => {
  it('dedupes workPerformed across proofs', () => {
    const merged = mergeFindings([
      roofingProof,
      {
        id: 'proof-2',
        phase: 'after',
        analysis_status: 'done',
        ai_summary: 'Same day continued.',
        ai_findings: {
          workPerformed: ['Tear-off of existing asphalt shingles', 'Flash the chimney'],
        },
      },
    ]);
    assert.equal(
      merged.workPerformed.filter((w) => /tear-off/i.test(w)).length,
      1,
    );
    assert.ok(merged.workPerformed.some((w) => /chimney/i.test(w)));
  });
});
