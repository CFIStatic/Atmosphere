import type { ExternalRecord } from './types.js';

/**
 * CSV import.
 *
 * The unglamorous path that actually matters: most legacy job-management and
 * accounting software will not give you an API, but every one of them has an
 * "Export to CSV" button. If we only supported REST we would be telling
 * customers their history is unreachable, which is the exact problem this whole
 * subsystem exists to solve.
 *
 * A hand-rolled parser rather than a dependency, because the requirement is
 * small and fixed — RFC 4180 quoting, embedded newlines, escaped quotes — and
 * this data path handles untrusted customer files.
 */

/** Parses RFC 4180 CSV, tolerating CRLF and quoted fields containing newlines. */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // A leading UTF-8 BOM is what Excel writes, and it would otherwise become
  // part of the first column's name — silently breaking the id-column lookup.
  if (input.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip blank trailing lines rather than importing an empty record.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export interface CsvImportOptions {
  entityType: string;
  idColumn: string;
  delimiter?: string;
  maxRecords: number;
}

export interface CsvImportResult {
  records: ExternalRecord[];
  skipped: number;
  truncated: boolean;
}

/**
 * Turns a CSV export into mirror records.
 *
 * Every column is kept as a string, exactly as it appeared. Guessing types on
 * the way in is how "00123" becomes 123 and a job number stops matching the
 * system it came from — and the whole point of the mirror is that it still
 * matches.
 */
export function csvToRecords(csv: string, options: CsvImportOptions): CsvImportResult {
  const rows = parseCsv(csv, options.delimiter ?? ',');
  if (rows.length === 0) throw new Error('The CSV is empty.');

  const header = rows[0].map((h) => h.trim());
  const idIndex = header.indexOf(options.idColumn);
  if (idIndex === -1) {
    throw new Error(
      `Column "${options.idColumn}" is not in the CSV. Available columns: ${header.join(', ')}`,
    );
  }

  const records: ExternalRecord[] = [];
  let skipped = 0;
  let truncated = false;

  for (let r = 1; r < rows.length; r += 1) {
    if (records.length >= options.maxRecords) {
      truncated = true;
      break;
    }

    const row = rows[r];
    const externalId = (row[idIndex] ?? '').trim();
    // No stable key means no way to version the record on the next import.
    if (!externalId) {
      skipped += 1;
      continue;
    }

    const payload: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c += 1) {
      const key = header[c] || `column_${c + 1}`;
      payload[key] = row[c] ?? null;
    }

    records.push({ entityType: options.entityType, externalId, payload, sourceUpdatedAt: null });
  }

  return { records, skipped, truncated };
}
