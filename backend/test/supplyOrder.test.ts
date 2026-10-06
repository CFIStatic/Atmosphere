import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_ORDERED_APPROVAL_MESSAGE,
  buildSupplyCart,
  checkFulfillment,
  findConsumedMatchingOrderApproval,
  isPlaceOrderLikeApproval,
  notAddedReasonFor,
  orderLinesFromApprovalFields,
  resolveOrderSelection,
  approvedOrderInstructions,
  approvedOrderFingerprint,
  excludedItemsStillOnPage,
  supplyCartSummary,
  type MatchedProduct,
  looksLikeSupplyOrderAsk,
  matchMaterialsForVendor,
  orderActionFingerprint,
  parseHomeDepotSearchHtml,
} from '../src/computer/supplyOrder.js';
import type { JobMaterialsList } from '../src/shared/jobMaterials.js';
import type { ComputerApprovalRow } from '../src/computer/store.js';

test('looksLikeSupplyOrderAsk', () => {
  assert.equal(looksLikeSupplyOrderAsk('order the materials for this job from Home Depot'), true);
  assert.equal(looksLikeSupplyOrderAsk('buy supplies on homedepot'), true);
  assert.equal(looksLikeSupplyOrderAsk('list the materials for this job'), false);
});

test('isPlaceOrderLikeApproval', () => {
  assert.equal(isPlaceOrderLikeApproval('Place Order'), true);
  assert.equal(isPlaceOrderLikeApproval('Place Your Order'), true);
  assert.equal(isPlaceOrderLikeApproval('Save for later', 'submit'), false);
  assert.equal(isPlaceOrderLikeApproval('Continue', 'pay'), true);
});

test('parseHomeDepotSearchHtml extracts products', () => {
  const html = `
    <a href="https://www.homedepot.com/p/Owens-Corning-Duration-Weathered-Wood-123456789">Owens Corning Duration Architectural Shingles Weathered Wood</a>
    <span>$142.00</span>
  `;
  const rows = parseHomeDepotSearchHtml(html);
  assert.ok(rows.length >= 1);
  assert.match(rows[0].productName, /Owens Corning/i);
  assert.equal(rows[0].sku, '123456789');
});

test('matchMaterialsForVendor uses fetch and builds cart with Approve fields', async () => {
  const list: JobMaterialsList = {
    extractedAt: new Date().toISOString(),
    jobAddress: '100 Demo St, Austin, TX',
    items: [
      {
        id: 'shingles-1',
        item: 'architectural shingles',
        spec: 'Weathered Wood',
        quantity: 28,
        unit: 'squares',
        citations: [{ kind: 'scope', label: 'Scope', excerpt: '28 squares' }],
      },
    ],
  };
  const html = `
    <a href="https://www.homedepot.com/p/Duration-Weathered-Wood-999888777">Duration Architectural Shingles Weathered Wood</a>
    <span>$120.00</span>
  `;
  const matches = await matchMaterialsForVendor(list, 'home_depot', async () => ({
    ok: true,
    status: 200,
    text: html,
  }));
  assert.equal(matches.length, 1);
  assert.ok(matches[0].productName);
  const fulfillment = checkFulfillment({ jobAddress: list.jobAddress, matches });
  assert.equal(fulfillment.mode, 'delivery');
  const cart = buildSupplyCart({ vendor: 'home_depot', matches, fulfillment });
  assert.ok(cart.approvalFields.some((f) => f.label === 'Cart total'));
  assert.ok(cart.approvalFields.some((f) => /Payment/i.test(f.label)));
  assert.equal(cart.summary, '1 item, $3,360.00 total.');
});

test('order fingerprint blocks double Place Order approve', () => {
  const fields = [
    { label: 'Matched product', value: 'Duration Shingles SKU 1', source: 'Home Depot', verified: true },
    { label: 'Quantity', value: '28 squares', source: 'Job file', verified: true },
    { label: 'Cart total', value: '$3360.00', source: 'Sum', verified: true },
    { label: 'Fulfillment', value: 'Delivery to 100 Demo St', source: 'Job address', verified: true },
  ];
  const fp = orderActionFingerprint({
    kind: 'pay',
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    fields,
  });
  const prior: ComputerApprovalRow = {
    id: 'a1',
    org_id: 'o',
    task_id: 't',
    status: 'consumed',
    action_kind: 'pay',
    button_label: 'Place Order',
    summary: 'Place the order',
    page_url: 'https://www.homedepot.com/checkout',
    page_origin: 'https://www.homedepot.com',
    fields,
    screenshot_jpeg_b64: 'x',
    token_hash: 'h',
    requested_at: '2026-10-05T18:20:00Z',
    expires_at: '2026-10-05T19:20:00Z',
    decided_by: 'u',
    decided_at: '2026-10-05T18:20:30Z',
    consumed_at: '2026-10-05T18:20:52Z',
  };
  assert.equal(findConsumedMatchingOrderApproval([prior], fp)?.id, 'a1');
  assert.match(ALREADY_ORDERED_APPROVAL_MESSAGE, /same cart|Place order/i);
});

function mk(over: Partial<MatchedProduct>): MatchedProduct {
  return {
    materialId: over.materialItem ?? 'x',
    materialItem: 'item',
    materialSpec: null,
    quantity: null,
    unit: null,
    productName: 'Product',
    sku: '1',
    url: 'https://www.homedepot.com/p/x/1',
    priceCents: 1000,
    currency: 'USD',
    confidence: 'medium',
    alternatives: [],
    searchQuery: 'q',
    searchUrl: 'https://www.homedepot.com/s/q',
    notes: null,
    ...over,
  };
}

test('cart total is the sum of priced lines; unpriced and not-added lines are named', () => {
  const matches = [
    mk({ materialItem: 'laminate countertop', quantity: 1, unit: 'each', priceCents: 7344 }),
    mk({ materialItem: 'base cabinet', quantity: 1, unit: 'each', priceCents: 21900, confidence: 'low' }),
    mk({ materialItem: 'birch plywood', priceCents: 5158 }),
    mk({ materialItem: 'upper cabinet', productName: null }),
    mk({ materialItem: 'flooring', productName: null }),
    mk({ materialItem: 'caulk', productName: null }),
  ];
  const cart = buildSupplyCart({
    vendor: 'home_depot',
    matches,
    fulfillment: checkFulfillment({ jobAddress: null, matches }),
  });
  assert.equal(cart.lines.length, 3);
  assert.equal(cart.subtotalCents, 7344 + 21900);
  assert.deepEqual(
    cart.notAdded.map((n) => n.item),
    ['upper cabinet', 'flooring', 'caulk'],
  );
  assert.match(cart.notAdded[0].reason, /cabinet size/);
  assert.match(cart.notAdded[1].reason, /flooring type/);
  assert.match(cart.notAdded[2].reason, /No confident match/);
  assert.equal(cart.approvalFields.filter((f) => f.label === 'Not added').length, 3);
  assert.match(cart.approvalFields.find((f) => f.label === 'Not priced yet')!.value, /birch plywood/);
  assert.equal(cart.summary, '3 items, $292.44 priced so far. 1 needs a quantity and 1 needs your choice.');
  assert.ok(!/Approve/.test(cart.summary));
});

test('notAddedReasonFor keeps specced items and matched products', () => {
  assert.equal(notAddedReasonFor(mk({ materialItem: 'upper cabinet', materialSpec: '30 in.' })), null);
  assert.equal(notAddedReasonFor(mk({ materialItem: 'caulk' })), null);
});

test('supplyCartSummary with nothing priced', () => {
  const lines = [{ match: mk({ quantity: null }), lineTotalCents: null, outOfStock: false, substitution: null }];
  assert.equal(supplyCartSummary({ lines, subtotalCents: null }), '1 item, none priced yet. 1 needs a quantity.');
});

function sampleCart() {
  const matches = [
    mk({ materialItem: 'laminate countertop', quantity: 1, unit: 'each', priceCents: 7344, sku: '202911152', productName: 'FORMICA Laminate Sheet' }),
    mk({ materialItem: 'base cabinet', quantity: 1, unit: 'each', priceCents: 21900, sku: '100545475', productName: 'Hampton Bay Base Cabinet', confidence: 'low' }),
    mk({ materialItem: 'birch plywood', priceCents: 5158, sku: '305213039', productName: 'Swaner Birch Plywood' }),
  ];
  return buildSupplyCart({ vendor: 'home_depot', matches, fulfillment: checkFulfillment({ jobAddress: null, matches }) });
}

test('orderLinesFromApprovalFields rebuilds keyed lines from approval fields', () => {
  const lines = orderLinesFromApprovalFields(sampleCart().approvalFields);
  assert.deepEqual(lines.map((l) => l.key), ['L1:202911152', 'L2:100545475', 'L3:305213039']);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].unitPriceCents, 7344);
  assert.equal(lines[1].needsChoice, true);
  assert.equal(lines[2].quantity, null);
});

test('resolveOrderSelection: only checked lines, evidence qty wins, typed qty for unknown, server prices', () => {
  const cart = sampleCart();
  const sel = resolveOrderSelection({
    fields: cart.approvalFields,
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    selected: [{ key: 'L1:202911152', quantity: 50 }, { key: 'L3:305213039', quantity: 2 }],
  });
  assert.deepEqual(sel.lines.map((l) => [l.key, l.quantity, l.quantitySource, l.lineTotalCents]), [
    ['L1:202911152', 1, 'evidence', 7344],
    ['L3:305213039', 2, 'person', 10316],
  ]);
  assert.deepEqual(sel.excluded.map((e) => e.key), ['L2:100545475']);
  assert.equal(sel.subtotalCents, 7344 + 10316);

  const other = resolveOrderSelection({
    fields: cart.approvalFields,
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    selected: [{ key: 'L1:202911152' }, { key: 'L2:100545475' }],
  });
  assert.equal(other.lines[1].confirmedChoice, true);
  assert.notEqual(other.fingerprint, sel.fingerprint, 'a different set of lines is a different order');

  assert.throws(
    () => resolveOrderSelection({ fields: cart.approvalFields, origin: null, buttonLabel: 'Place Order', selected: [{ key: 'L3:305213039' }] }),
    /Enter a quantity/,
  );
  assert.throws(
    () => resolveOrderSelection({ fields: cart.approvalFields, origin: null, buttonLabel: 'Place Order', selected: [] }),
    /at least one/,
  );
  assert.throws(
    () => resolveOrderSelection({ fields: cart.approvalFields, origin: null, buttonLabel: 'Place Order', selected: [{ key: 'L9:nope' }] }),
    /Unknown cart line/,
  );
});

test('agent instructions and the removed-item page check', () => {
  const sel = resolveOrderSelection({
    fields: sampleCart().approvalFields,
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    selected: [{ key: 'L1:202911152' }],
  });
  const text = approvedOrderInstructions('Place Order', sel);
  assert.match(text, /remove these from the cart: Hampton Bay Base Cabinet \(Internet #100545475\); Swaner Birch Plywood/);
  assert.match(text, /exactly: FORMICA Laminate Sheet \(Internet #202911152\) × 1/);
  assert.deepEqual(excludedItemsStillOnPage(sel, 'Cart: FORMICA Laminate Sheet  Hampton Bay Base Cabinet  $219.00'), ['Hampton Bay Base Cabinet']);
  assert.deepEqual(excludedItemsStillOnPage(sel, 'Cart: FORMICA Laminate Sheet $73.44'), []);
});

test('a consumed partial approval blocks re-requesting exactly that order', () => {
  const sel = resolveOrderSelection({
    fields: sampleCart().approvalFields,
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    selected: [{ key: 'L1:202911152' }],
  });
  const row = {
    id: 'p1', org_id: 'o', task_id: 't', status: 'consumed', action_kind: 'pay', button_label: 'Place Order',
    summary: 's', page_url: 'https://www.homedepot.com/checkout', page_origin: 'https://www.homedepot.com',
    fields: sampleCart().approvalFields, screenshot_jpeg_b64: 'x', token_hash: 'h', requested_at: '', expires_at: '',
    decided_by: 'u', decided_at: '', consumed_at: '', approved_order: sel,
  } as ComputerApprovalRow;
  const cartFp = approvedOrderFingerprint({
    origin: 'https://www.homedepot.com',
    buttonLabel: 'Place Order',
    lines: [{ sku: '202911152', material: 'laminate countertop', quantity: 1 }],
  });
  assert.equal(findConsumedMatchingOrderApproval([row], 'unrelated', cartFp)?.id, 'p1');
});
