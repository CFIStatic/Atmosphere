/**
 * SheetJS writer. Imported dynamically by DownloadButton so the library is a
 * separate chunk that loads on the first Download click, not on page load.
 *
 * SheetJS Community Edition 0.20.3 from the official CDN tarball
 * (https://cdn.sheetjs.com). The npm registry copy (0.18.5) is unmaintained and
 * carries CVE-2023-30533 and CVE-2024-22363; both are fixed in 0.20.3. This
 * file only writes workbooks; it never parses files.
 */
import { utils, write, type CellObject, type WorkBook } from 'xlsx';
import { normalizeCell, sheetName, type ExportSheet } from './excel';

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

function displayLength(value: unknown, format: string | null): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return format && format.includes('h') ? 16 : 10;
  if (typeof value === 'number') return Math.min(18, value.toLocaleString('en-US').length + (format?.includes('$') ? 2 : 0) + 1);
  return String(value).length;
}

export function buildWorkbook(sheets: ExportSheet[]): WorkBook {
  const wb = utils.book_new();
  const taken = new Set<string>();
  const list = sheets.length > 0 ? sheets : [{ name: 'Data', columns: [], rows: [] }];
  for (const sheet of list) {
    const header = sheet.columns.map((c) => c.header);
    const normalized = sheet.rows.map((row) => sheet.columns.map((col, i) => normalizeCell(row[i], col)));
    const ws = utils.aoa_to_sheet([header, ...normalized.map((row) => row.map((c) => c.value))]);

    normalized.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell.format) return;
        const ref = utils.encode_cell({ r: r + 1, c });
        const target = ws[ref] as CellObject | undefined;
        if (target && target.t === 'n') {
          target.z = cell.format;
          delete target.w;
        }
      });
    });

    ws['!cols'] = sheet.columns.map((col, c) => {
      const longest = Math.max(
        col.header.length,
        ...normalized.map((row) => displayLength(row[c]?.value, row[c]?.format ?? null)),
      );
      return { wch: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, longest + 2)) };
    });
    if (sheet.columns.length > 0) {
      ws['!autofilter'] = {
        ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(normalized.length, 1), c: sheet.columns.length - 1 } }),
      };
    }
    utils.book_append_sheet(wb, ws, sheetName(sheet.name, taken));
  }
  wb.Props = { Title: list.map((s) => s.name).join(', '), Author: 'Atmosphere Analytics', CreatedDate: new Date() };
  return wb;
}

export function workbookBytes(sheets: ExportSheet[]): ArrayBuffer {
  return write(buildWorkbook(sheets), { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
}

/** Builds the workbook and hands it to the browser as a download. */
export function saveWorkbook(filename: string, sheets: ExportSheet[]): void {
  const bytes = workbookBytes(sheets);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
