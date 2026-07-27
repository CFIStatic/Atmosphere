import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRebuildScope } from '../src/estimator/scope/rebuildFromMitigation.js';
import { parseMitigationEstimate } from '../src/estimator/estimate/mitigationImport.js';
import { FIXTURES } from '../src/estimator/connectors/fixtures.js';
import type { MitigationEstimate } from '../src/estimator/types.js';

function estimateOf(lines: string): MitigationEstimate {
  return parseMitigationEstimate(`Room,Code,Description,Quantity,Unit\n${lines}`, {
    source: 'test',
    format: 'csv',
  });
}

describe('deriveRebuildScope — what must not carry over', () => {
  const derived = deriveRebuildScope(
    estimateOf(
      [
        'Living Room,WTR AMV,"Air mover (per 24 hour period)",12.00,DA',
        'Living Room,WTR DHM,"Dehumidifier - large - per day",4.00,DA',
        'General,WTR ANTI,"Apply antimicrobial agent",584.00,SF',
        'General,WTR LAB,"Water damage technician - per hour",16.00,HR',
        'General,WTR MON,"Moisture monitoring - per visit",3.00,EA',
      ].join('\n'),
    ),
  );

  it('produces no rebuild work from dryout equipment, labour, or monitoring', () => {
    assert.equal(derived.items.length, 0);
    assert.equal(derived.skipped.length, 5);
  });

  it('says why each line was left out, so the omission is reviewable', () => {
    assert.ok(derived.skipped.every((entry) => entry.reason.length > 0));
    assert.ok(
      derived.skipped.some((entry) => /mitigation work/.test(entry.reason)),
      'expected the equipment lines to be flagged as mitigation-only',
    );
  });
});

describe('deriveRebuildScope — flood cuts', () => {
  const derived = deriveRebuildScope(
    estimateOf('Living Room,WTR DRY2,"Remove drywall - up to 2\' - walls",68.00,LF'),
  );

  it('converts a linear-foot wall removal into the area that has to be re-hung', () => {
    const drywall = derived.items.find((item) => item.code === 'DRY 1/2-');
    assert.ok(drywall, 'expected a drywall replacement line');
    assert.equal(drywall.unit, 'SF');
    assert.equal(drywall.quantity, 136); // 68 LF × the 2 ft stated in the description
  });

  it('tapes the seam back into the wall that stayed', () => {
    const tape = derived.items.find((item) => item.code === 'DRY TAPE');
    assert.equal(tape?.quantity, 68);
  });

  it('paints what it replaced', () => {
    assert.ok(derived.items.some((item) => item.code === 'PNT SWL'));
  });

  it('records the mitigation line as the evidence for each item', () => {
    assert.ok(derived.items.every((item) => item.evidence[0]?.startsWith('mitigation:')));
  });
});

describe('deriveRebuildScope — companions', () => {
  it('brings the pad back with the carpet even when only carpet was billed', () => {
    const derived = deriveRebuildScope(
      estimateOf('Master Bedroom,DMO CRPT,"Remove carpet",224.00,SF'),
    );
    const codes = derived.items.map((item) => item.code);
    assert.ok(codes.includes('FCC CP+'));
    assert.ok(codes.includes('FCC PAD'));
  });

  it('does not scope carpet when only the pad came out', () => {
    const derived = deriveRebuildScope(
      estimateOf('Master Bedroom,DMO PAD,"Remove carpet pad",224.00,SF'),
    );
    const codes = derived.items.map((item) => item.code);
    assert.ok(codes.includes('FCC PAD'));
    assert.ok(!codes.includes('FCC CP+'));
  });

  it('paints new baseboard', () => {
    const derived = deriveRebuildScope(
      estimateOf('Hallway,DMO BB,"Remove baseboard",33.00,LF'),
    );
    const codes = derived.items.map((item) => item.code);
    assert.deepEqual(codes.sort(), ['FNC BB', 'PNT B']);
  });
});

describe('deriveRebuildScope — ceilings', () => {
  it('treats a ceiling removal as a ceiling, not a wall', () => {
    const derived = deriveRebuildScope(
      estimateOf('Kitchen,DMO DRY,"Remove drywall - ceiling",180.00,SF'),
    );
    const codes = derived.items.map((item) => item.code);
    assert.ok(codes.includes('PNT SCL'), 'ceiling paint');
    assert.ok(!codes.includes('PNT SWL'), 'should not paint walls');
  });

  it('treats an unqualified drywall removal as a wall — the common case', () => {
    const derived = deriveRebuildScope(
      estimateOf('Kitchen,DMO DRY,"Remove drywall",180.00,SF'),
    );
    const codes = derived.items.map((item) => item.code);
    assert.ok(codes.includes('PNT SWL'));
    assert.ok(!codes.includes('PNT SCL'));
  });
});

describe('deriveRebuildScope — non-removals', () => {
  it('ignores work performed on a surface that stays', () => {
    const derived = deriveRebuildScope(
      estimateOf('Den,CLN CRP,"Clean carpet - heavy",224.00,SF'),
    );
    assert.equal(derived.items.length, 0);
    assert.match(derived.skipped[0]!.reason, /not a removal/);
  });
});

describe('deriveRebuildScope — the fixture job end to end', () => {
  const derived = deriveRebuildScope(
    parseMitigationEstimate(FIXTURES.mitigationCsv, { source: 'fixture', format: 'csv' }),
  );

  it('rebuilds every room the mitigation crew touched', () => {
    const rooms = new Set(derived.items.map((item) => item.roomName));
    assert.deepEqual([...rooms].sort(), ['Hallway', 'Living Room', 'Master Bedroom']);
  });

  it('carries nothing from the dryout into the construction estimate', () => {
    const rationales = derived.items.map((item) => item.rationale).join(' ');
    for (const token of ['Air mover', 'Dehumidifier', 'antimicrobial', 'technician', 'monitoring']) {
      assert.ok(!rationales.includes(token), `${token} should not reach the rebuild scope`);
    }
  });
});
