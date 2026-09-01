import { describe, expect, it } from 'vitest';
import {
  jobFileDeleteNameMatches,
  jobLooksDeletedFromLibrary,
  suggestedDuplicateTitle,
  visibleJobFiles,
} from './jobFileCopy';

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

describe('jobLooksDeletedFromLibrary', () => {
  it('hides the Job Files card after a dashboard delete', () => {
    expect(jobLooksDeletedFromLibrary('Job file “Cursor 1” deleted from the library.')).toBe(true);
    expect(jobLooksDeletedFromLibrary('opened job #5 — Cursor 1')).toBe(false);
  });
});

describe('visibleJobFiles', () => {
  it('hides Dashboard deletes and duplicate cards', () => {
    const rows = [
      { jobId: 'live', title: 'Cedar Ridge', lastEvent: 'opened job #2' },
      { jobId: 'live', title: 'Cedar Ridge copy', lastEvent: 'opened job #2' },
      { jobId: 'gone', title: 'Cursor 1', lastEvent: 'Job file “Cursor 1” deleted from the library.' },
      { jobId: 'stale', title: 'Cursor 1', lastEvent: 'opened job #1 — Cursor 1' },
    ];
    expect(visibleJobFiles(rows, new Set(['live'])).map((row) => row.jobId)).toEqual(['live']);
    expect(visibleJobFiles(rows).map((row) => row.jobId)).toEqual(['live', 'stale']);
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
