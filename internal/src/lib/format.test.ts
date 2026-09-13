import { describe, expect, it } from 'vitest';
import { count, hours, money, moneyCompact, percent, signedPercent, tokens } from './format';

describe('format', () => {
  it('formats cents as USD', () => {
    expect(money(59900)).toBe('$599.00');
    expect(money(null)).toBe('—');
  });

  it('compacts large currency', () => {
    expect(moneyCompact(1_200_000_00)).toBe('$1.2M');
    expect(moneyCompact(21850_00)).toBe('$22k');
  });

  it('formats counts, percents, and hours', () => {
    expect(count(1234)).toBe('1,234');
    expect(percent(12.34)).toBe('12.3%');
    expect(signedPercent(2.1)).toBe('+2.1%');
    expect(hours(0.04)).toBe('<0.1 h');
    expect(hours(41.2)).toBe('41 h');
  });

  it('formats token counts',
    () => {
      expect(tokens(0)).toBe('0');
      expect(tokens(1234)).toBe('1,234');
      expect(tokens(12_500)).toBe('13k');
      expect(tokens(1_200_000)).toBe('1.2M');
      expect(tokens(null)).toBe('—');
    },
  );
});
