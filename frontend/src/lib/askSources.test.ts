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

  it('extracts web citation trailers into clickable link chips', () => {
    const { body, sources, webSources } = extractAskSources(
      'IRC R905 covers asphalt shingle underlayment.\n\n⟦sources: scope⟧\n\n⟦web: IRC R905|https://codes.iccsafe.org/r905, GAF guide|https://www.gaf.com/install⟧',
    );
    expect(body).toBe('IRC R905 covers asphalt shingle underlayment.');
    expect(sources.map((s) => s.label)).toEqual(['Scope']);
    expect(webSources).toEqual([
      { title: 'IRC R905', url: 'https://codes.iccsafe.org/r905' },
      { title: 'GAF guide', url: 'https://www.gaf.com/install' },
    ]);
  });

  it('extracts action trailers from Ask tools', () => {
    const { body, actions } = extractAskSources(
      'Updated claim number on this job.\n\n⟦actions: update_job_fields|Updated claimNumber on this Atmosphere job file|setup|⟧',
    );
    expect(body).toBe('Updated claim number on this job.');
    expect(actions[0]?.tool).toBe('update_job_fields');
    expect(actions[0]?.section).toBe('setup');
  });

  it('cites CRM trailers as CRM source chips', () => {
    const { body, sources } = extractAskSources(
      'Claim CLM-9 is on the JobNimbus file.\n\n⟦sources: crm, claim⟧',
    );
    expect(body).toBe('Claim CLM-9 is on the JobNimbus file.');
    expect(sources.map((s) => s.label)).toEqual(['CRM', 'Claim']);
  });


  it('strips ASCII [[web:…]] trailers from display prose', () => {
    const { body, webSources } = extractAskSources(
      'Would you like to search the web?[[web: Google|https://www.google.com/xhtml/search, Google Search|https://search.google/]]',
    );
    expect(body).toBe('Would you like to search the web?');
    expect(body).not.toMatch(/\[\[web:/i);
    expect(body).not.toMatch(/google\.com/i);
    // Google homepage junk is filtered from chips
    expect(webSources).toEqual([]);
  });

  it('still parses unicode ⟦web:…⟧ trailers into chips', () => {
    const { body, webSources } = extractAskSources(
      'IRC R905 covers underlayment.\n\n⟦web: IRC R905|https://codes.iccsafe.org/r905⟧',
    );
    expect(body).toBe('IRC R905 covers underlayment.');
    expect(webSources).toEqual([
      { title: 'IRC R905', url: 'https://codes.iccsafe.org/r905' },
    ]);
  });

  it('strips mixed mid-sentence web trailers without leaving junk', () => {
    const { body } = extractAskSources(
      'Yes, I can search.[web: How to search Google|https://www.wikihow.com/Search-Google]',
    );
    expect(body).toBe('Yes, I can search.');
    expect(body).not.toMatch(/web:/i);
  });

});
