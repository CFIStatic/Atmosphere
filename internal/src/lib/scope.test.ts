import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCLUDE_INTERNAL_STORAGE_KEY,
  getIncludeInternal,
  internalParam,
  onIncludeInternalChange,
  resetIncludeInternalForTests,
  setIncludeInternal,
} from './scope';
import { api } from './api';

describe('Include internal & test accounts (TEST DATA)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetIncludeInternalForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is off by default, so reports show customers only', () => {
    expect(getIncludeInternal()).toBe(false);
    expect(internalParam()).toBe('');
  });

  it('is remembered and notifies listeners', () => {
    const seen = vi.fn();
    const off = onIncludeInternalChange(seen);
    setIncludeInternal(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(INCLUDE_INTERNAL_STORAGE_KEY)).toBe('1');
    resetIncludeInternalForTests();
    expect(getIncludeInternal()).toBe(true);
    expect(internalParam('?')).toBe('?internal=1');
    off();
  });

  it('adds internal=1 to report requests only when on', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z'), months: 12 };
    await api.overview(range);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).not.toContain('internal=1');
    setIncludeInternal(true);
    await api.overview(range);
    await api.aiBudgets();
    await api.productHealth(12);
    const urls = fetchMock.mock.calls.slice(1).map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toContain('&internal=1');
    expect(urls[1]).toBe('/api/analytics/ai-budgets?internal=1');
    expect(urls[2]).toContain('weeks=12&internal=1');
  });
});
