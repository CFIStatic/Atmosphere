import test from 'node:test';
import assert from 'node:assert/strict';
import { askClipName, looksLikeDescriptionTitle } from '../src/shared/mentions.js';

test('cut-off AI descriptions become a short walk-through name', () => {
  assert.equal(looksLikeDescriptionTitle('Short, Handheld Clip Filmed Inside a Home, Likely'), true);
  assert.equal(askClipName('Short, Handheld Clip Filmed Inside a Home, Likely', '2026-10-08'), 'Walk-through · Oct 8');
  assert.equal(askClipName('Handheld footage of the kitchen showing', '2026-10-08'), 'Kitchen walk-through · Oct 8');
});

test('a real clip title is kept', () => {
  assert.equal(askClipName('Kitchen demo day', '2026-10-08'), 'Kitchen demo day');
  assert.equal(askClipName('North slope tear-off', null), 'North slope tear-off');
  assert.equal(askClipName('', null), 'Clip');
});
