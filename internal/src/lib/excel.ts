/**
 * Excel (.xlsx) export: one shape for every table and chart on the site.
 *
 * Pages describe what they export as plain data (headers, a type per column,
 * and raw values, never the formatted strings shown on screen). The SheetJS
 * writer in excelWriter.ts is loaded only when someone clicks Download, so it
 * never weighs on page load.
 *
 * Strings are always written as text cells, so a value that starts with "="
 * is never run as a formula.
 */

/**
 * How a column is typed and formatted in Excel.
 * - `integer`, `number`: plain numbers (`#,##0`, `#,##0.00`)
 * - `usd`: dollars, not cents (`$#,##0.00`)
 * - `percent`: percent points, so 12.5 means 12.5% (stored as 0.125)
 * - `date`: ISO date or timestamp, shown as yyyy-mm-dd in local time
 * - `datetime`: ISO timestamp, shown as yyyy-mm-dd hh:mm in local time
 * - `month`: "YYYY-MM", shown as e.g. "Sep 2026"
 */
export type ColumnType = 'text' | 'integer' | 'number' | 'usd' | 'percent' | 'date' | 'datetime' | 'month';

export type ExportValue = string | number | boolean | Date | null | undefined;

/** A cell may override its column's type, e.g. a summary table that mixes units. */
export interface TypedCell {
  value: ExportValue;
  type?: ColumnType;
  format?: string;
}

export type ExportCell = ExportValue | TypedCell;

export interface ExportColumn {
  header: string;
  type?: ColumnType;
  /** Excel number format; overrides the type's default. */
  format?: string;
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
}

export const DEFAULT_FORMATS: Record<ColumnType, string | null> = {
  text: null,
  integer: '#,##0',
  number: '#,##0.00',
  usd: '"$"#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  month: 'mmm yyyy',
};

function isTypedCell(cell: ExportCell): cell is TypedCell {
  return typeof cell === 'object' && cell !== null && !(cell instanceof Date);
}

/** "2026-09-21" is a calendar date: midnight local, so Excel shows the same day. */
function toDate(value: ExportValue, type: ColumnType): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value) return null;
  if (type === 'month') {
    const m = /^(\d{4})-(\d{2})/.exec(value);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface NormalizedCell {
  value: string | number | boolean | Date | null;
  format: string | null;
}

/** Raw value plus column type → the value and number format Excel should get. */
export function normalizeCell(cell: ExportCell, column: ExportColumn): NormalizedCell {
  const typed = isTypedCell(cell) ? cell : { value: cell };
  const type = typed.type ?? column.type ?? 'text';
  const format = typed.format ?? (typed.type ? null : column.format) ?? DEFAULT_FORMATS[type];
  const raw = typed.value;
  if (raw === null || raw === undefined || raw === '') return { value: null, format: null };
  if (typeof raw === 'number' && !Number.isFinite(raw)) return { value: null, format: null };

  switch (type) {
    case 'integer':
    case 'number':
    case 'usd':
      return typeof raw === 'number' ? { value: raw, format } : { value: String(raw), format: null };
    case 'percent':
      return typeof raw === 'number' ? { value: raw / 100, format } : { value: String(raw), format: null };
    case 'date':
    case 'datetime':
    case 'month': {
      const date = toDate(raw, type);
      return date ? { value: date, format } : { value: String(raw), format: null };
    }
    default:
      return { value: raw instanceof Date ? raw.toISOString() : typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw), format: null };
  }
}

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique per workbook. */
export function sheetName(name: string, taken: Set<string> = new Set()): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** atmosphere-<table>-YYYY-MM-DD.xlsx, with <table> lower-case and hyphenated. */
export function exportFilename(table: string, date: Date = new Date()): string {
  const slug =
    table
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'export';
  return `atmosphere-${slug}-${isoDay(date)}.xlsx`;
}

/** Nanos (1e-9 USD) to dollars, the unit the usd column type expects. */
export const nanosToUsd = (nanos: number | null | undefined): number | null =>
  nanos === null || nanos === undefined ? null : nanos / 1_000_000_000;

/** Cents to dollars. */
export const centsToUsd = (cents: number | null | undefined): number | null =>
  cents === null || cents === undefined ? null : cents / 100;
