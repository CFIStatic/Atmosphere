import { describe, expect, it } from 'vitest';
import {
  askSourceLabel,
  extractAskSources,
  mapAskSourceFragment,
  parseLegacySourceBlob,
} from './askSources';

describe('askSources', () => {
  it('maps job-file section aliases', () => {
    expect(mapAskSourceFragment('Field Capture')).toBe('access');
    expect(mapAskSourceFragment('Brief note')).toBe('brief_note');
    expect(mapAskSourceFragment('Scope')).toBe('scope');
    expect(mapAskSourceFragment('Invited section')).toBe('invited');
    expect(mapAskSourceFragment('Videos and mic')).toBe('videos');
  });

  it('parses legacy slash-soup Source blobs into separate ids', () => {
    expect(parseLegacySourceBlob('Field Capture / Brief note / Scope')).toEqual([
      'access',
      'brief_note',
      'scope',
    ]);
    expect(
      parseLegacySourceBlob('Videos and mic, 2026-09-05, 2026-09-09, and 2026-09-12 clips'),
    ).toEqual(['clip:2026-09-05', 'clip:2026-09-09', 'clip:2026-09-12', 'videos']);
  });

  it('extracts structured trailer into clean chip labels', () => {
    const { body, sources } = extractAskSources(
      'Jack is on the roster.\n\n⟦sources: invited, scope, clip:2026-09-12⟧',
    );
    expect(body).toBe('Jack is on the roster.');
    expect(sources.map((s) => s.label)).toEqual(['Who is on this job', 'Scope', 'Sep 12 clip']);
    expect(sources.map((s) => s.section)).toEqual(['parties', 'scope', 'videos']);
  });

  it('strips ugly legacy Source parentheticals into chips', () => {
    const { body, sources } = extractAskSources(
      'Do not touch the skylights.\n\n(Source: Field Capture / Brief note / Scope).',
    );
    expect(body).not.toMatch(/Source:/i);
    expect(body).toContain('skylights');
    expect(sources.map((s) => s.label)).toEqual(['Who has access', 'Brief note', 'Scope']);
  });

  it('labels clip dates short and clear', () => {
    expect(askSourceLabel('clip:2026-09-05')).toBe('Sep 5 clip');
  });
});
