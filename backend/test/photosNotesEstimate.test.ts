import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEstimate, DEFAULT_ESTIMATOR_CONFIG } from '../src/estimator/mitigation/agent.js';
import { normalizeSources } from '../src/estimator/mitigation/ingest/index.js';
import { parseNotes } from '../src/estimator/mitigation/ingest/notes.js';
import { deriveFindings } from '../src/estimator/mitigation/ingest/findings.js';
import { deriveRequirements } from '../src/estimator/mitigation/requirements/obligations.js';
import { deriveScope } from '../src/estimator/mitigation/rules/scope.js';

/**
 * Photos + notes alone must produce a defensible estimate: identify what is
 * wrong, state what IICRC / insurance / code obliges, and scope what the
 * documentation supports — without inventing geometry.
 */

const PHOTO_NOTES_JOB = {
  jobId: 'photos-notes-demo',
  photos: [
    {
      filename: 'IMG_20240517_090011.HEIC',
      capturedAt: '2024-05-17T09:00:11Z',
      caption: 'before — kitchen standing water carpet wet',
      roomName: 'Kitchen',
    },
    {
      filename: 'IMG_20240517_101500.HEIC',
      capturedAt: '2024-05-17T10:15:00Z',
      caption: 'flood cut 24in — kitchen north wall drywall out',
      roomName: 'Kitchen',
    },
    {
      filename: 'IMG_20240517_110000.HEIC',
      capturedAt: '2024-05-17T11:00:00Z',
      caption: 'containment poly barrier kitchen',
      roomName: 'Kitchen',
    },
    {
      filename: 'IMG_20240518_080000.HEIC',
      capturedAt: '2024-05-18T08:00:00Z',
      caption: 'after — antimicrobial applied kitchen',
      roomName: 'Kitchen',
    },
  ],
  notes: `
Cat 3 from sewage backup. Carrier: State Farm.
Kitchen 12x14. Carpet and pad out. Flood cut 24in, cavity wet.
Mold on north wall baseboard.
6 air movers 2 lgr 1 scrubber.
Containment built. Before and after photos taken.
`,
};

describe('photos+notes assessment', () => {
  it('extracts category, materials, equipment, and rooms from notes', () => {
    const notes = parseNotes(PHOTO_NOTES_JOB.notes);
    assert.equal(notes.sourceCategory, 3);
    assert.ok(notes.materialsMentioned.includes('carpet'));
    assert.ok(notes.equipmentMentioned.some((e) => e.kind === 'air_mover' && e.quantity === 6));
    assert.ok(notes.equipmentMentioned.some((e) => e.kind === 'dehumidifier_lgr'));
    assert.equal(notes.roomDimensions[0]?.lengthFt, 12);
    assert.equal(notes.microbialGrowthPresent, true);
    assert.ok(notes.carrierMentioned?.toLowerCase().includes('state farm'));
  });

  it('builds damage findings from captions', () => {
    const assessment = normalizeSources(PHOTO_NOTES_JOB);
    assert.ok(assessment.findings.length >= 3);
    assert.ok(assessment.findings.some((f) => f.kind === 'demolition_performed' || f.kind === 'wet_material'));
    assert.ok(assessment.findings.some((f) => f.kind === 'microbial_growth' || assessment.microbialGrowthPresent));
  });

  it('applies note materials and equipment onto rooms without DocuSketch/MICA', () => {
    const assessment = normalizeSources(PHOTO_NOTES_JOB);
    assert.equal(assessment.sourcesUsed.includes('docusketch'), false);
    assert.equal(assessment.sourcesUsed.includes('mica'), false);
    assert.ok(assessment.rooms.length >= 1);
    assert.ok(assessment.rooms[0].geometry.floorSF > 0);
    assert.ok(assessment.rooms[0].materials.length > 0, 'materials should be applied from notes/photos');
    assert.ok(
      assessment.rooms[0].materials.some((m) => m.material === 'carpet' && !m.salvageable),
      'Cat 3 carpet should come out',
    );
    assert.ok(assessment.equipment.length > 0, 'equipment should come from notes');
    assert.equal(assessment.category, 3);
  });

  it('derives demolition and treatment scope from photos+notes', () => {
    const assessment = normalizeSources(PHOTO_NOTES_JOB);
    const scope = deriveScope(assessment);
    const rules = new Set(scope.map((s) => s.rule));
    assert.ok(rules.has('extraction') || scope.some((s) => s.tags.includes('extraction')));
    assert.ok([...rules].some((r) => r.startsWith('tear_out') || r === 'flood_cut'));
    assert.ok(scope.some((s) => s.tags.includes('antimicrobial') || s.tags.includes('containment')));
  });

  it('emits IICRC, insurance, and construction-code requirements', () => {
    const assessment = normalizeSources(PHOTO_NOTES_JOB);
    const scope = deriveScope(assessment);
    const requirements = deriveRequirements({ assessment, findings: assessment.findings, scope, sla: null });
    const authorities = new Set(requirements.map((r) => r.authority));
    assert.ok(authorities.has('iicrc'));
    assert.ok(authorities.has('insurance'));
    assert.ok(authorities.has('construction_code'));
    assert.ok(requirements.some((r) => r.title.toLowerCase().includes('porous') || r.title.toLowerCase().includes('category 3')));
  });

  it('builds a full estimate with findings and requirements from photos+notes alone', () => {
    const estimate = buildEstimate(PHOTO_NOTES_JOB, DEFAULT_ESTIMATOR_CONFIG);
    assert.ok(estimate.assessment.findings.length > 0);
    assert.ok(estimate.requirements.length > 0);
    assert.ok(estimate.lineItems.length > 0, 'should produce billable lines once dims+materials exist');
    assert.ok(estimate.narrative.toLowerCase().includes('category 3') || estimate.narrative.includes('Category 3'));
    // Open questions should mention obligations or documentation still needed.
    assert.ok(estimate.openQuestions.length > 0);
  });

  it('does not invent square footage when only captions exist', () => {
    const assessment = normalizeSources({
      photos: [
        { caption: 'flood cut drywall kitchen', filename: 'a.jpg' },
        { caption: 'wet carpet living room', filename: 'b.jpg' },
      ],
      notes: 'Cat 2 supply line leak. Carpet wet.',
    });
    const totalSF = assessment.rooms.reduce((sum, r) => sum + r.geometry.floorSF, 0);
    assert.equal(totalSF, 0);
    const estimate = buildEstimate(
      {
        photos: [
          { caption: 'flood cut drywall kitchen', filename: 'a.jpg' },
          { caption: 'wet carpet living room', filename: 'b.jpg' },
        ],
        notes: 'Cat 2 supply line leak. Carpet wet.',
      },
      DEFAULT_ESTIMATOR_CONFIG,
    );
    assert.ok(
      estimate.openQuestions.some((q) => /dimension|quantit|DocuSketch|12x14/i.test(q)),
      'should ask for dimensions rather than invent them',
    );
  });
});

describe('deriveFindings', () => {
  it('reads flood-cut captions into demolition findings', () => {
    const bundle = deriveFindings({
      photoEvidence: [
        {
          id: 'p1',
          kind: 'photo',
          description: 'flood cut 24in — master bath',
          tags: ['flood_cut', 'drywall', 'photo', 'master_bath'],
        },
      ],
      noteEvidence: [],
      sourceCategory: 3,
    });
    assert.ok(bundle.findings.some((f) => f.kind === 'demolition_performed'));
    assert.ok(bundle.materials.some((m) => m.material === 'drywall' && m.wetHeightIn === 24));
  });
});
