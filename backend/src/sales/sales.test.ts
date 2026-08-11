import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickMeetingSlot, buildIcs, formatSlot } from './schedule.js';
import { classifyReply, nextFollowupAt, draftPersonalizedEmail } from './email.js';
import { researchBusinesses } from './research.js';
import { parsePeopleQuery, runPeopleSearch } from './peopleSearch.js';
import { searchWeb } from './webSearch.js';
import {
  DEFAULT_SALES_FOCUS,
  DEFAULT_VALUE_PROP,
  demoMeetingTitle,
  resolveCampaignMessaging,
} from './atmosphereProduct.js';

describe('atmosphere product defaults', () => {
  it('fills Atmosphere GTM messaging when campaign fields are empty', () => {
    const messaging = resolveCampaignMessaging({});
    assert.equal(messaging.salesFocus, DEFAULT_SALES_FOCUS);
    assert.equal(messaging.valueProp, DEFAULT_VALUE_PROP);
    assert.match(messaging.senderOrg, /Atmosphere/i);
  });

  it('keeps explicit campaign overrides', () => {
    const messaging = resolveCampaignMessaging({
      salesFocus: 'mold remediation shops',
      valueProp: 'Custom pitch',
      senderName: 'Sam',
    });
    assert.equal(messaging.salesFocus, 'mold remediation shops');
    assert.equal(messaging.valueProp, 'Custom pitch');
    assert.equal(messaging.senderName, 'Sam');
  });

  it('titles booked meetings as product demos', () => {
    assert.match(demoMeetingTitle('Ridge Rebuild'), /Atmosphere product demo/);
    assert.match(demoMeetingTitle('Ridge Rebuild'), /Ridge Rebuild/);
  });
});

describe('sales schedule', () => {
  it('picks a future weekday slot inside availability', () => {
    // Anchor relative to "now" so the suite does not time-bomb when a fixed
    // calendar date falls outside the search window.
    const after = new Date();
    const slot = pickMeetingSlot({
      availability: {
        mon: ['09:00-12:00'],
        tue: ['09:00-12:00'],
        wed: ['09:00-12:00'],
        thu: ['09:00-12:00'],
        fri: ['09:00-12:00'],
      },
      durationMin: 30,
      after,
      searchDays: 21,
    });
    assert.ok(slot);
    assert.ok(slot!.startsAt.getTime() > Date.now());
    assert.equal(slot!.endsAt.getTime() - slot!.startsAt.getTime(), 30 * 60_000);
  });

  it('skips busy starts', () => {
    const after = new Date();
    const availability = {
      mon: ['09:00-17:00'],
      tue: ['09:00-17:00'],
      wed: ['09:00-17:00'],
      thu: ['09:00-17:00'],
      fri: ['09:00-17:00'],
    };
    const first = pickMeetingSlot({
      availability,
      durationMin: 30,
      after,
      searchDays: 21,
    });
    assert.ok(first);
    const second = pickMeetingSlot({
      availability,
      durationMin: 30,
      after,
      busyStarts: [first!.startsAt],
      searchDays: 21,
    });
    assert.ok(second);
    assert.notEqual(second!.startsAt.toISOString(), first!.startsAt.toISOString());
  });

  it('builds a parseable ICS', () => {
    const startsAt = new Date('2026-08-04T15:00:00Z');
    const endsAt = new Date('2026-08-04T15:30:00Z');
    const ics = buildIcs({
      title: 'Meeting',
      description: 'In person',
      startsAt,
      endsAt,
      organizerEmail: 'rep@example.com',
      attendeeEmail: 'buyer@example.com',
    });
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /SUMMARY:Meeting/);
    assert.ok(formatSlot(startsAt, endsAt).length > 5);
  });
});

describe('sales email', () => {
  it('classifies interested and unsubscribe replies', async () => {
    assert.equal(await classifyReply('Sounds good, let’s meet for a product demo next week'), 'interested');
    assert.equal(await classifyReply('Please unsubscribe me from this list'), 'unsubscribe');
    assert.equal(await classifyReply('Not interested, thanks'), 'not_interested');
  });

  it('schedules follow-ups on the cadence', () => {
    const from = new Date('2026-07-28T12:00:00Z');
    const next = nextFollowupAt(from, 1);
    assert.ok(next);
    assert.equal(next!.toISOString(), '2026-07-31T12:00:00.000Z');
    assert.equal(nextFollowupAt(from, 3), null);
  });

  it('drafts an Atmosphere product email without an API key', async () => {
    const draft = await draftPersonalizedEmail({
      senderName: 'Sam',
      senderOrg: 'Atmosphere',
      territory: 'Austin, TX',
      salesFocus: 'water mitigation companies',
      businessName: 'Austin Water Mitigation Pros',
      contactName: 'Alex Rivera',
      contactTitle: 'Owner',
      hooks: ['Runs operations at Harbor'],
      sequenceStep: 1,
    });
    assert.ok(draft.subject.includes('Atmosphere') || draft.subject.includes('Austin'));
    assert.match(draft.body, /Alex/);
    assert.match(draft.body, /Sam/);
    assert.match(draft.body, /Atmosphere|demo/i);
  });
});

describe('sales research', () => {
  it('returns demo restoration buyers when forced', async () => {
    const result = await researchBusinesses('Austin, TX', 'water mitigation', {
      forceDemo: true,
      limit: 4,
    });
    assert.equal(result.mode, 'demo');
    assert.equal(result.businesses.length, 4);
    assert.ok(result.businesses[0].name.includes('Austin'));
    assert.ok(
      /mitigation|restoration|mold|rebuild|disaster|estimating/i.test(
        result.businesses.map((b) => `${b.name} ${b.category}`).join(' '),
      ),
    );
  });
});

describe('people query parse', () => {
  it('parses role, company, and location from natural language', () => {
    const parsed = parsePeopleQuery(
      'find me the director of facilities at abc supply company in milwaukee',
    );
    assert.equal(parsed.role, 'Director of Facilities');
    assert.match(parsed.company || '', /abc supply/i);
    assert.match(parsed.location || '', /milwaukee/i);
    assert.ok(parsed.searchQueries.length >= 3);
  });

  it('parses CEO queries', () => {
    const parsed = parsePeopleQuery('CEO of ABC Supply');
    assert.equal(parsed.role, 'CEO');
    assert.match(parsed.company || '', /ABC Supply/i);
  });
});

describe('live web people search', { skip: process.env.RUN_LIVE_WEB_TESTS !== '1' }, () => {
  // Hits the public web. Opt in with RUN_LIVE_WEB_TESTS=1 — CI stays deterministic.
  it('returns DuckDuckGo hits for ABC Supply facilities query', async () => {
    const hits = await searchWeb('director of facilities "ABC Supply" Milwaukee', 8);
    assert.ok(hits.length >= 3, `expected search hits, got ${hits.length}`);
    assert.ok(
      hits.some((h) => /abcsupply|linkedin|leadership/i.test(h.url)),
      'expected ABC Supply or profile URLs',
    );
  });

  it('finds real facilities-related people at ABC Supply in Milwaukee', async () => {
    const result = await runPeopleSearch(
      'find me the director of facilities at ABC Supply company in Milwaukee',
    );
    assert.ok(result.pagesCrawled >= 1);
    assert.ok(result.searchesRun >= 1);
    assert.ok(result.candidates.length >= 1, 'expected at least one candidate');
    const hay = result.candidates
      .map((c) => `${c.fullName} ${c.title} ${c.summary} ${c.evidence.join(' ')}`)
      .join(' ')
      .toLowerCase();
    assert.ok(
      /facilities|operations|milwaukee|abc supply|olsen|castaneda|kyle|jost/i.test(hay),
      `candidates lacked expected signals: ${hay.slice(0, 400)}`,
    );
    assert.ok(result.bestMatch || result.candidates[0]);
    assert.ok(result.sourcesCrawled.length >= 1);
  });
});
