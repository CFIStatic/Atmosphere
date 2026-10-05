import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalPreviewIssues, isExactApprovalPreview } from '../src/computer/approvalPreview.js';

test('exact preview requires url, button, summary, fields, screenshot', () => {
  const incomplete = {
    page_url: '',
    button_label: 'Submit',
    summary: 'Send claim',
    fields: [{ label: 'Name', value: 'Ada' }],
    screenshot_jpeg_b64: '',
  };
  assert.deepEqual(approvalPreviewIssues(incomplete).sort(), ['missing_page_url', 'missing_screenshot']);
  assert.equal(isExactApprovalPreview(incomplete), false);
  const full = {
    page_url: 'https://carrier.example/claim',
    button_label: 'Submit claim',
    summary: 'File the claim with the listed fields.',
    fields: [{ label: 'Claim #', value: 'CLM-1' }],
    screenshot_jpeg_b64: '/9j/fake',
  };
  assert.equal(isExactApprovalPreview(full), true);
});
