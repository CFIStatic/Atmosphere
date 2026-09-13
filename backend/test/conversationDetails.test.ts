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
  'Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement. Is the deductible five hundred?';

const stamped =
  '[0:18] Homeowner: The leak started behind the vanity. I do not want you to replace the cabinets unless insurance approves it.\n' +
  '[1:36] Contractor: Understood. We will remount the mirror today and leave the cabinets until the adjuster says go ahead.\n' +
  '[4:10] Homeowner: Please do not cut the hallway any higher than two feet. That was the agreement. Is the deductible five hundred?';

test('roomsMentionedIn finds bathroom-adjacent and hallway talk', () => {
  const rooms = roomsMentionedIn(talk + ' We also walked the bathroom.');
  assert.ok(rooms.includes('hallway'));
  assert.ok(rooms.includes('bathroom'));
});

test('extractConversationDetails pulls deep categories from talk', () => {
  const details = extractConversationDetails(talk);
  assert.match(details.summary || '', /Conversation on site/i);
  assert.ok(details.details.some((line) => /insurance/i.test(line)));
  assert.ok(details.agreements.some((line) => /agreement|go ahead|mirror/i.test(line)));
  assert.ok(details.concerns.some((line) => /do not|cabinets|insurance/i.test(line)));
  assert.ok(details.roomsMentioned.includes('hallway'));
  assert.ok(details.turns.some((t) => t.speakerLabel === 'Homeowner'));
  assert.ok(details.turns.some((t) => t.speakerLabel === 'Crew'));
  assert.ok(details.commitments.some((f) => /mirror|cabinets|adjuster/i.test(f.text)));
  assert.ok(details.refusals.some((f) => /cabinets|insurance|do not want/i.test(f.text)));
  assert.ok(details.insurance.some((f) => /insurance|adjuster/i.test(f.text)));
  assert.ok(details.moneyTalk.some((f) => /deductible/i.test(f.text)));
  assert.ok(details.keyMoments.length >= 1);
  assert.ok(details.commitments.some((f) => f.owner === 'Crew' || f.quote));
  assert.equal(details.source, 'deterministic');
});

test('stamped transcript attaches seek times to turns and facts', () => {
  const details = extractConversationDetails(stamped);
  assert.ok(details.turns.some((t) => t.tSec === 18 && /vanity|insurance/i.test(t.text)));
  assert.ok(details.turns.some((t) => t.tSec === 96 && /mirror|go ahead/i.test(t.text)));
  assert.ok(details.agreementFacts.some((f) => f.tSec === 250 || /agreement|hallway/i.test(f.text)));
  assert.ok(details.refusals.some((f) => f.tSec === 18 || /cabinets/i.test(f.text)));
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

test('parseConversationModelJson keeps quote grounding, confidence, and deep catalogs', () => {
  const fallback = extractConversationDetails(talk);
  const parsed = parseConversationModelJson(
    JSON.stringify({
      executiveSummary:
        'Homeowner refused cabinet replacement until insurance approves. Crew promised to remount the mirror and leave cabinets for the adjuster. Deductible amount is still an open question.',
      summary: 'Insurance holds cabinets; mirror remount agreed.',
      turns: [
        { tSec: 18, speakerLabel: 'Homeowner', text: 'Do not replace cabinets until insurance approves.' },
        { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
      ],
      agreements: [
        {
          text: 'Remount the mirror today.',
          tSec: 96,
          quote: 'We will remount the mirror today',
          confidence: 0.91,
        },
      ],
      refusals: [
        {
          text: 'No cabinet replacement without insurance.',
          tSec: 18,
          quote: 'I do not want you to replace the cabinets unless insurance approves it.',
          confidence: 0.94,
        },
      ],
      commitments: [
        {
          text: 'Remount the mirror today.',
          tSec: 96,
          quote: 'We will remount the mirror today',
          owner: 'Crew',
          confidence: 0.9,
          kind: 'promise',
        },
      ],
      concerns: [{ text: 'Do not cut hallway above two feet.', tSec: 250, confidence: 0.85 }],
      moneyTalk: [{ text: 'Homeowner asked if the deductible is five hundred.', tSec: 250, confidence: 0.8 }],
      insurance: [{ text: 'Cabinets wait on adjuster approval.', tSec: 96, confidence: 0.88 }],
      unresolvedQuestions: [{ text: 'Is the deductible five hundred?', tSec: 250, confidence: 0.82 }],
      keyMoments: [
        {
          tSec: 18,
          label: 'Refusal',
          text: 'Cabinets refused pending insurance.',
          quote: 'I do not want you to replace the cabinets unless insurance approves it.',
          confidence: 0.94,
        },
      ],
      actionItems: [{ text: 'Wait for adjuster approval on cabinets.', tSec: 18, owner: 'Crew', confidence: 0.8 }],
      roomsMentioned: ['hallway', 'bathroom'],
      details: ['Insurance must approve cabinet replacement.'],
    }),
    fallback,
  );
  assert.ok(parsed);
  assert.equal(parsed!.source, 'llm');
  assert.match(parsed!.executiveSummary || '', /refused cabinet/i);
  assert.equal(parsed!.turns[0]?.speakerLabel, 'Homeowner');
  assert.equal(parsed!.agreementFacts[0]?.tSec, 96);
  assert.equal(parsed!.agreementFacts[0]?.confidence, 0.91);
  assert.equal(parsed!.commitments[0]?.owner, 'Crew');
  assert.ok(parsed!.refusals.some((f) => f.quote && /cabinets/i.test(f.quote)));
  assert.ok(parsed!.moneyTalk.some((f) => /deductible/i.test(f.text)));
  assert.ok(parsed!.keyMoments.some((m) => m.label === 'Refusal' && m.tSec === 18));
});

test('parseConversationModelJson returns null on garbage and analyzeConversation falls back offline', async () => {
  const fallback = extractConversationDetails(talk);
  assert.equal(parseConversationModelJson('not json', fallback), null);
  const prevA = process.env.ANTHROPIC_API_KEY;
  const prevG = process.env.GEMINI_API_KEY;
  const prevO = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const details = await analyzeConversation(talk, {
      visionContext: 'Frames show a bathroom vanity and hallway flood cut.',
    });
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

test('stored conversation prefers rich v2 fields for the library payload', () => {
  const stored = toStoredConversation(extractConversationDetails(stamped));
  stored.summary = 'Stored summary of the walkthrough talk.';
  stored.executiveSummary = 'Stored executive brief with insurance hold and mirror remount.';
  stored.source = 'llm';
  stored.version = 2;
  const fields = publicConversationFields(conversationFromStored(stamped, stored));
  assert.equal(fields.conversationSummary, 'Stored summary of the walkthrough talk.');
  assert.match(fields.conversationExecutiveSummary || '', /executive brief/i);
  assert.equal(fields.conversationSource, 'llm');
  assert.ok((fields.conversationTurns?.length ?? 0) >= 2);
  assert.ok((fields.conversationRooms ?? []).includes('hallway'));
  assert.ok((fields.conversationKeyMoments?.length ?? 0) >= 1);
  assert.ok((fields.conversationRefusals?.length ?? 0) >= 1);
});
