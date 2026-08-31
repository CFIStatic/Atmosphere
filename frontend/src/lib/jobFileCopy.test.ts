import { describe, expect, it } from 'vitest';
import { jobFileDeleteNameMatches, suggestedDuplicateTitle } from './jobFileCopy';

describe('jobFileDeleteNameMatches', () => {
  it('requires the exact dashboard name', () => {
    expect(jobFileDeleteNameMatches('Cedar Ridge — storm damage', 'Cedar Ridge — storm damage')).toBe(
      true,
    );
    expect(jobFileDeleteNameMatches('  Cedar Ridge  ', 'Cedar Ridge')).toBe(true);
    expect(jobFileDeleteNameMatches('Cedar Ridge', 'cedar ridge')).toBe(false);
    expect(jobFileDeleteNameMatches('Cedar Ridge', 'Cedar')).toBe(false);
    expect(jobFileDeleteNameMatches('Cedar Ridge', '')).toBe(false);
  });
});

describe('suggestedDuplicateTitle', () => {
  it('prefixes a name once', () => {
    expect(suggestedDuplicateTitle('Cedar Ridge rebuild')).toBe('Copy of Cedar Ridge rebuild');
    expect(suggestedDuplicateTitle('Copy of Cedar Ridge rebuild')).toBe(
      'Copy of Cedar Ridge rebuild',
    );
    expect(suggestedDuplicateTitle('  ')).toBe('Copy of Job');
  });
});
