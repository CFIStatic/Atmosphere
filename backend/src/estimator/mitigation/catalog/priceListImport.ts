import type { PriceList, PriceListEntry } from './priceList.js';
import { normalizeUnitString } from './units.js';

/**
 * Import a Xactimate price-list export into the shape the estimator uses.
 *
 * Browser automation deliberately refuses to scrape the paginated price grid —
 * a partial scrape would silently mis-price every estimate. The supported path
 * for orgs without an API agreement is: export from Xactimate Online, upload
 * here. This parser accepts the common CSV/TSV shapes XO and XactAnalysis
 * produce, plus a JSON array of `{code, description, unit, unitPrice}`.
 */

export interface ParsePriceListInput {
  /** Price list id, e.g. FLMI8X_JAN26. Required. */
  id: string;
  name?: string;
  effectiveDate?: string;
  /** Raw file body — CSV, TSV, or JSON. */
  content: string;
  /** Optional hint when the delimiter cannot be sniffed. */
  format?: 'csv' | 'tsv' | 'json' | 'auto';
}

export interface ParsePriceListResult {
  priceList: PriceList;
  warnings: string[];
  skippedRows: number;
}

export function parsePriceListExport(input: ParsePriceListInput): ParsePriceListResult {
  const trimmed = input.content.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new PriceListParseError('That file is empty.', 'empty_file');
  }

  const format = input.format === 'auto' || !input.format ? sniffFormat(trimmed) : input.format;
  const warnings: string[] = [];
  let entries: PriceListEntry[];
  let skippedRows = 0;

  if (format === 'json') {
    entries = parseJson(trimmed);
  } else {
    const parsed = parseDelimited(trimmed, format === 'tsv' ? '\t' : ',');
    entries = parsed.entries;
    skippedRows = parsed.skipped;
    warnings.push(...parsed.warnings);
  }

  if (entries.length === 0) {
    throw new PriceListParseError(
      'No priced line items were found in that file. Export the full price list from Xactimate (code, description, unit, price) and try again.',
      'no_entries',
    );
  }

  // De-dupe by code — last wins, matching how Xactimate overlays regional rates.
  const byCode = new Map<string, PriceListEntry>();
  for (const entry of entries) {
    byCode.set(entry.code.toUpperCase(), entry);
  }
  const deduped = [...byCode.values()];
  if (deduped.length < entries.length) {
    warnings.push(
      `Dropped ${entries.length - deduped.length} duplicate code${entries.length - deduped.length === 1 ? '' : 's'}; the last price for each code was kept.`,
    );
  }

  return {
    priceList: {
      id: input.id.trim(),
      name: (input.name ?? input.id).trim(),
      effectiveDate: input.effectiveDate,
      entries: deduped,
    },
    warnings,
    skippedRows,
  };
}

export class PriceListParseError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PriceListParseError';
    this.code = code;
  }
}

function sniffFormat(content: string): 'csv' | 'tsv' | 'json' {
  const start = content[0];
  if (start === '{' || start === '[') return 'json';
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs > commas) return 'tsv';
  return 'csv';
}

function parseJson(content: string): PriceListEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new PriceListParseError('That JSON could not be parsed.', 'invalid_json');
  }

  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: unknown[] }).entries
      : null;

  if (!rows) {
    throw new PriceListParseError(
      'JSON must be an array of price-list rows, or an object with an "entries" array.',
      'invalid_json_shape',
    );
  }

  const entries: PriceListEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const code = String(record.code ?? record.selector ?? record.Cat ?? '').trim();
    if (!code) continue;
    const unitPrice = Number(record.unitPrice ?? record.price ?? record.UnitPrice ?? record.Rate);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
    entries.push({
      code,
      description: String(record.description ?? record.desc ?? record.Description ?? ''),
      unit: String(record.unit ?? record.Unit ?? 'EA'),
      unitPrice,
      laborPrice: numberOrUndefined(record.laborPrice ?? record.Labor),
      materialPrice: numberOrUndefined(record.materialPrice ?? record.Material),
      equipmentPrice: numberOrUndefined(record.equipmentPrice ?? record.Equipment),
    });
  }
  return entries;
}

function parseDelimited(
  content: string,
  delimiter: string,
): { entries: PriceListEntry[]; skipped: number; warnings: string[] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new PriceListParseError(
      'A CSV price list needs a header row and at least one data row.',
      'too_few_rows',
    );
  }

  const headerCells = splitDelimitedLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const col = detectColumns(headerCells);
  if (col.code < 0 || col.price < 0) {
    throw new PriceListParseError(
      `Could not find code and price columns. Saw headers: ${headerCells.slice(0, 12).join(', ')}. Expected something like Code, Description, Unit, Price.`,
      'missing_columns',
    );
  }

  const entries: PriceListEntry[] = [];
  let skipped = 0;
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitDelimitedLine(lines[i], delimiter);
    const code = (cells[col.code] ?? '').trim();
    if (!code || code.toLowerCase() === 'code') {
      skipped += 1;
      continue;
    }
    const priceRaw = (cells[col.price] ?? '').replace(/[$,]/g, '').trim();
    const unitPrice = Number(priceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      skipped += 1;
      continue;
    }
    const description = col.description >= 0 ? (cells[col.description] ?? '').trim() : '';
    const unitRaw = col.unit >= 0 ? (cells[col.unit] ?? '').trim() : 'EA';
    entries.push({
      code,
      description,
      unit: normalizeUnitString(unitRaw || 'EA', 'EA'),
      unitPrice,
    });
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} with missing code or price.`);
  }

  return { entries, skipped, warnings };
}

function detectColumns(headers: string[]): {
  code: number;
  description: number;
  unit: number;
  price: number;
} {
  const find = (...candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

  return {
    code: find('code', 'selector', 'item code', 'cat', 'activity'),
    description: find('description', 'desc', 'item description', 'name'),
    unit: find('unit', 'uom', 'unit of measure'),
    price: find('unit price', 'unitprice', 'price', 'rate', 'amount', 'total'),
  };
}

/** CSV split that respects double-quoted fields. */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
