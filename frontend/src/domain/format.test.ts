import { describe, expect, it } from 'vitest';
import { initialsOf, money, moneyCompact, relativeTime, timeUntil, titleCase } from './format';

const NOW = new Date('2026-03-15T12:00:00.000Z');

describe('money', () => {
  it('formats whole dollars by default', () => {
    expect(money(28450)).toBe('$28,450');
  });

  it('renders an em dash for missing values rather than $0', () => {
    // A missing figure and a genuine zero mean different things on an invoice.
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money(0)).toBe('$0');
  });

  it('supports cents when precision matters', () => {
    expect(money(1234.5, true)).toBe('$1,234.50');
  });

  it('handles negatives for variance', () => {
    expect(money(-4350)).toBe('-$4,350');
  });
});

describe('moneyCompact', () => {
  it('abbreviates thousands and millions', () => {
    expect(moneyCompact(41900)).toBe('$42k');
    expect(moneyCompact(1_240_000)).toBe('$1.2M');
  });

  it('leaves small amounts intact', () => {
    expect(moneyCompact(850)).toBe('$850');
  });
});

describe('relativeTime', () => {
  it('describes the recent past tersely', () => {
    expect(relativeTime('2026-03-15T11:58:00.000Z', NOW)).toBe('2m ago');
    expect(relativeTime('2026-03-15T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-03-13T12:00:00.000Z', NOW)).toBe('2d ago');
  });

  it('describes the future without a negative sign', () => {
    expect(relativeTime('2026-03-15T14:00:00.000Z', NOW)).toBe('in 2h');
  });

  it('collapses the last minute to "now"', () => {
    expect(relativeTime('2026-03-15T11:59:40.000Z', NOW)).toBe('now');
  });

  it('handles missing timestamps', () => {
    expect(relativeTime(null, NOW)).toBe('—');
  });
});

describe('timeUntil', () => {
  it('counts down to an expiry', () => {
    expect(timeUntil('2026-03-15T12:45:00.000Z', NOW)).toBe('45m');
    expect(timeUntil('2026-03-15T18:00:00.000Z', NOW)).toBe('6h');
  });

  it('returns null once elapsed, so callers can hide the countdown', () => {
    expect(timeUntil('2026-03-15T11:00:00.000Z', NOW)).toBeNull();
    expect(timeUntil(null, NOW)).toBeNull();
  });
});

describe('text helpers', () => {
  it('builds initials from a name', () => {
    expect(initialsOf('Dana Whitfield')).toBe('DW');
    expect(initialsOf('Marcus')).toBe('M');
    expect(initialsOf('  Priya   Anand ')).toBe('PA');
  });

  it('humanises snake_case enums', () => {
    expect(titleCase('project_manager')).toBe('Project Manager');
    expect(titleCase('water')).toBe('Water');
  });
});
