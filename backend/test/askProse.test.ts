import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_PROSE_FORMAT_RULES, normalizeAskProse } from '../src/shared/askProse.js';

test('ASK_PROSE_FORMAT_RULES asks for ChatGPT-quality safe markdown', () => {
  assert.match(ASK_PROSE_FORMAT_RULES, /ChatGPT|Claude|Grok/);
  assert.match(ASK_PROSE_FORMAT_RULES, /\*\*bold\*\*/);
  assert.match(ASK_PROSE_FORMAT_RULES, /Glance-simple/);
  assert.match(ASK_PROSE_FORMAT_RULES, /never invent/i);
  assert.match(ASK_PROSE_FORMAT_RULES, /⟦sources:/);
  assert.match(ASK_PROSE_FORMAT_RULES, /Never write parenthetical/);
});

test('normalizeAskProse keeps bold labels and cleans list markers', () => {
  const raw = [
    'Here is a quick snapshot of what is going on with this file:',
    '',
    '* **Job Setup:** This is Job #9, titled **"Mobil test one"**.',
    '• **Invited Crew:** Jack Cyganiak is on the file.',
    '1. Recent activity: three video clips.',
    '',
    'Would you like to dive into the specific details?',
  ].join('\n');

  const clean = normalizeAskProse(raw);
  assert.match(clean, /\*\*Job Setup:\*\*/);
  assert.match(clean, /\*\*"Mobil test one"\*\*/);
  assert.match(clean, /^- \*\*Job Setup:\*\*/m);
  assert.match(clean, /^- \*\*Invited Crew:\*\*/m);
  assert.match(clean, /^1\. Recent activity:/m);
  assert.doesNotMatch(clean, /^\*/m);
  assert.doesNotMatch(clean, /\*\*\*/);
});

test('normalizeAskProse collapses accidental triple asterisks', () => {
  assert.equal(normalizeAskProse('***Label:*** next'), '**Label:** next');
});
