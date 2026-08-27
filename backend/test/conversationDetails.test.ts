import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationForFindings,
  extractConversationDetails,
  mergeConversationFindings,
  roomsMentionedIn,
} from '../src/audio/conversationDetails.js';

const talk =
  'Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it. ' +
  'Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead. ' +
  'Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

test('roomsMentionedIn finds bathroom-adjacent and hallway talk', () => {
  const rooms = roomsMentionedIn(talk + ' We also walked the bathroom.');
  assert.ok(rooms.includes('hallway'));
  assert.ok(rooms.includes('bathroom'));
});

test('extractConversationDetails pulls agreements and insurance concerns from talk', () => {
  const details = extractConversationDetails(talk);
  assert.match(details.summary || '', /Conversation on site/i);
  assert.ok(details.details.some((line) => /insurance/i.test(line)));
  assert.ok(details.agreements.some((line) => /agreement|go ahead|mirror/i.test(line)));
  assert.ok(details.concerns.some((line) => /do not|cabinets|insurance/i.test(line)));
  assert.ok(details.roomsMentioned.includes('hallway'));
});

test('extractConversationDetails is empty when nobody spoke', () => {
  const details = extractConversationDetails('   ');
  assert.equal(details.summary, null);
  assert.deepEqual(details.details, []);
});

test('conversation facts persist onto ai_findings without wiping vision', () => {
  const details = extractConversationDetails(talk);
  const stored = conversationForFindings(details);
  assert.ok(stored.agreements.length);
  assert.ok(stored.rooms.includes('hallway'));
  const merged = mergeConversationFindings(
    { kind: 'day_film', summary: 'Talking in the hall.', actions: [1] },
    details,
  );
  assert.equal(merged.kind, 'day_film');
  assert.equal(merged.summary, 'Talking in the hall.');
  assert.deepEqual(merged.actions, [1]);
  assert.deepEqual(merged.conversation, stored);
});
