import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAccountCatalog } from '../src/estimator/mitigation/catalog/accountCatalog.js';
import { searchPriceList, findPriceListEntry } from '../src/estimator/mitigation/catalog/codeSearch.js';
import { parsePriceListExport } from '../src/estimator/mitigation/catalog/priceListImport.js';
import { CATALOG } from '../src/estimator/mitigation/catalog/lineItems.js';
import { mapScopeToLineItems } from '../src/estimator/mitigation/rules/mapping.js';
import type { PriceList } from '../src/estimator/mitigation/catalog/priceList.js';
import type { ScopeItem } from '../src/estimator/mitigation/types.js';

const SAMPLE_LIST: PriceList = {
  id: 'TEST8X_JAN26',
  name: 'Test Region',
  effectiveDate: '2026-01-15',
  entries: [
    {
      code: 'WTRDHMLGR',
      description: 'Dehumidifier, LGR (per 24 hour period) — no monitoring',
      unit: 'DA',
      unitPrice: 102.5,
    },
    {
      code: 'WTRAMH_REG',
      description: 'Air mover (per 24 hour period) — no monitoring',
      unit: 'DA',
      unitPrice: 28.0,
    },
    {
      code: 'WTRXTRC',
      description: 'Water extraction from carpeted floor — portable extractor',
      unit: 'SF',
      unitPrice: 0.71,
    },
    {
      code: 'CLNAM',
      description: 'Apply anti-microbial agent to affected surfaces',
      unit: 'SF',
      unitPrice: 0.39,
    },
    {
      code: 'EXTRAONLY',
      description: 'Account-only specialty drying accessory',
      unit: 'EA',
      unitPrice: 45,
    },
  ],
};

describe('buildAccountCatalog', () => {
  it('marks knowledge items verified only when the account list has them', () => {
    const result = buildAccountCatalog(SAMPLE_LIST);
    assert.equal(result.live, true);
    assert.ok(result.matched > 0);

    const lgr = result.catalog.find((item) => item.key === 'WTRDHMLGR');
    assert.ok(lgr);
    assert.equal(lgr.verified, true);
    assert.equal(lgr.code, 'WTRDHMLGR');
    assert.equal(lgr.defaultUnitPrice, 102.5);

    const air = result.catalog.find((item) => item.key === 'WTRAMH');
    assert.ok(air);
    // Matched by description to renamed regional selector.
    assert.equal(air.verified, true);
    assert.equal(air.code, 'WTRAMH_REG');
  });

  it('honours human remaps over fuzzy matching', () => {
    const result = buildAccountCatalog(SAMPLE_LIST, {
      remaps: { WTRAMH: 'EXTRAONLY' },
    });
    const air = result.catalog.find((item) => item.key === 'WTRAMH');
    assert.ok(air);
    assert.equal(air.code, 'EXTRAONLY');
    assert.equal(air.verified, true);
    assert.ok(result.remapped.some((row) => row.via === 'remap' && row.to === 'EXTRAONLY'));
  });

  it('warns loudly when no price list is connected', () => {
    const result = buildAccountCatalog(null);
    assert.equal(result.live, false);
    assert.equal(result.matched, 0);
    assert.ok(result.warnings[0]?.includes('No Xactimate price list'));
    assert.ok(result.catalog.every((item) => item.verified === false));
  });
});

describe('searchPriceList', () => {
  it('finds exact codes and description hits', () => {
    const exact = searchPriceList(SAMPLE_LIST, 'WTRDHMLGR');
    assert.equal(exact[0]?.match, 'exact_code');
    assert.equal(exact[0]?.unitPrice, 102.5);

    const desc = searchPriceList(SAMPLE_LIST, 'anti-microbial');
    assert.ok(desc.some((hit) => hit.code === 'CLNAM'));

    assert.equal(findPriceListEntry(SAMPLE_LIST, 'extraonly')?.code, 'EXTRAONLY');
  });
});

describe('parsePriceListExport', () => {
  it('parses CSV exports with quoted fields', () => {
    const csv = [
      'Code,Description,Unit,Unit Price',
      'WTRDHM,"Dehumidifier, large",DA,78.00',
      'WTRAMH,Air mover,DA,"26.50"',
    ].join('\n');

    const parsed = parsePriceListExport({ id: 'CSV1', name: 'CSV', content: csv });
    assert.equal(parsed.priceList.entries.length, 2);
    assert.equal(parsed.priceList.entries[0].code, 'WTRDHM');
    assert.equal(parsed.priceList.entries[0].unitPrice, 78);
  });

  it('parses JSON arrays', () => {
    const parsed = parsePriceListExport({
      id: 'JSON1',
      content: JSON.stringify([
        { code: 'WTRXTRC', description: 'Extract', unit: 'SF', unitPrice: 0.6 },
      ]),
    });
    assert.equal(parsed.priceList.entries[0].code, 'WTRXTRC');
  });
});

describe('mapScopeToLineItems with account catalog', () => {
  it('prices lines from the live list and accepts code overrides', () => {
    const account = buildAccountCatalog(SAMPLE_LIST);
    const scope: ScopeItem[] = [
      {
        id: 'scope-1',
        rule: 'equipment.dehu.lgr',
        description: 'LGR dehumidifier',
        quantity: 3,
        unit: 'DA',
        roomId: undefined,
        justification: 'Sized from psychrometrics',
        citations: [],
        evidenceIds: [],
        tags: ['equipment', 'dehumidifier_lgr'],
      },
      {
        id: 'scope-2',
        rule: 'extraction.carpet',
        description: 'Carpet extraction',
        quantity: 200,
        unit: 'SF',
        roomId: 'room-1',
        justification: 'Wet carpet',
        citations: [],
        evidenceIds: [],
        tags: ['extraction', 'carpet'],
      },
    ];

    const mapped = mapScopeToLineItems(scope, {
      rooms: [],
      priceList: SAMPLE_LIST,
      catalog: account.catalog,
    });

    assert.equal(mapped.unmapped.length, 0);
    const lgr = mapped.lineItems.find((line) => line.catalogKey === 'WTRDHMLGR');
    assert.ok(lgr);
    assert.equal(lgr.priceVerified, true);
    assert.equal(lgr.unitPrice, 102.5);
    assert.equal(lgr.code, 'WTRDHMLGR');

    const overridden = mapScopeToLineItems(scope.slice(0, 1), {
      rooms: [],
      priceList: SAMPLE_LIST,
      catalog: account.catalog,
      codeOverrides: { WTRDHMLGR: 'EXTRAONLY' },
    });
    assert.equal(overridden.lineItems[0]?.code, 'EXTRAONLY');
    assert.equal(overridden.lineItems[0]?.priceVerified, true);
    assert.equal(overridden.lineItems[0]?.unitPrice, 45);
  });

  it('keeps knowledge size aligned with catalog export', () => {
    assert.ok(CATALOG.length >= 30);
  });
});
