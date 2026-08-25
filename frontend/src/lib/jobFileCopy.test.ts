import { describe, expect, it } from 'vitest';
import { suggestedDuplicateTitle } from './jobFileCopy';

describe('suggestedDuplicateTitle', () => {
  it('prefixes a name once', () => {
    expect(suggestedDuplicateTitle('Cedar Ridge rebuild')).toBe('Copy of Cedar Ridge rebuild');
    expect(suggestedDuplicateTitle('Copy of Cedar Ridge rebuild')).toBe(
      'Copy of Cedar Ridge rebuild',
    );
    expect(suggestedDuplicateTitle('  ')).toBe('Copy of Job');
  });
});
