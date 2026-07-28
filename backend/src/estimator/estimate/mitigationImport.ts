import type { MitigationEstimate, MitigationLineItem, Unit } from '../types.js';

/**
 * Reading a mitigation estimate.
 *
 * The mitigation estimate is the most valuable input the rebuild side gets:
 * it is a written record of exactly what was torn out, room by room, with
 * quantities an adjuster has already seen. Deriving the rebuild from it beats
 * guessing from photos, because the demolition already happened — the photos
 * show a gutted room, not the finishes that were in it.
 *
 * Estimates arrive in whatever shape the mitigation contractor could export:
 * a CSV from Xactimate, an XML interchange file, or a block of text pasted out
 * of a PDF. All three are handled here, because refusing the format a customer
 * actually has is the same as not supporting the feature.
 */

const UNIT_ALIASES: Record<string, { unit: Unit; multiplier: number }> = {
  SF: { unit: 'SF', multiplier: 1 },
  SQFT: { unit: 'SF', multiplier: 1 },
  'SQ FT': { unit: 'SF', multiplier: 1 },
  // A "square" is a roofing/flooring unit of 100 square feet. Normalising it
  // here means the rebuild rules only ever reason in SF.
  SQ: { unit: 'SF', multiplier: 100 },
  LF: { unit: 'LF', multiplier: 1 },
  'LIN FT': { unit: 'LF', multiplier: 1 },
  EA: { unit: 'EA', multiplier: 1 },
  ITEM: { unit: 'EA', multiplier: 1 },
  SY: { unit: 'SY', multiplier: 1 },
  HR: { unit: 'HR', multiplier: 1 },
  DA: { unit: 'DA', multiplier: 1 },
  DAY: { unit: 'DA', multiplier: 1 },
  CF: { unit: 'CF', multiplier: 1 },
};

function normaliseUnit(raw: string): { unit: Unit; multiplier: number } {
  const key = raw.trim().toUpperCase().replace(/\./g, '');
  return UNIT_ALIASES[key] ?? { unit: 'EA', multiplier: 1 };
}

/**
 * Xactimate codes are a three-letter category plus a selector, e.g. `WTR DRY2`
 * or `DMO CRPT`. Exports that lack a code column usually still lead the
 * description with one.
 */
const CODE_PATTERN = /^([A-Z]{3})\s+([A-Z0-9/+\-']{1,10})\b/;

function extractCode(candidate: string, description: string): string {
  const fromColumn = candidate.trim().toUpperCase();
  if (CODE_PATTERN.test(fromColumn)) return fromColumn;

  const fromDescription = description.trim().toUpperCase().match(CODE_PATTERN);
  if (fromDescription) return `${fromDescription[1]} ${fromDescription[2]}`;

  return fromColumn || '';
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** RFC 4180 reader — Xactimate exports quote descriptions containing commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

interface ColumnMap {
  description: number;
  quantity: number;
  unit: number;
  code: number;
  room: number;
}

const COLUMN_PATTERNS: Record<keyof ColumnMap, RegExp> = {
  description: /^(description|desc|item|line\s*item|activity)$/i,
  quantity: /^(quantity|qty|units?)$/i,
  unit: /^(unit|uom|unit\s*of\s*measure)$/i,
  code: /^(code|cat\s*&?\s*sel|category|sel|line\s*code)$/i,
  room: /^(room|area|location|group)$/i,
};

/**
 * Xactimate CSV exports carry preamble rows (claim header, column titles for a
 * summary block) before the real table, so the header is searched for rather
 * than assumed to be row 0.
 */
function findHeader(rows: string[][]): { index: number; columns: ColumnMap } | null {
  const searchDepth = Math.min(rows.length, 25);

  for (let i = 0; i < searchDepth; i += 1) {
    const cells = rows[i]!.map((c) => c.trim());
    const columns: ColumnMap = { description: -1, quantity: -1, unit: -1, code: -1, room: -1 };

    cells.forEach((cell, index) => {
      for (const key of Object.keys(COLUMN_PATTERNS) as (keyof ColumnMap)[]) {
        if (columns[key] === -1 && COLUMN_PATTERNS[key].test(cell)) columns[key] = index;
      }
    });

    // Description and quantity are the minimum needed to produce a usable line.
    if (columns.description >= 0 && columns.quantity >= 0) return { index: i, columns };
  }

  return null;
}

function fromCsv(text: string, source: string): MitigationEstimate {
  const rows = parseCsv(text);
  const header = findHeader(rows);
  if (!header) {
    throw new Error(
      'Could not find a line-item table in that CSV — it needs at least a description column and a quantity column.',
    );
  }

  const { columns } = header;
  const lineItems: MitigationLineItem[] = [];
  // Xactimate groups by room using a bare row containing only the room name.
  let currentRoom: string | undefined;

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = rows[i]!;
    const description = (cells[columns.description] ?? '').trim();
    const rawQuantity = (cells[columns.quantity] ?? '').trim();

    const nonEmpty = cells.filter((c) => c.trim() !== '');
    if (nonEmpty.length === 1 && !rawQuantity) {
      currentRoom = nonEmpty[0]!.trim();
      continue;
    }

    // Strip thousands separators and currency noise before parsing.
    const quantity = Number(rawQuantity.replace(/[^0-9.\-]/g, ''));
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;

    const { unit, multiplier } = normaliseUnit(
      columns.unit >= 0 ? (cells[columns.unit] ?? '') : '',
    );

    lineItems.push({
      id: `csv-${i}`,
      code: extractCode(columns.code >= 0 ? (cells[columns.code] ?? '') : '', description),
      description,
      unit,
      quantity: quantity * multiplier,
      roomName: columns.room >= 0 ? (cells[columns.room] ?? '').trim() || currentRoom : currentRoom,
    });
  }

  return { source, lineItems };
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A tolerant element scanner, not a general XML parser.
 *
 * Estimate interchange files are machine-generated and flat: line items are
 * self-closing elements carrying their data as attributes. Pulling those out by
 * pattern handles every export shape seen in practice without taking on an XML
 * dependency for one code path.
 */
function fromXml(text: string, source: string): MitigationEstimate {
  const lineItems: MitigationLineItem[] = [];
  const elementPattern = /<(LineItem|Item|Line)\b([^>]*?)\/?>/gi;

  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = elementPattern.exec(text)) !== null) {
    const attributes = parseAttributes(match[2]!);
    const description = attributes.description ?? attributes.desc ?? attributes.name ?? '';
    const quantityRaw = attributes.quantity ?? attributes.qty ?? '';
    const quantity = Number(quantityRaw);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;

    const { unit, multiplier } = normaliseUnit(attributes.unit ?? attributes.uom ?? '');
    index += 1;
    lineItems.push({
      id: `xml-${index}`,
      code: extractCode(
        attributes.code ??
          [attributes.category, attributes.selector].filter(Boolean).join(' '),
        description,
      ),
      description,
      unit,
      quantity: quantity * multiplier,
      roomName: attributes.room ?? attributes.area,
    });
  }

  const claim = /<ClaimNumber>([^<]*)<\/ClaimNumber>/i.exec(text)?.[1]?.trim();
  return { source, claimNumber: claim || undefined, lineItems };
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    attributes[match[1]!.toLowerCase()] = decodeEntities(match[2]!);
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ */
/* Free text (PDF paste)                                               */
/* ------------------------------------------------------------------ */

/**
 * Text lifted out of a PDF loses its table structure but keeps its line order.
 * What survives reliably is: a description, then a quantity, then a unit —
 * which is exactly enough. Anything that does not match that shape is skipped
 * rather than guessed at.
 */
function fromText(text: string, source: string): MitigationEstimate {
  const lineItems: MitigationLineItem[] = [];
  // Room headings in a PDF are a bare line with no numbers on it.
  const roomHeading = /^[A-Z][A-Za-z0-9 /'()-]{1,40}$/;
  const linePattern =
    /^\s*(?:\d+[.)]\s*)?(.+?)\s+([0-9][0-9,]*\.?[0-9]*)\s*(SF|LF|EA|SY|HR|DA|DAY|CF|SQ|ITEM)\b/i;

  let currentRoom: string | undefined;
  let index = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = linePattern.exec(line);
    if (!match) {
      if (roomHeading.test(line) && !/\d/.test(line)) currentRoom = line;
      continue;
    }

    const description = match[1]!.trim();
    const quantity = Number(match[2]!.replace(/,/g, ''));
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;

    const { unit, multiplier } = normaliseUnit(match[3]!);
    index += 1;
    lineItems.push({
      id: `text-${index}`,
      code: extractCode('', description),
      description,
      unit,
      quantity: quantity * multiplier,
      roomName: currentRoom,
    });
  }

  return { source, lineItems };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export type MitigationFormat = 'csv' | 'xml' | 'text' | 'auto';

/**
 * Parse a mitigation estimate in whichever format it arrived.
 *
 * Format detection is by content, not by filename: an "estimate.txt" that is
 * really a CSV is common enough that trusting the extension loses data.
 */
export function parseMitigationEstimate(
  content: string,
  options: { source: string; format?: MitigationFormat } = { source: 'upload' },
): MitigationEstimate {
  const format = options.format && options.format !== 'auto' ? options.format : detectFormat(content);

  const parsed =
    format === 'xml'
      ? fromXml(content, options.source)
      : format === 'csv'
        ? fromCsv(content, options.source)
        : fromText(content, options.source);

  if (parsed.lineItems.length === 0) {
    throw new Error(
      `No line items could be read from the mitigation estimate (parsed as ${format}). Check that the export includes descriptions, quantities, and units.`,
    );
  }

  return parsed;
}

function detectFormat(content: string): Exclude<MitigationFormat, 'auto'> {
  const head = content.slice(0, 4000);
  if (/<\s*(\?xml|Estimate|LineItem|Item)\b/i.test(head)) return 'xml';

  // A CSV has commas on most of its lines; a PDF paste almost never does.
  const lines = head.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lines.length > 1) {
    const commaLines = lines.filter((l) => l.includes(',')).length;
    if (commaLines / lines.length > 0.6) return 'csv';
  }

  return 'text';
}
