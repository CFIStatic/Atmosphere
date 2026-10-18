import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

type Clip = Record<string, unknown>;
type Dir = 'asc' | 'desc';
type Sort = {
  compareClips: (a: Clip, b: Clip, key: string, dir: Dir) => number;
  sortJobKeys: (
    keys: string[],
    jobs: Record<string, { name: string }>,
    groups: Record<string, Clip[]>,
    key: string,
    dir: Dir,
  ) => string[];
  clipSortInstant: (e: Clip) => number | null;
  defaultSortDir: (key: string) => Dir;
};

function loadSort(): Sort {
  const s1 = verifierHtml.indexOf('function clipInstant(e, keys)');
  const e1 = verifierHtml.indexOf('function recordJobId(key)');
  const s2 = verifierHtml.indexOf('/* library-sort:begin');
  const e2 = verifierHtml.indexOf('/* library-sort:end */');
  if (s1 < 0 || e1 < 0 || s2 < 0 || e2 < 0) throw new Error('sort helpers not found');
  return new Function(
    `${verifierHtml.slice(s1, e1)}\n${verifierHtml.slice(s2, e2)}\n` +
      'return { compareClips, sortJobKeys, clipSortInstant, defaultSortDir };',
  )() as Sort;
}

const done = { analysis: { state: 'done' } };
const clip = (id: string, job: string, capturedAt: string | null, extra: Clip = {}): Clip => ({
  id,
  job,
  jobName: job,
  title: id,
  capturedAt,
  ...done,
  ...extra,
});

// Oak: Oct 1 + Oct 9. Elm: Oct 5. Pine: Oct 3 + Oct 7. Ash/Birch: no clips.
const groups: Record<string, Clip[]> = {
  oak: [clip('oak-1', 'Oak', '2026-10-01T15:00:00Z'), clip('oak-2', 'Oak', '2026-10-09T15:00:00Z')],
  elm: [clip('elm-1', 'Elm', '2026-10-05T15:00:00Z')],
  pine: [clip('pine-1', 'Pine', '2026-10-07T15:00:00Z'), clip('pine-2', 'Pine', '2026-10-03T15:00:00Z')],
  birch: [],
  ash: [],
};
const jobs = {
  birch: { name: 'Birch' },
  oak: { name: 'Oak' },
  ash: { name: 'Ash' },
  elm: { name: 'Elm' },
  pine: { name: 'Pine' },
};
const keys = ['birch', 'oak', 'ash', 'elm', 'pine'];

describe('All videos sort', () => {
  it('sorts job folders by their newest clip when descending', () => {
    const { sortJobKeys } = loadSort();
    expect(sortJobKeys(keys, jobs, groups, 'recorded', 'desc')).toEqual(['oak', 'pine', 'elm', 'ash', 'birch']);
  });

  it('sorts job folders by their oldest clip when ascending', () => {
    const { sortJobKeys } = loadSort();
    expect(sortJobKeys(keys, jobs, groups, 'recorded', 'asc')).toEqual(['oak', 'pine', 'elm', 'ash', 'birch']);
    // Oak oldest Oct 1, Pine oldest Oct 3, Elm Oct 5 — and a newer-only job goes last.
    const g2 = { ...groups, oak: [clip('oak-2', 'Oak', '2026-10-09T15:00:00Z')] };
    expect(sortJobKeys(keys, jobs, g2, 'recorded', 'asc')).toEqual(['pine', 'elm', 'oak', 'ash', 'birch']);
    expect(sortJobKeys(keys, jobs, g2, 'recorded', 'desc')).toEqual(['oak', 'pine', 'elm', 'ash', 'birch']);
  });

  it('keeps jobs with no clips at the bottom in both directions, A→Z', () => {
    const { sortJobKeys } = loadSort();
    for (const dir of ['asc', 'desc'] as const) {
      for (const key of ['recorded', 'status', 'uploader', 'preview']) {
        expect(sortJobKeys(keys, jobs, groups, key, dir).slice(-2)).toEqual(['ash', 'birch']);
      }
    }
  });

  it('sorts job name both ways, empty jobs included by name', () => {
    const { sortJobKeys } = loadSort();
    expect(sortJobKeys(keys, jobs, groups, 'job', 'asc')).toEqual(['ash', 'birch', 'elm', 'oak', 'pine']);
    expect(sortJobKeys(keys, jobs, groups, 'job', 'desc')).toEqual(['pine', 'oak', 'elm', 'birch', 'ash']);
  });

  it('orders clips inside a job in the chosen direction', () => {
    const { compareClips } = loadSort();
    const c = [...groups.oak, ...groups.pine];
    const ids = (dir: Dir) => [...c].sort((a, b) => compareClips(a, b, 'recorded', dir)).map((x) => x.id);
    expect(ids('desc')).toEqual(['oak-2', 'pine-1', 'pine-2', 'oak-1']);
    expect(ids('asc')).toEqual(['oak-1', 'pine-2', 'pine-1', 'oak-2']);
  });

  it('compares real timestamps, not display strings', () => {
    const { compareClips } = loadSort();
    // Same day, 9:05 AM vs 10:00 AM local — "9:05" > "10:00" as text.
    const a = clip('a', 'Oak', '2026-10-08T09:05:00-05:00');
    const b = clip('b', 'Oak', '2026-10-08T10:00:00-05:00');
    // Different offsets: b is actually earlier than c.
    const c = clip('c', 'Oak', '2026-10-08T16:30:00Z');
    expect([c, a, b].sort((x, y) => compareClips(x, y, 'recorded', 'asc')).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads a bare workDate as local noon so evening clips stay on their day', () => {
    const { clipSortInstant } = loadSort();
    const t = clipSortInstant({ workDate: '2026-10-08' })!;
    const d = new Date(t);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 10, 8, 12]);
    expect(clipSortInstant({})).toBeNull();
  });

  it('breaks ties by name then id, the same way in both directions', () => {
    const { compareClips, sortJobKeys } = loadSort();
    const at = '2026-10-08T15:00:00Z';
    const t = [clip('z', 'Oak', at, { title: 'b' }), clip('y', 'Oak', at, { title: 'a' }), clip('x', 'Oak', at, { title: 'a' })];
    for (const dir of ['asc', 'desc'] as const) {
      expect([...t].sort((a, b) => compareClips(a, b, 'recorded', dir)).map((x) => x.id)).toEqual(['x', 'y', 'z']);
    }
    const g = { b: [clip('1', 'B', at)], a: [clip('2', 'A', at)] };
    const j = { a: { name: 'A' }, b: { name: 'B' } };
    expect(sortJobKeys(['b', 'a'], j, g, 'recorded', 'desc')).toEqual(['a', 'b']);
    expect(sortJobKeys(['b', 'a'], j, g, 'recorded', 'asc')).toEqual(['a', 'b']);
  });

  it('sorts status by meaning and uploader by name, missing values last', () => {
    const { compareClips } = loadSort();
    const ok = clip('ok', 'Oak', '2026-10-08T15:00:00Z', { person: 'Zed' });
    const bad = clip('bad', 'Oak', '2026-10-07T15:00:00Z', { analysis: { state: 'failed' }, person: 'Amy' });
    const anon = clip('anon', 'Oak', '2026-10-06T15:00:00Z');
    const by = (key: string, dir: Dir) => [ok, anon, bad].sort((a, b) => compareClips(a, b, key, dir)).map((x) => x.id);
    expect(by('status', 'asc')[0]).toBe('bad');
    expect(by('uploader', 'asc')).toEqual(['bad', 'ok', 'anon']);
    expect(by('uploader', 'desc')).toEqual(['ok', 'bad', 'anon']);
  });

  it('header is a button with aria-sort and an arrow that flips', () => {
    const dom = new JSDOM(verifierHtml);
    const th = dom.window.document.querySelector('th[data-sort-key="recorded"]')!;
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(th.querySelector('button')).not.toBeNull();
    expect(th.querySelector('.sortcaret')!.textContent).toBe('↓');
    expect(verifierHtml).toContain("caret.textContent = active ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕'");
    expect(verifierHtml).toContain('order = sortJobKeys(order, JOBS, groups');
    const { defaultSortDir } = loadSort();
    expect(defaultSortDir('recorded')).toBe('desc');
    expect(defaultSortDir('job')).toBe('asc');
  });
});
