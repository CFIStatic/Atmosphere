import { describe, expect, it } from 'vitest';
import { read, utils } from 'xlsx';
import { exportFilename, normalizeCell, sheetName } from './excel';
import { buildWorkbook, workbookBytes } from './excelWriter';

describe('excel export helpers', () => {
  it('names files atmosphere-<table>-YYYY-MM-DD.xlsx', () => {
    expect(exportFilename('Growth & revenue: Monthly detail', new Date(2026, 9, 7))).toBe(
      'atmosphere-growth-and-revenue-monthly-detail-2026-10-07.xlsx',
    );
    expect(exportFilename('', new Date(2026, 0, 2))).toBe('atmosphere-export-2026-01-02.xlsx');
  });

  it('keeps sheet names inside Excel limits and unique', () => {
    const taken = new Set<string>();
    expect(sheetName('By customer / model [beta]', taken)).toBe('By customer model beta');
    const long = 'A very long sheet name that goes past thirty one characters';
    const first = sheetName(long, taken);
    const second = sheetName(long, taken);
    expect(first).toHaveLength(31);
    expect(second.endsWith('(2)')).toBe(true);
    expect(second.length).toBeLessThanOrEqual(31);
  });

  it('types cells: percent points become fractions, dates stay calendar dates, blanks are empty', () => {
    expect(normalizeCell(12.5, { header: 'x', type: 'percent' })).toEqual({ value: 0.125, format: '0.0%' });
    const day = normalizeCell('2026-09-21', { header: 'x', type: 'date' }).value as Date;
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 8, 21]);
    const month = normalizeCell('2026-03', { header: 'x', type: 'month' });
    expect((month.value as Date).getMonth()).toBe(2);
    expect(month.format).toBe('mmm yyyy');
    expect(normalizeCell(null, { header: 'x', type: 'usd' })).toEqual({ value: null, format: null });
    expect(normalizeCell(true, { header: 'x' })).toEqual({ value: 'Yes', format: null });
    expect(normalizeCell({ value: 3, type: 'usd' }, { header: 'x', type: 'percent' }).format).toBe('"$"#,##0.00');
  });

  it('writes a real .xlsx with headers, typed numbers and dates, and text that is never a formula', () => {
    const bytes = workbookBytes([
      {
        name: 'Monthly detail',
        columns: [
          { header: 'Month', type: 'month' },
          { header: 'MRR, USD', type: 'usd' },
          { header: 'Share', type: 'percent' },
          { header: 'Note' },
        ],
        rows: [
          ['2026-08', 1234.5, 40, '=HYPERLINK("http://example.test")'],
          ['2026-09', 2000, 60, null],
        ],
      },
    ]);
    const wb = read(bytes, { cellDates: true, cellNF: true });
    expect(wb.SheetNames).toEqual(['Monthly detail']);
    const ws = wb.Sheets['Monthly detail']!;
    const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
    expect(rows[0]).toEqual(['Month', 'MRR, USD', 'Share', 'Note']);
    expect(rows).toHaveLength(3);
    expect(ws.B2).toMatchObject({ t: 'n', v: 1234.5, z: '"$"#,##0.00' });
    expect(ws.C2).toMatchObject({ t: 'n', v: 0.4 });
    expect(ws.A2!.t).toBe('d');
    expect(ws.D2).toMatchObject({ t: 's', v: '=HYPERLINK("http://example.test")' });
    expect(ws.D2!.f).toBeUndefined();
    expect(ws['!autofilter']).toEqual({ ref: 'A1:D3' });
  });

  it('builds one sheet per table with unique names', () => {
    const wb = buildWorkbook([
      { name: 'Data', columns: [{ header: 'a' }], rows: [['x']] },
      { name: 'Data', columns: [{ header: 'b' }], rows: [] },
    ]);
    expect(wb.SheetNames).toEqual(['Data', 'Data (2)']);
  });
});
