import { describe, expect, it } from 'vitest';
import { evidenceCategoryLabel, evidenceStatus, tradeLabel } from './customerLabels';

describe('tradeLabel', () => {
  it('never prints a raw slug', () => {
    expect(tradeLabel('field_capture')).toBe('Field capture');
    expect(tradeLabel('roofing')).toBe('Roofing');
    expect(tradeLabel('windows_doors')).toBe('Windows & doors');
    expect(tradeLabel('restoration')).toBe('Restoration (water / fire / mold)');
    expect(tradeLabel('other')).toBe('Other trade');
    expect(tradeLabel('some_new_trade')).toBe('Some new trade');
    expect(tradeLabel('')).toBe('');
    expect(tradeLabel(null)).toBe('');
  });

  it('keeps a typed trade name as written', () => {
    expect(tradeLabel('Tile Setter')).toBe('Tile Setter');
  });
});

describe('evidenceCategoryLabel', () => {
  it('maps categories to names and falls back to the phase for other/missing', () => {
    expect(evidenceCategoryLabel('issue', 'before')).toEqual({ key: 'issue', label: 'Issue' });
    expect(evidenceCategoryLabel('other', 'before')).toEqual({ key: 'before', label: 'Before' });
    expect(evidenceCategoryLabel(null, 'after')).toEqual({ key: 'after', label: 'After' });
    expect(evidenceCategoryLabel('other', null)).toEqual({ key: 'other', label: 'General' });
  });
});

describe('evidenceStatus', () => {
  it('splits one proof state into capture, processing, and review', () => {
    expect(evidenceStatus({ state: 'analysed' })).toEqual({
      capture: { label: 'Uploaded', tone: 'good' },
      processing: { label: 'Analyzed', tone: 'good' },
      review: { label: 'Not reviewed', tone: 'neutral' },
    });
    expect(evidenceStatus({ state: 'checked' }).processing.label).toBe('Analyzing');
    expect(evidenceStatus({ state: 'uploaded' }).processing.label).toBe('Waiting to process');
    expect(evidenceStatus({ state: 'accepted' }).review.label).toBe('Accepted');
    expect(evidenceStatus({ state: 'rejected' }).review.label).toBe('Rejected');
    expect(evidenceStatus({ state: 'analysed', legalHold: true }).review.label).toBe('On hold');
    expect(evidenceStatus({ state: 'analysed', failedChecks: 2 }).processing).toEqual({
      label: '2 checks failed',
      tone: 'bad',
    });
  });
});
