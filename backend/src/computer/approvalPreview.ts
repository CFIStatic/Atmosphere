/**
 * Exact preview required before Approve on consequential Computer actions.
 * The person must see URL, button label, field values, and a screenshot.
 */
import type { ComputerApprovalRow } from './store.js';

export type ApprovalPreviewIssue =
  | 'missing_page_url'
  | 'missing_button_label'
  | 'missing_summary'
  | 'missing_screenshot'
  | 'missing_fields';

export function approvalPreviewIssues(approval: Pick<
  ComputerApprovalRow,
  'page_url' | 'button_label' | 'summary' | 'fields' | 'screenshot_jpeg_b64'
>): ApprovalPreviewIssue[] {
  const issues: ApprovalPreviewIssue[] = [];
  if (!(approval.page_url ?? '').trim()) issues.push('missing_page_url');
  if (!(approval.button_label ?? '').trim()) issues.push('missing_button_label');
  if (!(approval.summary ?? '').trim()) issues.push('missing_summary');
  if (!(approval.screenshot_jpeg_b64 ?? '').trim()) issues.push('missing_screenshot');
  // Empty fields[] is valid for button-only clicks (e.g. Submit with nothing to fill).
  if (!Array.isArray(approval.fields)) issues.push('missing_fields');
  return issues;
}

export function isExactApprovalPreview(approval: Parameters<typeof approvalPreviewIssues>[0]): boolean {
  return approvalPreviewIssues(approval).length === 0;
}
