import type { Unit } from '../types.js';

/** Normalise a price-list / Xactimate unit string onto our `Unit` union. */
export function normalizeUnitString(raw: string, fallback: Unit = 'EA'): Unit {
  const key = raw.trim().toUpperCase().replace(/\./g, '');
  const known: Unit[] = ['SF', 'LF', 'SY', 'CF', 'EA', 'DA', 'HR', 'WK', 'CY'];
  if ((known as string[]).includes(key)) return key as Unit;
  if (key === 'DAY' || key === 'DAYS') return 'DA';
  if (key === 'HOUR' || key === 'HOURS' || key === 'HRS') return 'HR';
  if (key === 'EACH') return 'EA';
  return fallback;
}
