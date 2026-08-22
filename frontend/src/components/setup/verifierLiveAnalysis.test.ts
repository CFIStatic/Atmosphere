import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

const VERDICT_WORD = {
  appears_complete: ['pass', 'Appears complete'],
  in_progress: ['unknown', 'In progress'],
  not_visible: ['neutral', 'Not visible'],
};

function liveFns() {
  const block = verifierHtml.match(/\/\* ::live-analysis \*\/[\s\S]*?\/\* ::live-analysis-end \*\//);
  if (!block) throw new Error('Could not find live-analysis helpers in verifier/index.html');
  const ctx = createContext({
    VERDICT_WORD,
    result: null as null | {
      analysisLog: (item: Record<string, unknown>) => Array<{ at: number; text: string; kind: string }>;
      lastRevealedIndex: (rows: Array<{ at: number }>, seconds: number) => number;
      analysisPillLabel: (item: Record<string, unknown>, revealedCount: number, rowCount: number) => string;
      analysisIsLive: (item: Record<string, unknown>) => boolean;
      synthesizedLiveScript: (item: Record<string, unknown>) => Array<{ at: number; text: string; kind: string }>;
    },
  });
  runInContext(
    `${block[0]}
    result = {
      analysisLog: analysisLog,
      lastRevealedIndex: lastRevealedIndex,
      analysisPillLabel: analysisPillLabel,
      analysisIsLive: analysisIsLive,
      synthesizedLiveScript: synthesizedLiveScript
    };`,
    ctx,
  );
  if (!ctx.result) throw new Error('Failed to evaluate live-analysis helpers');
  return ctx.result;
}

describe('verifier live AI analysis', () => {
  const fns = liveFns();

  it('keeps the empty writing state until the playhead reaches the first note', () => {
    const rows = fns.analysisLog({
      duration: 143,
      analysis: {
        state: 'done',
        dictationEntries: [
          { atSeconds: 12, text: 'Opens on the north slope — tarp gone, deck exposed.' },
          { atSeconds: 48, text: 'Underlayment rows visible mid-slope.' },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(fns.lastRevealedIndex(rows, 0)).toBe(-1);
    expect(fns.lastRevealedIndex(rows, 11)).toBe(-1);
    expect(fns.lastRevealedIndex(rows, 12)).toBe(0);
    expect(fns.lastRevealedIndex(rows, 48)).toBe(1);
    expect(fns.analysisPillLabel({ analysis: { state: 'done' } }, 0, rows.length)).toBe('Writing…');
    expect(fns.analysisPillLabel({ analysis: { state: 'done' } }, rows.length, rows.length)).toBe(
      'Read',
    );
  });

  it('keeps WRITING on a queued clip even after notes have landed', () => {
    const item = { analysis: { state: 'queued' } };
    expect(fns.analysisIsLive(item)).toBe(true);
    expect(fns.analysisPillLabel(item, 2, 4)).toBe('Writing…');
  });

  it('does not dump the queued reason as a fake t=0 note', () => {
    const rows = fns.analysisLog({
      duration: 132,
      analysis: {
        state: 'queued',
        reason: 'Queued for analysis. The model has not read the day yet.',
        dictationEntries: [
          { atSeconds: 12, text: 'Front room: framing is closed.' },
          { atSeconds: 38, text: 'Board is hung on the long wall.' },
        ],
      },
    });
    expect(rows.map((r) => r.at)).toEqual([12, 38]);
    expect(rows.some((r) => /Queued for analysis/.test(r.text))).toBe(false);
  });

  it('synthesizes timed notes from demo frames instead of leaving the panel empty', () => {
    const rows = fns.synthesizedLiveScript({
      phase: 'after',
      analysis: { state: 'none' },
      _frames: [
        { at: 0, wet: 0.5, cut: 0.1, gear: 2 },
        { at: 40, wet: 0.2, cut: 0.6, gear: 1 },
      ],
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].at).toBeGreaterThan(0);
    expect(rows[0].text).toMatch(/Staining|drying|Flood cut|equipment/i);
  });

  it('wires the player to write notes live as the footage plays', () => {
    expect(verifierHtml).toContain('The assistant is reading this clip. Notes land here as the footage plays.');
    expect(verifierHtml).toContain('id="alog-empty"');
    expect(verifierHtml).toContain('livepill');
    expect(verifierHtml).toContain("pill === 'Writing…'");
    expect(verifierHtml).toContain('startLiveAnalysisWatch');
    expect(verifierHtml).toContain('data-full=');
    expect(verifierHtml).not.toContain("i === 0 ? 'on'");
    expect(verifierHtml).toContain('startTyping');
    expect(verifierHtml).toContain('Front room: framing is closed; two dehumidifiers still in the corner.');
  });
});
