import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveEquipmentPlan } from '../src/pm/orchestration/equipmentFromEstimate.ts';
import { buildReferralUrl, pickReferral } from '../src/pm/orchestration/procurement.ts';
import {
  extractMentionExcerpt,
  mentionRequestsAction,
  communicationFingerprint,
} from '../src/pm/orchestration/messaging.ts';

describe('deriveEquipmentPlan', () => {
  it('maps mitigation equipment and infers a dumpster from tear-out', () => {
    const plan = deriveEquipmentPlan({
      source: 'mitigation_estimate',
      equipment: [
        { kind: 'air_mover', quantity: 4 },
        { kind: 'dehumidifier_lgr', quantity: 1, days: 3 },
      ],
      materials: [{ material: 'drywall', action: 'remove', quantity: 200, unit: 'SF' }],
    });

    assert.equal(plan.dumpsterRequired, true);
    assert.ok(plan.items.some((i) => i.itemKind === 'air_mover' && i.quantity === 4));
    assert.ok(plan.items.some((i) => i.itemKind === 'dumpster' && i.fulfillment === 'bid'));
  });

  it('maps Xactimate codes and construction materials to referral fulfillment', () => {
    const plan = deriveEquipmentPlan({
      source: 'construction_estimate',
      lineItems: [
        { code: 'WTRAMH', description: 'Air mover', quantity: 2 },
        { code: 'DRY', description: '1/2" drywall', quantity: 12, unit: 'SF', category: 'drywall' },
      ],
    });

    assert.ok(plan.items.some((i) => i.estimateCode === 'WTRAMH'));
    assert.ok(plan.items.some((i) => i.fulfillment === 'referral'));
  });
});

describe('referral links', () => {
  it('substitutes query and atmosphere ref code', () => {
    const vendor = {
      id: '1',
      orgId: null,
      vendorKey: 'homedepot',
      name: 'Home Depot',
      category: 'building_materials',
      baseUrl: 'https://www.homedepot.com',
      linkTemplate: 'https://www.homedepot.com/s/{q}?ref={ref}',
      referralParam: 'ref',
      atmosphereRefCode: 'atmosphere',
      commissionBps: 200,
      active: true,
      metadata: {},
      createdAt: '',
      updatedAt: '',
    };
    const url = buildReferralUrl(vendor, { query: 'drywall sheets', orgSlug: 'acme01' });
    assert.match(url, /drywall/);
    assert.match(url, /atmosphere-acme01/);
    assert.equal(pickReferral([vendor], 'homedepot', 'org-1')?.vendorKey, 'homedepot');
  });
});

describe('messaging intake', () => {
  it('extracts @atmosphere excerpts and detects action requests', () => {
    const body = 'Hey crew @atmosphere please order the dumpster for Elm St tomorrow';
    assert.ok(extractMentionExcerpt(body)?.includes('@atmosphere'));
    assert.equal(mentionRequestsAction(body), true);
    assert.equal(mentionRequestsAction('just FYI the dehu is humming'), false);
  });

  it('fingerprints stably on external message id', () => {
    const a = communicationFingerprint({
      orgId: 'o',
      channel: 'whatsapp',
      externalMessageId: 'wamid.1',
      body: 'hello',
    });
    const b = communicationFingerprint({
      orgId: 'o',
      channel: 'whatsapp',
      externalMessageId: 'wamid.1',
      body: 'different',
    });
    assert.equal(a, b);
  });
});
