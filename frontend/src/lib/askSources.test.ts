import { describe, expect, it } from 'vitest';
import {
  askSourceLabel,
  extractAskSources,
  mapAskSourceFragment,
  parseLegacySourceBlob,
  stableClipCitationLabel,
  truncateAtWord,
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

  it('reads the clip name off a quote card and never shows a blank speaker', () => {
    const job = '00000000-0000-4000-8000-0000000000a2';
    const proof = '00000000-0000-4000-8000-0000000000b1';
    const cite = `video/${job}/${proof}/dining-table@14.6`;
    const { quotes } = extractAskSources(
      `Two lines.\n\n⟦quotes: ${cite}|Unidentified speaker|We just have to switch to LedgerPro cloud.|clip=Short Handheld Phone Clip ;; ${cite.replace('@14.6', '@18.56')}||Okay, I'm going to set it up now.⟧`,
    );
    expect(quotes[0]).toMatchObject({
      speaker: 'Unidentified speaker',
      text: 'We just have to switch to LedgerPro cloud.',
      atSeconds: 14.6,
      proofId: proof,
      clipTitle: 'Short Handheld Phone Clip',
    });
    expect(quotes[1]).toMatchObject({ speaker: 'Unidentified speaker', atSeconds: 18.56 });
    expect(quotes[1]?.clipTitle).toBeUndefined();
  });

  it('opens a moment chip at the transcript timestamp and keeps the quote', () => {
    const job = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
    const proof = '00608802-140e-4897-9f02-1d5d0db88ecf';
    const cite = `video/${job}/${proof}/sep-17-office-recording@4.2`;
    const { body, sources, quotes, followUps } = extractAskSources(
      `The tarp came off.\n\n⟦sources: ${cite}⟧\n⟦quotes: ${cite}|Seated man|The tarp came off the north slope.⟧\n⟦followups: What was said in the tabletop clip? ;; What does the job history say?⟧`,
    );
    expect(body).toBe('The tarp came off.');
    expect(sources[0]?.label).toMatch(/0:04/);
    expect(sources[0]?.atSeconds).toBe(4.2);
    expect(sources[0]?.proofId).toBe(proof);
    expect(sources[0]?.jobId).toBe(job);
    expect(quotes[0]).toMatchObject({ speaker: 'Unidentified speaker', text: 'The tarp came off the north slope.', atSeconds: 4.2 });
    expect(quotes[0]?.speaker).not.toMatch(/\(|seated|homeowner/i);
    expect(followUps).toEqual([
      'What was said in the tabletop clip?',
      'What does the job history say?',
    ]);
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

  // Exact junk trailer from live user screenshot after “can you search google”
  it('strips exact screenshot [web:…] google/wikihow junk trailer', () => {
    const junk =
      '[web: Google|https://www.google.com/xhtml/search, Google Search - A new kind of help|https://search.google/, How to Search Google: Basic Advanced & AI Options|https://www.wikihow.com/Search-Google]';
    const { body, webSources } = extractAskSources(
      `Yes — I can search the public web when you need it.${junk}`,
    );
    expect(body).toBe('Yes — I can search the public web when you need it.');
    expect(body).not.toMatch(/\[web:/i);
    expect(body).not.toMatch(/google\.com|search\.google|wikihow/i);
    expect(webSources).toEqual([]);
  });

});

describe('document quotes', () => {
  it('never label a document excerpt with a speaker', async () => {
    const { parseAskQuoteTrailer, isDocumentQuoteSource } = await import('./askSources');
    const quotes = parseAskQuoteTrailer(
      'Answer.\n\n⟦quotes: doc:abc#document|Unidentified speaker|Blox Group – Automated construction.|clip=The Future.docx ;; video/j/p/s@4.2||The tarp came off.⟧',
    );
    expect(quotes[0]).toMatchObject({ speaker: '', clipTitle: 'The Future.docx', text: 'Blox Group – Automated construction.' });
    expect(quotes[1]).toMatchObject({ speaker: 'Unidentified speaker' });
    expect(isDocumentQuoteSource('doc:abc#page 1')).toBe(true);
    expect(isDocumentQuoteSource('video/j/p/s@4.2')).toBe(false);
  });
});


  it('item 3: stable clip labels never truncate mid-word or lowercase titles', () => {
    expect(truncateAtWord('Tear Off North Slope Ridge Cap', 18)).toBe('Tear Off North');
    expect(stableClipCitationLabel({ title: 'Tear Off North Slope', atSeconds: 14 })).toBe(
      'Tear Off North Slope · 0:14',
    );
    expect(stableClipCitationLabel({ workDate: '2026-09-17', clipNumber: 2 })).toBe('Sep 17 · Clip 2');
    expect(stableClipCitationLabel({ title: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', workDate: '2026-09-17' })).toBe(
      'Sep 17 clip',
    );
    const slugLabel = askSourceLabel(
      'video/00000000-0000-4000-8000-0000000000a2/00000000-0000-4000-8000-0000000000b1/kitchen-walkthrough@12' as never,
    );
    expect(slugLabel).toBe('Kitchen Walkthrough · 0:12');
    expect(slugLabel).not.toMatch(/kitchen walkthrough/);
  });

  it('item 3: source chips prefer quote clip titles and keep seek time', () => {
    const job = '00000000-0000-4000-8000-0000000000a2';
    const proof = '00000000-0000-4000-8000-0000000000b1';
    const cite = `video/${job}/${proof}/ignored-slug@9`;
    const { sources } = extractAskSources(
      `Said it.\n\n⟦sources: ${cite}⟧\n⟦quotes: ${cite}|Speaker 1|Hello there.|clip=South Slope Tear-Off⟧`,
    );
    expect(sources[0]?.label).toBe('South Slope Tear-Off · 0:09');
    expect(sources[0]?.atSeconds).toBe(9);
    expect(sources[0]?.proofId).toBe(proof);
  });
