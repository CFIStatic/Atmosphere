import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldQuickAddSchema } from '../src/routes/fieldApp.js';

/**
 * Field Capture Quick Add is title-first: the crew names the job on a call and
 * films; the office finishes address/scope later. Pin the contract so the
 * phone and the Field "My jobs" page stay aligned.
 */

test('quick-add: accepts a trimmed job name and defaults work type', () => {
  const parsed = fieldQuickAddSchema.parse({ title: '  Call-in water loss  ' });
  assert.equal(parsed.title, 'Call-in water loss');
  assert.equal(parsed.workType, 'construction');
});

test('quick-add: accepts an explicit work type', () => {
  const parsed = fieldQuickAddSchema.parse({ title: 'Mitigation call-in', workType: 'mitigation' });
  assert.equal(parsed.workType, 'mitigation');
});

test('quick-add: rejects a one-character name', () => {
  assert.throws(() => fieldQuickAddSchema.parse({ title: 'A' }));
});

test('quick-add: rejects a missing name', () => {
  assert.throws(() => fieldQuickAddSchema.parse({}));
});

test('quick-add: rejects an unknown work type', () => {
  assert.throws(() => fieldQuickAddSchema.parse({ title: 'Job', workType: 'landscaping' }));
});
