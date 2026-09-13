import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPeoplePresent,
  formatPeopleAnswer,
  hasPeople,
  matchPeopleToOrgMembers,
  parsePeopleModelJson,
  peopleFromStored,
  sanitizePersonLabel,
  toStoredPeople,
} from '../src/audio/peoplePresent.js';
import { extractConversationDetails } from '../src/audio/conversationDetails.js';

const stamped =
  '[0:18] Homeowner: The leak started behind the vanity.\n' +
  '[1:36] Contractor: We will remount the mirror today.';

test('extractPeoplePresent builds speakers from conversation turns', () => {
  const conversation = extractConversationDetails(stamped);
  const people = extractPeoplePresent({
    transcript: stamped,
    conversation,
    narrationText: 'Two people stand in a bathroom; one wears a hard hat.',
  });
  assert.ok(hasPeople(people));
  assert.ok(people.people.some((p) => p.role === 'homeowner' || /homeowner/i.test(p.label)));
  assert.ok(people.people.some((p) => p.role === 'crew' || /crew/i.test(p.label)));
  assert.ok(people.speakers.some((s) => s.speakerLabel === 'Homeowner' && s.turnCount >= 1));
  assert.ok(people.people.some((p) => p.appearMoments.some((m) => m.tSec === 18)));
});

test('sanitizePersonLabel refuses hallucinated legal names from pixels', () => {
  assert.match(sanitizePersonLabel('John Smith', 'crew', 'hard hat', 0), /Person 1/);
  assert.equal(sanitizePersonLabel('Person 1 (crew-like)', 'crew', null, 0), 'Person 1 (Crew-Like)');
  assert.equal(sanitizePersonLabel('Crew', 'crew', null, 0), 'Crew');
});

test('parsePeopleModelJson keeps roles and strips unmatched legal names', () => {
  const fallback = extractPeoplePresent({});
  const parsed = parsePeopleModelJson(
    {
      people: [
        {
          id: 'person-1',
          label: 'Jane Doe',
          role: 'crew',
          appearance: 'high-vis vest',
          appearMoments: [{ tSec: 12, note: 'cutting drywall' }],
        },
        {
          id: 'person-2',
          label: 'Person 2 (homeowner-like)',
          role: 'homeowner',
          appearance: 'civilian clothes',
          appearMoments: [18],
          speakerLabel: 'Homeowner',
        },
      ],
    },
    fallback,
  );
  assert.ok(parsed);
  assert.equal(parsed!.people.length, 2);
  assert.match(parsed!.people[0]!.label, /Person 1/);
  assert.equal(parsed!.people[0]!.appearance, 'high-vis vest');
  assert.equal(parsed!.people[1]!.speakerLabel, 'Homeowner');
  assert.equal(parsed!.people[1]!.appearMoments[0]?.tSec, 18);
});

test('matchPeopleToOrgMembers only matches when visible text contains the name', () => {
  const base = extractPeoplePresent({
    visionPeople: [
      {
        id: 'person-1',
        label: 'Person 1 (crew-like)',
        role: 'crew',
        appearance: 'name tag partially visible',
        appearMoments: [{ tSec: 5 }],
      },
    ],
  });
  const unmatched = matchPeopleToOrgMembers(base, [{ userId: 'u1', fullName: 'Alex Rivera' }], [
    'hard hat high-vis',
  ]);
  assert.equal(unmatched.people[0]?.matchedName, null);

  const matched = matchPeopleToOrgMembers(base, [{ userId: 'u1', fullName: 'Alex Rivera' }], [
    'Name tag: Alex Rivera — Delgado Roofing',
  ]);
  assert.equal(matched.people[0]?.matchedName, 'Alex Rivera');
  assert.equal(matched.people[0]?.matchedOrgUserId, 'u1');
  assert.equal(matched.people[0]?.label, 'Alex Rivera');
});

test('stored people round-trip and formatPeopleAnswer answers who', () => {
  const conversation = extractConversationDetails(stamped);
  const people = extractPeoplePresent({ transcript: stamped, conversation });
  const stored = toStoredPeople(people);
  const hydrated = peopleFromStored(stored);
  assert.equal(hydrated.count, people.count);
  const answer = formatPeopleAnswer(hydrated);
  assert.ok(answer);
  assert.match(answer!, /People in this video/i);
  assert.match(answer!, /Homeowner|Crew|Person/i);
});
