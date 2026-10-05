import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_ORDERED_APPROVAL_MESSAGE,
  buildSupplyCart,
  checkFulfillment,
  findConsumedMatchingOrderApproval,
  isPlaceOrderLikeApproval,
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
  assert.match(cart.summary, /Approve/);
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
