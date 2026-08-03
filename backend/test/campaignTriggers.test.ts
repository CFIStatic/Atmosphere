import test from 'node:test';
import assert from 'node:assert/strict';
import { alertCoversTerritory, groupFor, hoursOfNotice } from '../src/campaigns/weather.js';
import { buildAudience, decideFires, renderTemplate } from '../src/campaigns/triggers.js';

/**
 * A weather campaign sends real email to real customers with nobody watching.
 * Every test here defends a decision in the same direction: when the rules are
 * ambiguous, do not send. An email a day late costs a lead; an email to the
 * wrong list, or three for one storm, costs the relationship.
 */

const alert = (over: Partial<Parameters<typeof alertCoversTerritory>[0]> = {}) => ({
  id: 'urn:oid:test.1',
  event: 'Severe Thunderstorm Warning',
  severity: 'Severe',
  urgency: 'Expected',
  certainty: 'Likely',
  headline: null,
  areaDesc: 'Williamson; Travis',
  sameCodes: [],
  ugcCodes: [],
  effective: null,
  onset: null,
  expires: null,
  group: 'hail',
  ...over,
});

test('event names map to the groups a salesperson picks from', () => {
  assert.equal(groupFor('Severe Thunderstorm Warning'), 'hail');
  assert.equal(groupFor('Flash Flood Warning'), 'flood');
  assert.equal(groupFor('Hard Freeze Warning'), 'winter');
  assert.equal(groupFor('Hurricane Warning'), 'hurricane');
  // An event nobody sells against is not forced into a bucket.
  assert.equal(groupFor('Air Quality Alert'), null);
});

test('an alert matches a territory by county, however each side spells it', () => {
  assert.equal(
    alertCoversTerritory(alert(), { counties: ['Williamson County'], cities: [] }),
    true,
  );
  assert.equal(alertCoversTerritory(alert(), { counties: ['Williamson'], cities: [] }), true);
  assert.equal(alertCoversTerritory(alert(), { counties: ['Bexar'], cities: [] }), false);
});

test('a territory with no area defined matches nothing', () => {
  // The dangerous default. Treating "no area" as "everywhere" would have an
  // unconfigured territory mail an entire state the first time it hailed.
  assert.equal(alertCoversTerritory(alert(), { counties: [], cities: [] }), false);
  assert.equal(alertCoversTerritory(alert(), {}), false);
});

test('hours of notice is measured from onset, and goes negative once in force', () => {
  const now = new Date('2026-08-03T12:00:00Z');
  assert.equal(hoursOfNotice(alert({ onset: '2026-08-05T12:00:00Z' }), now), 48);
  assert.ok((hoursOfNotice(alert({ onset: '2026-08-03T11:00:00Z' }), now) ?? 0) < 0);
  assert.equal(hoursOfNotice(alert(), now), null);
});

/* ---- firing decisions ---------------------------------------------------- */

const territory = {
  id: 't1',
  cities: ['Round Rock'],
  counties: ['Williamson County'],
  postal_codes: ['78664'],
};

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Hail — North Austin',
  status: 'active',
  trigger_kind: 'weather',
  trigger_config: { groups: ['hail'], leadTimeHours: 48 },
  territory_id: 't1',
  ...over,
});

const base = {
  territories: [territory],
  firedAlertIds: new Set<string>(),
  lastFiredAt: new Map<string, Date>(),
  now: new Date('2026-08-03T12:00:00Z'),
};

test('a matching alert in the territory fires the campaign', () => {
  const { fire } = decideFires({
    ...base,
    campaigns: [campaign()],
    alerts: [alert({ onset: '2026-08-04T12:00:00Z' })],
  });
  assert.equal(fire.length, 1);
  assert.match(fire[0].reason, /Severe Thunderstorm Warning/);
});

test('a campaign with no territory never fires', () => {
  // Refusing here is the whole safety property: without it, an unfinished
  // campaign mails everybody the first time the weather turns.
  const { fire, skip } = decideFires({
    ...base,
    campaigns: [campaign({ territory_id: null })],
    alerts: [alert()],
  });
  assert.equal(fire.length, 0);
  assert.match(skip[0].reason, /must know where it applies/);
});

test('an alert outside the territory does not fire it', () => {
  const { fire } = decideFires({
    ...base,
    campaigns: [campaign()],
    alerts: [alert({ areaDesc: 'Bexar; Comal' })],
  });
  assert.equal(fire.length, 0);
});

test('the same alert cannot fire one campaign twice', () => {
  // A three-day storm is re-issued repeatedly and the poller sees each one.
  // Without this, one weather event becomes three identical mailings.
  const { fire, skip } = decideFires({
    ...base,
    campaigns: [campaign()],
    alerts: [alert()],
    firedAlertIds: new Set(['c1:urn:oid:test.1']),
  });
  assert.equal(fire.length, 0);
  assert.equal(skip.length, 1);
});

test('the cooldown holds a campaign back after a recent send', () => {
  const { fire, skip } = decideFires({
    ...base,
    campaigns: [campaign({ trigger_config: { groups: ['hail'], cooldownDays: 14 } })],
    alerts: [alert({ id: 'urn:oid:test.2' })],
    lastFiredAt: new Map([['c1', new Date('2026-07-28T12:00:00Z')]]),
  });
  assert.equal(fire.length, 0);
  assert.match(skip[0].reason, /cooldown is 14/);
});

test('an alert further out than the lead time waits', () => {
  // Four days ahead a watch often misses entirely, and "a storm is coming"
  // that never arrives is the email that gets a sender ignored.
  const { fire } = decideFires({
    ...base,
    campaigns: [campaign({ trigger_config: { groups: ['hail'], leadTimeHours: 48 } })],
    alerts: [alert({ onset: '2026-08-07T12:00:00Z' })],
  });
  assert.equal(fire.length, 0);
});

test('a paused or draft campaign never fires', () => {
  for (const status of ['paused', 'draft', 'finished']) {
    const { fire } = decideFires({ ...base, campaigns: [campaign({ status })], alerts: [alert()] });
    assert.equal(fire.length, 0, `${status} must not send`);
  }
});

test('a minor alert does not fire a campaign watching for severe weather', () => {
  const { fire } = decideFires({
    ...base,
    campaigns: [campaign()],
    alerts: [alert({ severity: 'Minor' })],
  });
  assert.equal(fire.length, 0);
});

/* ---- audience ------------------------------------------------------------ */

const contacts = [
  { id: 'ct1', first_name: 'Tomas', last_name: 'Bergeron', email: 't@northgate.com', title: 'Facilities Director', company_name: 'Northgate', city: 'Round Rock', postal_code: '78664' },
  { id: 'ct2', first_name: 'Ray', last_name: 'Calloway', email: 'r@alliance.com', title: 'Field Adjuster', company_name: 'Alliance', city: 'Round Rock', postal_code: '78664' },
  { id: 'ct3', first_name: 'No', last_name: 'Email', email: null, title: 'Facilities Manager', company_name: 'X', city: 'Round Rock', postal_code: '78664' },
];

const places = [
  { id: 'p1', name: 'Round Rock High School', category: 'school', city: 'Round Rock', postal_code: '78664', territory_id: 't1', contact_id: null },
  { id: 'p2', name: 'Baylor Scott & White', category: 'hospital', city: 'Round Rock', postal_code: '78664', territory_id: 't1', contact_id: null },
  { id: 'p3', name: 'Already Ours', category: 'school', city: 'Round Rock', postal_code: '78664', territory_id: 't1', contact_id: 'ct1' },
];

test('title keywords narrow an audience to the people who decide', () => {
  const members = buildAudience({
    audience: { includeContacts: true, titleKeywords: ['facilities'] },
    contacts,
    places: [],
    territory: null,
  });
  assert.equal(members.length, 1);
  assert.equal(members[0].name, 'Tomas Bergeron');
});

test('a contact with no email is never in an email audience', () => {
  const members = buildAudience({
    audience: { includeContacts: true },
    contacts,
    places: [],
    territory: null,
  });
  assert.ok(members.every((m) => m.email));
});

test('places and contacts combine without double-counting one relationship', () => {
  // 'Already Ours' has a contact in the CRM, who is in the list under their
  // own name. Listing the building too would have somebody chase an account
  // their colleague already owns.
  const members = buildAudience({
    audience: { includeContacts: true, placeCategories: ['school', 'hospital'] },
    contacts,
    places,
    territory: null,
  });
  assert.ok(!members.some((m) => m.name === 'Already Ours'));
  assert.ok(members.some((m) => m.name === 'Round Rock High School'));
  assert.ok(members.some((m) => m.name === 'Tomas Bergeron'));
});

test('an audience outside the territory is excluded', () => {
  const members = buildAudience({
    audience: { includeContacts: true },
    contacts: [{ ...contacts[0], city: 'San Antonio', postal_code: '78205' }],
    places: [],
    territory: { cities: ['Round Rock'], counties: [], postal_codes: ['78664'] },
  });
  assert.equal(members.length, 0);
});

/* ---- template ------------------------------------------------------------ */

test('the template fills in, and a missing name reads as intended', () => {
  const out = renderTemplate(
    'Hi {{first_name}}, hope things are good at {{company}} — {{event}} is forecast for {{area}}. — {{sender}}',
    { firstName: 'Tomas', company: 'Northgate', event: 'hail', area: 'Williamson County', senderName: 'Dana' },
  );
  assert.equal(out, 'Hi Tomas, hope things are good at Northgate — hail is forecast for Williamson County. — Dana');

  // "Hi ," is the classic broken merge field. It must not be possible.
  const blank = renderTemplate('Hi {{first_name}} at {{company}}', {});
  assert.equal(blank, 'Hi there at your team');
});
