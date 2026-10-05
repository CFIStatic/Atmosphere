import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countUnverifiedApprovalFields,
  isCosmeticFormField,
  verifyApprovalFields,
} from '../src/computer/projection.js';

test('item 12: font fields are cosmetic and excluded from unverified counts', () => {
  assert.equal(isCosmeticFormField('Font', 'Arial'), true);
  assert.equal(isCosmeticFormField('Font size', '11 pt'), true);
  assert.equal(isCosmeticFormField('To', 'a@b.com'), false);
  const fields = verifyApprovalFields({
    claimed: [
      { label: 'To', value: 'a@b.com', source: 'user message' },
      { label: 'Subject', value: 'Update', source: 'user message' },
      { label: 'Body', value: 'Hello', source: 'user message' },
      { label: 'Font', value: 'Calibri', source: 'page' },
      { label: 'Font size', value: '11', source: 'page' },
    ],
    projection: [],
    instructions: 'email a@b.com subject Update body Hello',
    onPage: [{ label: 'Font family', name: 'font', value: 'Arial', type: 'text' }],
  });
  assert.ok(fields.every((f) => !/font/i.test(f.label)));
  assert.equal(countUnverifiedApprovalFields(fields), 0);
});
