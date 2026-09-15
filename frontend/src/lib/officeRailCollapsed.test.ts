import { afterEach, describe, expect, it } from 'vitest';
import {
  OFFICE_RAIL_COLLAPSED_KEY,
  readOfficeRailCollapsed,
  writeOfficeRailCollapsed,
} from './officeRailCollapsed';

afterEach(() => {
  window.localStorage.removeItem(OFFICE_RAIL_COLLAPSED_KEY);
});

describe('officeRailCollapsed', () => {
  it('defaults to expanded', () => {
    expect(readOfficeRailCollapsed()).toBe(false);
  });

  it('persists collapsed preference', () => {
    expect(writeOfficeRailCollapsed(true)).toBe(true);
    expect(window.localStorage.getItem(OFFICE_RAIL_COLLAPSED_KEY)).toBe('1');
    expect(readOfficeRailCollapsed()).toBe(true);
    writeOfficeRailCollapsed(false);
    expect(readOfficeRailCollapsed()).toBe(false);
  });
});
