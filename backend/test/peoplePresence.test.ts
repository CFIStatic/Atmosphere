import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asPeopleList,
  peopleFromTurnsAndVision,
  preferPeople,
} from '../src/audio/peoplePresence.js';

test('peopleFromTurnsAndVision builds Homeowner and Crew with seek times', () => {
  const people = peopleFromTurnsAndVision(
    [
      { tSec: 18, speakerLabel: 'Homeowner', text: 'Do not replace the cabinets yet.' },
      { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
      { tSec: 250, speakerLabel: 'Homeowner', text: 'Please keep the hallway cut low.' },
    ],
    'Two people in the bathroom.',
  );
  assert.equal(people.length, 2);
  const home = people.find((p) => p.label === 'Homeowner');
  assert.ok(home);
  assert.equal(home!.role, 'homeowner');
  assert.equal(home!.talking, true);
  assert.equal(home!.firstSeenSec, 18);
  assert.equal(home!.lastSeenSec, 250);
  assert.match(home!.evidence, /hallway|cabinets/i);
});

test('asPeopleList accepts LLM-shaped people rows', () => {
  const people = asPeopleList([
    {
      label: 'Adjuster',
      role: 'adjuster',
      firstSeenSec: 400,
      talking: true,
      evidence: 'On a video call about the claim.',
      quote: 'We need photos of the vanity',
      confidence: 0.88,
    },
  ]);
  assert.equal(people[0]!.label, 'Adjuster');
  assert.equal(people[0]!.role, 'adjuster');
  assert.equal(people[0]!.firstSeenSec, 400);
});

test('preferPeople merges LLM people over turn fallback', () => {
  const merged = preferPeople(
    asPeopleList([{ label: 'Homeowner', role: 'homeowner', firstSeenSec: 10, talking: true, evidence: 'At the vanity.' }]),
    peopleFromTurnsAndVision([{ tSec: 18, speakerLabel: 'Crew', text: 'Remounting.' }]),
  );
  assert.ok(merged.some((p) => p.label === 'Homeowner'));
  assert.ok(merged.some((p) => p.label === 'Crew'));
});
