import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveEquipmentPlan } from '../src/pm/orchestration/equipmentFromEstimate.ts';
import { buildReferralUrl, pickReferral } from '../src/pm/orchestration/procurement.ts';
import {
  extractMentionExcerpt,
  mentionRequestsAction,
  communicationFingerprint,
} from '../src/pm/orchestration/messaging.ts';
import { proposeThreadAdaptations } from '../src/pm/orchestration/threads.ts';
import type { OrgSnapshot } from '../src/pm/types.ts';

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

describe('adaptive threads', () => {
  it('opens live approval follow-ups and procurement digests', () => {
    const snapshot = {
      orgId: 'org',
      settings: {} as OrgSnapshot['settings'],
      now: new Date(),
      equipment: [],
      members: [],
      pendingApprovals: [
        {
          id: 'ap1',
          orgId: 'org',
          projectId: 'p1',
          kind: 'accept_bid',
          title: 'Accept dumpster bid',
          detail: 'WM $450',
          proposedAction: {},
          platform: 'web',
          priority: 'urgent',
          status: 'pending',
          requestedBy: null,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          executedAt: null,
          executionResult: {},
          expiresAt: null,
          sourceRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      projects: [
        {
          project: {
            id: 'p1',
            projectNumber: 'PRJ-0001',
            name: 'Elm',
          },
          tasks: [],
          usedOriginKeys: [],
          assignments: [],
          areas: [],
          readings: [],
          placements: [],
          documents: [],
          milestones: [],
          platformLinks: [],
          communications: [
            {
              id: 'c1',
              orgId: 'org',
              projectId: 'p1',
              channel: 'whatsapp',
              direction: 'inbound',
              intake: 'mention',
              counterpartyName: 'Subco',
              counterpartyHandle: null,
              counterpartyKind: 'subcontractor',
              body: 'need access',
              mentionExcerpt: null,
              threadKey: null,
              externalMessageId: null,
              fingerprint: 'f1',
              status: 'new',
              reviewedAt: null,
              reviewedBy: null,
              metadata: {},
              occurredAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 'c2',
              orgId: 'org',
              projectId: 'p1',
              channel: 'sms',
              direction: 'inbound',
              intake: 'mention',
              counterpartyName: 'Vendor',
              counterpartyHandle: null,
              counterpartyKind: 'vendor',
              body: 'eta?',
              mentionExcerpt: null,
              threadKey: null,
              externalMessageId: null,
              fingerprint: 'f2',
              status: 'new',
              reviewedAt: null,
              reviewedBy: null,
              metadata: {},
              occurredAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          procurement: [
            {
              id: 'pr1',
              orgId: 'org',
              projectId: 'p1',
              planItemId: null,
              kind: 'dumpster',
              title: 'Dumpster',
              description: null,
              quantity: 1,
              unit: 'ea',
              shipToPostal: null,
              shipToAddress: null,
              status: 'bidding',
              selectedBidId: null,
              referralVendorKey: null,
              referralUrl: null,
              approvalId: null,
              metadata: {},
              createdBy: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          planItems: [],
        },
      ],
    } as unknown as OrgSnapshot;

    const adaptations = proposeThreadAdaptations(snapshot);
    assert.ok(adaptations.some((a) => a.kind === 'approval_followup' && a.mode === 'live'));
    assert.ok(adaptations.some((a) => a.kind === 'project_ops'));
    assert.ok(adaptations.some((a) => a.kind === 'procurement'));
    assert.ok(adaptations.some((a) => a.kind === 'vendor_coordination'));
  });
});
