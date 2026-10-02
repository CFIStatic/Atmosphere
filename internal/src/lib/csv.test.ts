import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv export', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('plain')).toBe('plain');
  });
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"\nok']])).toBe('a,b\r\n"x,y","he said ""hi""\nok"\r\n');
    expect(csvCell(null)).toBe('');
  });
});
