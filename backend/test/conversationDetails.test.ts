import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeConversation,
  conversationFromStored,
  extractConversationDetails,
  hasConversation,
  parseConversationModelJson,
  publicConversationFields,
  roomsMentionedIn,
  toStoredConversation,
} from '../src/audio/conversationDetails.js';

const talk =
  'Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it. ' +
  'Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead. ' +
  'Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

const stamped =
  '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
  '[1:36] Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead.\n' +
  '[4:10] Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement.';

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
  assert.ok(details.turns.some((t) => t.speakerLabel === 'Homeowner'));
  assert.ok(details.turns.some((t) => t.speakerLabel === 'Crew'));
  assert.ok(details.commitments.some((f) => /mirror|cabinets|adjuster/i.test(f.text)));
  assert.equal(details.source, 'deterministic');
});

test('stamped transcript attaches seek times to turns and facts', () => {
  const details = extractConversationDetails(stamped);
  assert.ok(details.turns.some((t) => t.tSec === 18 && /vanity|insurance/i.test(t.text)));
  assert.ok(details.turns.some((t) => t.tSec === 96 && /mirror|go ahead/i.test(t.text)));
  assert.ok(details.agreementFacts.some((f) => f.tSec === 250 || /agreement|hallway/i.test(f.text)));
});

test('extractConversationDetails is empty when nobody spoke', () => {
  const details = extractConversationDetails('   ');
  assert.equal(details.summary, null);
  assert.deepEqual(details.details, []);
  assert.equal(hasConversation(details), false);
  assert.equal(details.source, 'empty');
});

test('hasConversation is true when the mic captured agreements or rooms', () => {
  assert.equal(hasConversation(extractConversationDetails(talk)), true);
  assert.equal(hasConversation(extractConversationDetails('okay. yeah. mm hmm. thanks.')), false);
});

test('parseConversationModelJson merges LLM JSON over deterministic fallback', () => {
  const fallback = extractConversationDetails(talk);
  const parsed = parseConversationModelJson(
    JSON.stringify({
      summary: 'Homeowner and crew agreed to remount the mirror and hold cabinets for insurance.',
      turns: [
        { tSec: 18, speakerLabel: 'Homeowner', text: 'Do not replace cabinets until insurance approves.' },
        { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
      ],
      agreements: [{ text: 'Remount the mirror today.', tSec: 96, quote: 'We will remount the mirror today' }],
      commitments: [{ text: 'Leave cabinets for the adjuster.', tSec: 96 }],
      concerns: [{ text: 'Do not cut hallway above two feet.', tSec: 250 }],
      actionItems: [{ text: 'Wait for adjuster approval on cabinets.', tSec: 18 }],
      roomsMentioned: ['hallway', 'bathroom'],
      details: ['Insurance must approve cabinet replacement.'],
    }),
    fallback,
  );
  assert.ok(parsed);
  assert.equal(parsed!.source, 'llm');
  assert.match(parsed!.summary || '', /Remount the mirror/i);
  assert.equal(parsed!.turns[0]?.speakerLabel, 'Homeowner');
  assert.equal(parsed!.agreementFacts[0]?.tSec, 96);
  assert.ok(parsed!.actionItems.some((f) => /adjuster/i.test(f.text)));
});

test('parseConversationModelJson returns null on garbage and analyzeConversation falls back', async () => {
  const fallback = extractConversationDetails(talk);
  assert.equal(parseConversationModelJson('not json', fallback), null);
  const prevA = process.env.ANTHROPIC_API_KEY;
  const prevG = process.env.GEMINI_API_KEY;
  const prevO = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const details = await analyzeConversation(talk);
    assert.equal(details.source, 'deterministic');
    assert.ok(hasConversation(details));
  } finally {
    if (prevA === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevA;
    if (prevG === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevG;
    if (prevO === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevO;
  }
});

test('stored conversation prefers rich fields for the library payload', () => {
  const stored = toStoredConversation(extractConversationDetails(stamped));
  stored.summary = 'Stored summary of the walkthrough talk.';
  stored.source = 'llm';
  const fields = publicConversationFields(conversationFromStored(stamped, stored));
  assert.equal(fields.conversationSummary, 'Stored summary of the walkthrough talk.');
  assert.equal(fields.conversationSource, 'llm');
  assert.ok((fields.conversationTurns?.length ?? 0) >= 2);
  assert.ok((fields.conversationRooms ?? []).includes('hallway'));
});
