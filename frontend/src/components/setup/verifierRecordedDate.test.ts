import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function extractDateFns() {
  const start = verifierHtml.indexOf('function parseDate(iso)');
  const end = verifierHtml.indexOf('function integrityOf(item)');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not find recorded-date helpers in verifier/index.html');
  }
  return new Function(
    `${verifierHtml.slice(start, end)}; return { parseDate, dayLabel, timeLabel, stamp, whenCell };`,
  )() as {
    dayLabel: (iso: string | null | undefined) => string;
    timeLabel: (iso: string | null | undefined) => string;
    stamp: (iso: string | null | undefined) => string;
    whenCell: (dayIso: string, instantIso: string) => string;
  };
}

function bootVerifier() {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/?demo=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      })) as unknown as typeof window.matchMedia;
    },
  });
}

describe('verifier recorded-date formatting', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('formats a calendar day with the year, never as a syslog stamp', () => {
    const { dayLabel, timeLabel, stamp } = extractDateFns();
    expect(dayLabel('2026-09-01')).toBe('Sep 1, 2026');
    expect(timeLabel('2026-09-01T14:16:00')).toBe('2:16 PM');
    expect(stamp('2026-09-01T14:16:00')).toBe('Sep 1, 2026 · 2:16 PM');
    expect(stamp(null)).toBe('—');
    expect(timeLabel('2026-09-01')).toBe('');
    expect(verifierHtml).not.toContain('hour12: false');
    expect(verifierHtml).not.toContain('Recorded date');
  });

  it('puts the date on the first line and only the clock on the second', () => {
    const { whenCell } = extractDateFns();
    const html = whenCell('2026-09-01', '2026-09-01T14:16:00');
    expect(html).toContain('datetime="2026-09-01T14:16:00"');
    expect(html).toContain('>Sep 1, 2026</time>');
    expect(html).toContain('<small>2:16 PM</small>');
    expect(html).not.toContain('<small>Sep 1');
    expect(html).not.toContain('14:16</small>');
  });

  it('renders complementary date and time in dashboard job and clip rows', async () => {
    const dom = bootVerifier();
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;

    const jobCell = document.querySelector('tr.jobrow td.job-when');
    expect(jobCell).not.toBeNull();
    const jobDay = jobCell!.querySelector('time')?.textContent ?? '';
    const jobTime = jobCell!.querySelector('small')?.textContent ?? '';
    expect(jobDay).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(jobTime).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(jobTime).not.toMatch(/[A-Z][a-z]{2}/);

    const clipCell = document.querySelector('tr.cliprow td.job-when');
    expect(clipCell).not.toBeNull();
    const clipDay = clipCell!.querySelector('time')?.textContent ?? '';
    const clipTime = clipCell!.querySelector('small')?.textContent ?? '';
    expect(clipDay).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(clipTime).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(clipTime).not.toContain(clipDay);

    const header = document.querySelector('th[data-sort-key="recorded"] button');
    expect(header?.textContent).toMatch(/^Recorded/);
    expect(header?.textContent).not.toContain('Recorded date');

    dom.window.close();
  });
});
