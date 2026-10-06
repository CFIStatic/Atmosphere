import { describe, expect, it } from 'vitest';
import fixture from '../dev/hdOrderV2Fixture.json';
import { parseOrderApproval } from './supplyOrderApproval';

describe('parseOrderApproval', () => {
  const order = parseOrderApproval(fixture.approve.fields)!;

  it('builds one line per cart item with product link and no raw URL in the name', () => {
    expect(order.lines).toHaveLength(fixture.cart.lines.length);
    const lam = order.lines.find((l) => l.material === 'laminate countertop')!;
    expect(lam.productName).toMatch(/^FORMICA 4 ft\. x 8 ft\. Laminate Sheet/);
    expect(lam.productName).not.toMatch(/https?:/);
    expect(lam.productUrl).toMatch(/^https:\/\/www\.homedepot\.com\/p\//);
    expect(lam.qty).toBe('1 each');
    expect(lam.lineTotal).toBe('$73.44');
    expect(lam.flags).toEqual(['ready']);
    expect(lam.key).toBe('L1:202911152');
    expect(lam.qtyNumber).toBe(1);
    expect(lam.unitPriceCents).toBe(7344);
  });

  it('flags low confidence and unknown quantity', () => {
    const cab = order.lines.find((l) => l.material === 'base cabinet')!;
    expect(cab.flags).toContain('needs_choice');
    const crown = order.lines.find((l) => l.material === 'crown molding')!;
    expect(crown.flags).toEqual(['needs_choice', 'qty_unknown']);
    expect(crown.lineTotal).toBeNull();
  });

  it('total equals the sum of priced lines and not-added items carry a reason', () => {
    const sum = order.lines
      .map((l) => (l.lineTotal ? Number(l.lineTotal.replace(/[$,]/g, '')) : 0))
      .reduce((a, b) => a + b, 0);
    expect(order.total).toBe(`$${sum.toFixed(2)}`);
    expect(order.notAdded.map((n) => n.item).sort()).toEqual(['flooring', 'upper cabinet']);
    expect(order.notAdded.every((n) => /Spec needed/.test(n.reason))).toBe(true);
  });

  it('returns null for non-order approvals', () => {
    expect(parseOrderApproval([{ label: 'To', value: 'a@b.co', source: 'Job', verified: true }])).toBeNull();
  });
});
