import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOcrIdentities,
  applyRoleTitleLabels,
  applyWebIdentities,
  classifySceneKind,
  deriveServiceTitle,
  extractVisibleNameHints,
  formatNamedRoleLabel,
  identifySpeakers,
  overlaySpeakerLabels,
  parseWebIdentityJson,
  resolveSpeakerDisplayName,
} from '../src/audio/speakerIdentity.js';
import { extractPeoplePresent, sanitizePersonLabel } from '../src/audio/peoplePresent.js';
import { extractConversationDetails } from '../src/audio/conversationDetails.js';

test('classifySceneKind gates web identify for private jobs vs media', () => {
  assert.equal(
    classifySceneKind({
      narrationText: 'Crew cuts drywall in the bathroom; homeowner watches.',
    }),
    'private_job',
  );
  assert.equal(
    classifySceneKind({
      narrationText: 'YouTube podcast at a desk; chyron reads Lex Fridman; MSNBC logo.',
    }),
    'public_media',
  );
  assert.equal(
    classifySceneKind({
      narrationText: 'Unknown interior.',
      allowWebIdentify: false,
    }),
    'private_job',
  );
});

test('never invents — sanitize and identify leave Speaker labels alone without evidence', async () => {
  assert.match(sanitizePersonLabel('John Smith', 'crew', null, 0), /Person 1/);
  const stamped = '[0:10] Speaker A: Hello.\n[0:20] Speaker B: Hi.';
  const conversation = extractConversationDetails(stamped);
  const base = extractPeoplePresent({ transcript: stamped, conversation });
  const identified = await identifySpeakers({
    people: base,
    narrationText: 'Two people talk indoors.',
    allowWebIdentify: false,
  });
  for (const person of identified.people) {
    assert.ok(!person.displayName, `unexpected displayName ${person.displayName}`);
    assert.ok(!looksLikeInvented(person.label), person.label);
  }
});

function looksLikeInvented(label: string): boolean {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(label.trim());
}

test('roster path matches org member only when visible text contains the name', async () => {
  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1 (crew-like)',
        role: 'crew',
        appearance: 'name tag visible',
        speakerLabel: 'Crew',
        appearMoments: [{ tSec: 5 }],
      },
    ],
  });
  const identified = await identifySpeakers({
    people: base,
    orgMembers: [{ userId: 'u1', fullName: 'Alex Rivera' }],
    visibleTextHints: ['Name tag: Alex Rivera — Delgado Roofing'],
    allowWebIdentify: false,
  });
  const person = identified.people[0]!;
  assert.equal(person.displayName, 'Alex Rivera');
  assert.equal(person.identityMethod, 'roster');
  assert.equal(person.matchedOrgUserId, 'u1');
  assert.equal(resolveSpeakerDisplayName('Crew', identified), 'Alex Rivera');
});

test('OCR path promotes readable nameplate without web', async () => {
  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1',
        role: 'unknown',
        appearance: 'name tag on shirt',
        matchedName: 'Sam Patel',
        matchConfidence: 0.9,
        speakerLabel: 'Speaker A',
        appearMoments: [{ tSec: 3, note: 'name tag: Sam Patel' }],
      },
    ],
  });
  const withOcr = applyOcrIdentities(base, ['Sam Patel']);
  assert.equal(withOcr.people[0]?.displayName, 'Sam Patel');
  assert.equal(withOcr.people[0]?.identityMethod, 'ocr');
  assert.equal(withOcr.people[0]?.label, 'Sam Patel');
});

test('web path is gated — private_job ignores candidates; public_media requires source+confidence', () => {
  // Seed a diarized person directly — short "Welcome back" transcripts lack
  // conversation DETAIL substance and would otherwise yield empty people.
  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1',
        role: 'other',
        appearance: 'desk interview',
        speakerLabel: 'Speaker A',
        appearMoments: [{ tSec: 5 }],
      },
    ],
  });
  const candidates = [
    {
      speakerLabel: 'Speaker A',
      displayName: 'Lex Fridman',
      confidence: 0.95,
      source: 'Lex Fridman Podcast chyron',
    },
  ];

  const blocked = applyWebIdentities(base, candidates, 'private_job');
  assert.equal(blocked.people.find((p) => p.speakerLabel === 'Speaker A')?.displayName ?? null, null);

  const low = applyWebIdentities(
    base,
    [{ ...candidates[0]!, confidence: 0.5 }],
    'public_media',
  );
  assert.equal(low.people.find((p) => p.speakerLabel === 'Speaker A')?.displayName ?? null, null);

  const noSource = applyWebIdentities(
    base,
    [{ ...candidates[0]!, source: null }],
    'public_media',
  );
  assert.equal(noSource.people.find((p) => p.speakerLabel === 'Speaker A')?.displayName ?? null, null);

  const ok = applyWebIdentities(base, candidates, 'public_media');
  const person = ok.people.find((p) => p.speakerLabel === 'Speaker A');
  assert.equal(person?.displayName, 'Lex Fridman');
  assert.equal(person?.identityMethod, 'web');
  assert.match(String(person?.identitySource), /chyron/i);
});

test('extractVisibleNameHints pulls chyron / name tag text', () => {
  const hints = extractVisibleNameHints([
    'Lower-third chyron: Lex Fridman. Name tag: Alex Rivera.',
    'Host Joe Rogan talks at a desk.',
  ]);
  assert.ok(hints.some((h) => /Lex Fridman/i.test(h)));
  assert.ok(hints.some((h) => /Alex Rivera/i.test(h)));
  assert.ok(hints.some((h) => /Joe Rogan/i.test(h)));
});

test('parseWebIdentityJson drops invents without source or low confidence', () => {
  const parsed = parseWebIdentityJson(
    JSON.stringify({
      identities: [
        { speakerLabel: 'Speaker A', displayName: 'Lex Fridman', confidence: 0.92, source: 'Wikipedia' },
        { speakerLabel: 'Speaker B', displayName: 'Random Guy', confidence: 0.4, source: 'guess' },
        { speakerLabel: 'Speaker C', displayName: 'No Source', confidence: 0.99, source: '' },
      ],
    }),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.displayName, 'Lex Fridman');
});

test('overlaySpeakerLabels swaps Speaker A for displayName in turns/transcript', async () => {
  const stamped =
    '[0:05] Speaker A: Welcome back to the podcast leak claim.\n' +
    '[0:12] Speaker B: Thanks for having me on insurance.';
  const conversation = extractConversationDetails(stamped);
  const base = extractPeoplePresent({
    transcript: stamped,
    conversation,
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1',
        role: 'other',
        appearance: 'podcast host',
        speakerLabel: 'Speaker A',
        appearMoments: [{ tSec: 5 }],
      },
    ],
  });
  assert.ok(base.people.some((p) => p.speakerLabel === 'Speaker A'));
  const identified = await identifySpeakers({
    people: base,
    narrationText: 'YouTube podcast; chyron: Lex Fridman.',
    allowWebIdentify: true,
    webIdentify: async () => [
      {
        speakerLabel: 'Speaker A',
        displayName: 'Lex Fridman',
        confidence: 0.93,
        source: 'Lex Fridman Podcast',
      },
    ],
  });
  const turns = overlaySpeakerLabels(
    conversation.turns.length
      ? conversation.turns
      : [{ tSec: 5, speakerLabel: 'Speaker A', text: 'Welcome.' }],
    identified,
  );
  assert.equal(turns[0]?.speakerLabel, 'Lex Fridman');
  assert.equal(resolveSpeakerDisplayName('Speaker A', identified), 'Lex Fridman');
});

test('homeowners stay Homeowner — never web-named; crew get Name — Title', async () => {
  assert.equal(deriveServiceTitle({ kind: 'homeowner' }), 'Homeowner');
  assert.equal(deriveServiceTitle({ trade: 'plumbing' }), 'Plumber');
  assert.equal(deriveServiceTitle({ memberRole: 'project_manager' }), 'Project Manager');
  assert.equal(deriveServiceTitle({ serviceTitle: 'Estimator' }), 'Estimator');
  assert.equal(formatNamedRoleLabel('Jordan Lee', 'Plumber'), 'Jordan Lee — Plumber');

  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1 (homeowner-like)',
        role: 'homeowner',
        appearance: 'civilian clothes',
        speakerLabel: 'Homeowner',
        appearMoments: [{ tSec: 2 }],
      },
      {
        id: 'person-2',
        label: 'Person 2 (crew-like)',
        role: 'crew',
        appearance: 'name tag',
        matchedName: 'Jordan Lee',
        matchConfidence: 0.9,
        speakerLabel: 'Speaker B',
        appearMoments: [{ tSec: 4, note: 'name tag: Jordan Lee' }],
      },
    ],
  });

  const identified = await identifySpeakers({
    people: base,
    narrationText: 'Bathroom remodel; homeowner watches crew.',
    allowWebIdentify: true,
    orgMembers: [
      {
        userId: 'party:1',
        fullName: 'Jordan Lee',
        trade: 'plumbing',
        kind: 'job_party',
      },
    ],
    visibleTextHints: ['Name tag: Jordan Lee'],
    webIdentify: async () => [
      {
        speakerLabel: 'Homeowner',
        displayName: 'Private Person',
        confidence: 0.99,
        source: 'should-not-apply',
      },
    ],
  });

  const homeowner = identified.people.find((p) => p.role === 'homeowner');
  assert.equal(homeowner?.displayName, 'Homeowner');
  assert.ok(homeowner?.identityMethod !== 'web');

  const crew = identified.people.find((p) => p.id === 'person-2');
  assert.ok(crew);
  assert.equal(crew?.role, 'crew');
  assert.match(String(crew?.displayName), /Jordan Lee/);
  assert.match(String(crew?.displayName), /Plumber/);
  assert.equal(crew?.serviceTitle, 'Plumber');
});

test('applyRoleTitleLabels prefers role words over Speaker A when title known', () => {
  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1',
        role: 'adjuster',
        appearance: null,
        speakerLabel: 'Speaker A',
        appearMoments: [{ tSec: 1 }],
      },
    ],
  });
  const labeled = applyRoleTitleLabels(base, []);
  assert.equal(labeled.people[0]?.displayName, 'Adjuster');
  assert.equal(resolveSpeakerDisplayName('Speaker A', labeled), 'Adjuster');
});
