import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapAccountDetail } from './analytics.js';

describe('mapAccountDetail', () => {
  it('returns null for missing or empty payloads', () => {
    assert.equal(mapAccountDetail(null), null);
    assert.equal(mapAccountDetail(undefined), null);
    assert.equal(mapAccountDetail({}), null);
  });

  it('maps snake_case account rows and camelCase nested collections', () => {
    const detail = mapAccountDetail({
      account: {
        org_id: '11111111-1111-4111-8111-111111111111',
        org_name: 'Harbor Mitigation',
        created_at: '2026-01-02T00:00:00.000Z',
        plan_code: 'team',
        plan_name: 'Team',
        billing_interval: 'annual',
        status: 'active',
        seats: 8,
        members: 7,
        mrr_cents: 59900,
        arr_cents: 718800,
        revenue_in_range_cents: 59900,
        credit_spend_cents: 12.5,
        active_hours: 41.2,
        top_feature: 'Verifier',
        last_active_at: '2026-08-20T12:00:00.000Z',
      },
      members: [
        {
          userId: '22222222-2222-4222-8222-222222222222',
          email: 'pat@harbor.example',
          fullName: 'Pat Harbor',
          role: 'project_manager',
          workType: 'mitigation',
          status: 'active',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      jobs: {
        total: 3,
        byStatus: [{ status: 'active', count: 2 }],
        recent: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Elm Street water loss',
            status: 'active',
            workType: 'mitigation',
            jobNumber: 1042,
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      features: [
        { featureKey: 'verifier_library', label: 'Verifier', activeHours: 22.1, sessions: 18 },
      ],
    });

    assert.ok(detail);
    assert.equal(detail.account.orgName, 'Harbor Mitigation');
    assert.equal(detail.account.mrrCents, 59900);
    assert.equal(detail.account.topFeature, 'Verifier');
    assert.equal(detail.members[0]?.email, 'pat@harbor.example');
    assert.equal(detail.jobs.total, 3);
    assert.equal(detail.jobs.recent[0]?.jobNumber, 1042);
    assert.equal(detail.features[0]?.sessions, 18);
  });
});
