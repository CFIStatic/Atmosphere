import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_PROSE_FORMAT_RULES, normalizeAskProse, stripOrphanEmphasis } from '../src/shared/askProse.js';

test('ASK_PROSE_FORMAT_RULES asks for ChatGPT-quality safe markdown', () => {
  assert.match(ASK_PROSE_FORMAT_RULES, /ChatGPT|Claude|Grok/);
  assert.match(ASK_PROSE_FORMAT_RULES, /\*\*bold\*\*/);
  assert.match(ASK_PROSE_FORMAT_RULES, /Glance-simple/);
  assert.match(ASK_PROSE_FORMAT_RULES, /never invent/i);
  assert.match(ASK_PROSE_FORMAT_RULES, /⟦sources:/);
  assert.match(ASK_PROSE_FORMAT_RULES, /Never write parenthetical/);
  assert.match(ASK_PROSE_FORMAT_RULES, /Capability-only/);
  assert.match(ASK_PROSE_FORMAT_RULES, /orphan stars/i);
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

test('normalizeAskProse never leaves literal star soup', () => {
  const cases = [
    'Yes *** I can search ** google?',
    'A lone * star and **bold** ok',
    '*** *** *** fancy stars ***',
    'Would you like me to search for something specific? **',
    'Here **Job Setup:** broken *** soup * and more*',
  ];
  for (const raw of cases) {
    const clean = normalizeAskProse(raw);
    assert.doesNotMatch(clean, /\*\*\*/, `triple stars remain in: ${JSON.stringify(clean)}`);
    // No orphan ** (odd count) and no lone * left as decoration
    const bold = clean.match(/\*\*/g) ?? [];
    assert.equal(bold.length % 2, 0, `unbalanced ** in: ${JSON.stringify(clean)}`);
    // After protecting bold/italic, no leftover single *
    const withoutBold = clean.replace(/\*\*[^*]+\*\*/g, '');
    const withoutItalic = withoutBold.replace(/(^|[^*])\*[^*]+\*(?!\*)/g, '$1');
    assert.doesNotMatch(withoutItalic, /\*/, `lone * remains in: ${JSON.stringify(clean)}`);
  }
});

test('stripOrphanEmphasis keeps intentional bold and italic', () => {
  assert.equal(stripOrphanEmphasis('**Job Setup:** and *aside*'), '**Job Setup:** and *aside*');
  assert.equal(stripOrphanEmphasis('plain text'), 'plain text');
});
