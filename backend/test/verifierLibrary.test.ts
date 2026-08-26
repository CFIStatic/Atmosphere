import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisStateOf,
  dateSearchPhrases,
  downloadDecision,
  labelsForProof,
  matchesLibraryQuery,
  pickPosterFrame,
  shareRecipientAllowed,
  integrityOf,
  labelForCheck,
  needsAttention,
  serializeEvidence,
  shareState,
  youtubePosterAt,
  type StoredCheck,
} from '../src/verifier/library.js';

/**
 * The portal's rules. What earns a test here is anything that could quietly
 * flatter a clip — an unknown that reads as clean, a before that reads as
 * unanalysed, a dead link that still answers.
 */

const check = (verdict: StoredCheck['verdict'], key = 'on_site'): StoredCheck => ({
  key,
  verdict,
  detail: 'detail',
});

test('integrity: the worst check wins, and no checks means unknown, not pass', () => {
  assert.equal(integrityOf([check('pass'), check('pass')]), 'pass');
  assert.equal(integrityOf([check('pass'), check('unknown')]), 'unknown');
  assert.equal(integrityOf([check('pass'), check('unknown'), check('fail')]), 'fail');
  assert.equal(integrityOf([]), 'unknown');
  assert.equal(integrityOf(null), 'unknown');
});

test('check keys render as sentences, and unknown keys survive rather than vanish', () => {
  assert.equal(labelForCheck('on_site'), 'Filmed on site');
  assert.equal(labelForCheck('not_a_reupload'), 'Not filed before');
  assert.equal(labelForCheck('some_new_check'), 'some new check');
});

test('a before is paired or waiting — never "not analysed"', () => {
  assert.equal(
    analysisStateOf({ phase: 'before', analysisStatus: null, hasAiSummary: false, dayHasAfter: true }),
    'paired',
  );
  assert.equal(
    analysisStateOf({ phase: 'before', analysisStatus: null, hasAiSummary: false, dayHasAfter: false }),
    'waiting_on_after',
  );
  // Even a before that somehow carries a summary is reported by its pairing:
  // the day's reading lives on the after.
  assert.equal(
    analysisStateOf({ phase: 'before', analysisStatus: 'done', hasAiSummary: true, dayHasAfter: true }),
    'paired',
  );
});

test('an after follows the pipeline status, with the summary as the legacy fallback', () => {
  const after = (analysisStatus: string | null, hasAiSummary = false) =>
    analysisStateOf({ phase: 'after', analysisStatus, hasAiSummary, dayHasAfter: true });
  assert.equal(after('done'), 'done');
  assert.equal(after('queued'), 'queued');
  assert.equal(after('running'), 'queued');
  assert.equal(after('failed'), 'failed');
  assert.equal(after('skipped'), 'skipped');
  assert.equal(after(null, true), 'done');
  assert.equal(after(null, false), 'none');
});

test('flagging: anything short of a clean pass needs a person', () => {
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'done', materialChange: 'significant' }), false);
  assert.equal(needsAttention({ integrity: 'unknown', analysis: 'done', materialChange: 'significant' }), true);
  assert.equal(needsAttention({ integrity: 'fail', analysis: 'none', materialChange: null }), true);
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'failed', materialChange: null }), true);
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'done', materialChange: 'none' }), true);
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'done', materialChange: 'unclear' }), true);
  // The normal shape of a morning is not a flag.
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'waiting_on_after', materialChange: null }), false);
  assert.equal(needsAttention({ integrity: 'pass', analysis: 'queued', materialChange: null }), false);
});

test('share state: revoked outranks expiry, expiry is exact, missing is its own answer', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  assert.equal(shareState(null, now), 'missing');
  assert.equal(shareState({ revoked_at: null, expires_at: null }, now), 'live');
  assert.equal(shareState({ revoked_at: null, expires_at: '2026-09-01T00:00:00Z' }, now), 'live');
  assert.equal(shareState({ revoked_at: null, expires_at: '2026-08-10T12:00:00Z' }, now), 'expired');
  assert.equal(shareState({ revoked_at: null, expires_at: '2026-08-01T00:00:00Z' }, now), 'expired');
  // A share both revoked and expired reads as revoked: somebody acted, and
  // the record of the act is the answer.
  assert.equal(
    shareState({ revoked_at: '2026-08-05T00:00:00Z', expires_at: '2026-08-01T00:00:00Z' }, now),
    'revoked',
  );
});

test('serialization: labels attached, integrity computed, flag derived', () => {
  const item = serializeEvidence({
    proof: {
      id: 'p1',
      job_id: 'j1',
      party_id: 'pt1',
      phase: 'after',
      work_date: '2026-08-05',
      captured_at: '2026-08-05T20:00:00Z',
      received_at: '2026-08-05T20:03:00Z',
      duration_seconds: '143.00',
      byte_size: '1000',
      lat: 30.44,
      lon: -97.72,
      accuracy_m: 6,
      content_hash: 'abc',
      state: 'accepted',
      checks: [
        { key: 'on_site', verdict: 'pass', detail: '41 ft from the property centre.' },
        { key: 'same_day', verdict: 'pass', detail: 'Three minutes apart.' },
      ],
      ai_summary: 'The slope is stripped.',
      ai_findings: {
        summary: 'The slope is stripped.',
        materialChange: 'significant',
        materialBecause: 'The tarp is gone.',
        changes: ['Tarp removed'],
        cannotTell: ['Ridge detail'],
        scopeVerdicts: [{ title: 'Remove tarp', verdict: 'appears_complete' }],
        concerns: [],
      },
      ai_material_change: 'significant',
      ai_model: 'claude',
      analysis_status: 'done',
      legal_hold: false,
      retention_until: null,
    },
    jobName: 'Cedar Ridge',
    jobNumber: 1038,
    company: 'Delgado Roofing',
    contactName: 'Hector Delgado',
    tier: 2,
    dayHasAfter: true,
    address: '4118 Cedar Ridge Dr, Austin, TX',
    claimNumber: 'CLM-1038',
  });

  assert.equal(item.integrity, 'pass');
  assert.equal(item.flagged, false);
  assert.equal(item.analysisState, 'done');
  assert.equal(item.checks[0].what, 'Filmed on site');
  assert.equal(item.durationSeconds, 143);
  assert.equal(item.tier, 2);
  assert.equal(item.address, '4118 Cedar Ridge Dr, Austin, TX');
  assert.equal(item.claimNumber, 'CLM-1038');
  assert.equal(item.analysis?.materialBecause, 'The tarp is gone.');
  assert.deepEqual(item.analysis?.scope, [
    { title: 'Remove tarp', verdict: 'appears_complete', because: null, seenInWindows: undefined },
  ]);
  assert.deepEqual(item.analysis?.couldNotTell, ['Ridge detail']);
  // Without a separate narration_text, dictation falls back to the summary —
  // the office always has something to read next to the video.
  assert.equal(item.analysis?.dictation, 'The slope is stripped.');
  // No still was passed, so the row carries no poster and the portal draws
  // its placeholder rather than pointing an <img> at nothing.
  assert.equal(item.posterUrl, null);
});

test('youtube poster time is a quarter of the way through the clip', () => {
  assert.equal(youtubePosterAt(120), 30);
  assert.equal(youtubePosterAt(2), 1);
  assert.equal(youtubePosterAt(null), 1);

  const frames = [
    { at_seconds: 1, storage_path: 'a.jpg' },
    { at_seconds: 28, storage_path: 'b.jpg' },
    { at_seconds: 90, storage_path: 'c.jpg' },
  ];
  const picked = pickPosterFrame(frames, 120);
  assert.equal(picked?.storage_path, 'b.jpg');
  assert.equal(pickPosterFrame([], 120), null);
  assert.equal(pickPosterFrame([{ at_seconds: 3, storage_path: null }], 120), null);
});

test('serialization: a still out of the clip rides along as the poster', () => {
  const base = {
    id: 'p-poster',
    job_id: 'j1',
    party_id: 'pt1',
    phase: 'after',
    work_date: '2026-08-09',
    captured_at: '2026-08-09T15:00:00Z',
    received_at: '2026-08-09T15:04:00Z',
    duration_seconds: '96',
    byte_size: '1200',
    lat: null,
    lon: null,
    accuracy_m: null,
    content_hash: 'ghi',
    state: 'checked',
    checks: [],
  };
  const named = {
    jobName: 'Cedar Ridge',
    jobNumber: 1038,
    company: 'Delgado Roofing',
    contactName: 'Hector Delgado',
    tier: 1,
    dayHasAfter: true,
  };

  const withPoster = serializeEvidence({
    proof: base,
    ...named,
    posterUrl: 'https://storage.example/sign/frame.jpg?token=abc',
  });
  assert.equal(withPoster.posterUrl, 'https://storage.example/sign/frame.jpg?token=abc');

  // A clip whose stills have not been extracted yet is null, never undefined:
  // the portal tests the field to decide between a real frame and a drawing.
  const withoutPoster = serializeEvidence({ proof: base, ...named, posterUrl: null });
  assert.equal(withoutPoster.posterUrl, null);
});

test('serialization: office dictation prefers narration_text over the day summary', () => {
  const item = serializeEvidence({
    proof: {
      id: 'p-dictation',
      job_id: 'j1',
      party_id: 'pt1',
      phase: 'after',
      work_date: '2026-08-07',
      captured_at: '2026-08-07T14:00:00Z',
      received_at: '2026-08-07T14:11:00Z',
      duration_seconds: '240',
      byte_size: '2000',
      lat: 30.44,
      lon: -97.72,
      accuracy_m: 6,
      content_hash: 'def',
      state: 'checked',
      checks: [{ key: 'on_site', verdict: 'pass', detail: 'on site' }],
      ai_summary: 'Short headline.',
      ai_findings: { longForm: true, timeline: [] },
      ai_material_change: null,
      ai_model: 'claude',
      analysis_status: null,
      narration_status: 'done',
      narration_text:
        'The crew strips the north slope through the morning, then lays underlayment after lunch.',
      narration: { entries: [{ atSeconds: 0, text: 'Tear-off begins.' }], model: 'claude' },
      legal_hold: false,
      retention_until: null,
    },
    jobName: 'Cedar Ridge',
    jobNumber: 1038,
    company: 'Delgado Roofing',
    contactName: 'Hector Delgado',
    tier: 2,
    dayHasAfter: true,
  });

  assert.equal(item.analysisState, 'done', 'finished dictation alone is enough for the office view');
  assert.equal(
    item.analysis?.dictation,
    'The crew strips the north slope through the morning, then lays underlayment after lunch.',
  );
  assert.equal(item.analysis?.dictationStatus, 'done');
  assert.equal(item.analysis?.summary, 'Short headline.');
});

test('serialization: microphone speech rides next to dictation and stays a proposal', () => {
  const item = serializeEvidence({
    proof: {
      id: 'p-speech',
      job_id: 'j1',
      party_id: 'pt1',
      phase: 'after',
      work_date: '2026-08-26',
      captured_at: '2026-08-26T14:00:00Z',
      received_at: '2026-08-26T14:11:00Z',
      duration_seconds: '180',
      byte_size: '2000',
      lat: null,
      lon: null,
      accuracy_m: null,
      content_hash: 'spe',
      state: 'checked',
      checks: [{ key: 'on_site', verdict: 'pass', detail: 'on site' }],
      ai_summary: 'Headline.',
      narration_status: 'done',
      narration_text: 'The crew pulls wet drywall.',
      transcript_status: 'done',
    },
    jobName: 'Cedar Ridge',
    jobNumber: 1038,
    company: 'Delgado Roofing',
    contactName: 'Hector Delgado',
    tier: 1,
    dayHasAfter: true,
    speech: [{ atSeconds: 14, endSeconds: 22, text: 'North slope is stripped.', confidence: 0.9 }],
  });
  assert.equal(item.speechStatus, 'done');
  assert.equal(item.speech?.[0]?.text, 'North slope is stripped.');
  assert.equal(item.analysis?.speech?.[0]?.text, 'North slope is stripped.');
});

test('serialization: structured actions from the vision log ride with dictation', () => {
  const item = serializeEvidence({
    proof: {
      id: 'p-actions',
      job_id: 'j1',
      party_id: 'pt1',
      phase: 'after',
      work_date: '2026-08-20',
      captured_at: '2026-08-20T14:00:00Z',
      received_at: '2026-08-20T14:11:00Z',
      duration_seconds: '90',
      byte_size: '2000',
      lat: null,
      lon: null,
      accuracy_m: null,
      content_hash: 'abc',
      state: 'checked',
      checks: [{ key: 'on_site', verdict: 'pass', detail: 'on site' }],
      ai_summary: 'Drywall coming off the south wall.',
      ai_findings: {},
      ai_material_change: null,
      ai_model: 'claude',
      analysis_status: 'done',
      narration_status: 'done',
      narration_text: 'The crew is pulling wet drywall.',
      narration: { entries: [], model: 'claude' },
      actions: [
        {
          atSeconds: 12,
          action: 'remove',
          description: 'Worker pulling wet drywall off the south wall.',
          objectLabel: 'drywall',
          toolLabel: 'utility knife',
          materialLabel: null,
          objects: ['drywall'],
          confidence: 0.86,
          model: 'claude',
          source: 'ai_vision',
        },
      ],
      legal_hold: false,
      retention_until: null,
    },
    jobName: 'Kitchen demo',
    jobNumber: 1041,
    company: 'Field Capture',
    contactName: 'Marcus',
    tier: 1,
    dayHasAfter: true,
  });

  assert.equal(item.analysisState, 'done');
  assert.equal((item.analysis as { actions?: Array<{ action: string }> } | null)?.actions?.[0]?.action, 'remove');
});

test('serialization: a wrong-house clip arrives flagged with no analysis body', () => {
  const item = serializeEvidence({
    proof: {
      id: 'p2',
      job_id: 'j1',
      party_id: 'pt1',
      phase: 'before',
      work_date: '2026-08-04',
      captured_at: null,
      received_at: '2026-08-04T07:33:00Z',
      duration_seconds: null,
      byte_size: null,
      lat: null,
      lon: null,
      accuracy_m: null,
      content_hash: null,
      state: 'checked',
      checks: [{ key: 'on_site', verdict: 'fail', detail: '2.14 miles away.' }],
      ai_summary: null,
      ai_findings: null,
      ai_material_change: null,
      ai_model: null,
      analysis_status: null,
      legal_hold: true,
      retention_until: null,
    },
    jobName: 'Cedar Ridge',
    jobNumber: 1038,
    company: 'Delgado Roofing',
    contactName: null,
    tier: null,
    dayHasAfter: false,
  });

  assert.equal(item.integrity, 'fail');
  assert.equal(item.flagged, true);
  assert.equal(item.analysisState, 'waiting_on_after');
  assert.equal(item.analysis, null);
  assert.equal(item.gps, null);
  assert.equal(item.tier, 1, 'no episode yet reads as Tier 1, not as nothing');
  assert.equal(item.legalHold, true);
});


/* ---- library search ---- */

test('search matches job name, company, address, hash, and id', () => {
  const fields = [
    'EV-1',
    'Jack Cyganiak 2',
    1041,
    '#1041',
    '1842 Meridian Ave, Austin, TX',
    'Delgado Roofing',
    'Hector Delgado',
    '9f2c4a1b7e58d309',
    'after',
  ];
  const dates = ['2026-08-05', '2026-08-05T20:48:00'];

  assert.equal(matchesLibraryQuery('', fields, dates), true);
  assert.equal(matchesLibraryQuery('jack', fields, dates), true);
  assert.equal(matchesLibraryQuery('Cyganiak', fields, dates), true);
  assert.equal(matchesLibraryQuery('delgado', fields, dates), true);
  assert.equal(matchesLibraryQuery('meridian', fields, dates), true);
  assert.equal(matchesLibraryQuery('1041', fields, dates), true);
  assert.equal(matchesLibraryQuery('#1041', fields, dates), true);
  assert.equal(matchesLibraryQuery('9f2c4a1b', fields, dates), true);
  assert.equal(matchesLibraryQuery('EV-1', fields, dates), true);
  assert.equal(matchesLibraryQuery('no such job', fields, dates), false);
});

test('search matches filmed dates the way people type them', () => {
  const dates = ['2026-08-05'];
  assert.ok(dateSearchPhrases('2026-08-05').includes('aug 5'));
  assert.equal(matchesLibraryQuery('aug 5', [], dates), true);
  assert.equal(matchesLibraryQuery('August 5', [], dates), true);
  assert.equal(matchesLibraryQuery('8/5/2026', [], dates), true);
  assert.equal(matchesLibraryQuery('2026-08-05', [], dates), true);
  assert.equal(matchesLibraryQuery('aug 6', [], dates), false);
});

test('search requires every token, so a name plus a date narrows the list', () => {
  const fields = ['Jack Cyganiak 2', 'Delgado Roofing'];
  const dates = ['2026-08-05'];
  assert.equal(matchesLibraryQuery('jack aug', fields, dates), true);
  assert.equal(matchesLibraryQuery('jack sep', fields, dates), false);
});

test('search ignores a missing job record rather than throwing', () => {
  assert.equal(matchesLibraryQuery('jack', [undefined, null, 'Jack Cyganiak'], [null]), true);
  assert.equal(matchesLibraryQuery('hash', [null], []), false);
});

/* ---- labels ---- */

test('labels flatten what the narration saw, and only what it saw', () => {
  const labels = labelsForProof({
    phase: 'after',
    trade: 'Roofing',
    stageKinds: ['anchor', 'scope', 'exclusion', 'wrap'],
    narration: {
      coverage: [
        { stageIndex: 0, label: 'Start outside, facing the front of the building', seen: true },
        { stageIndex: 1, label: 'Walk the area for \u201cStrip north slope to decking\u201d', seen: true },
        { stageIndex: 2, label: 'Pass the excluded area \u2014 \u201cTouch the skylights\u201d', seen: false },
        { stageIndex: 3, label: 'Finish on anything unexpected you found', seen: true },
      ],
    },
  });
  assert.ok(labels.includes('after'));
  assert.ok(labels.includes('roofing'));
  assert.ok(labels.includes('strip north slope to decking'), 'the quoted scope title is the label');
  assert.ok(labels.includes('stage:anchor'));
  assert.ok(labels.includes('stage:wrap'));
  // The unseen exclusion earns nothing: the index says what the footage
  // shows, not what the guide asked for.
  assert.ok(!labels.includes('touch the skylights'));
  assert.ok(!labels.includes('stage:exclusion'));
});

test('labels include action verbs from the vision log', () => {
  const labels = labelsForProof({
    phase: 'after',
    actions: [{ action: 'remove', objectLabel: 'drywall' }],
  });
  assert.ok(labels.includes('after'));
  assert.ok(labels.includes('action:remove'));
  assert.ok(labels.includes('drywall'));
});

/* ---- downloads ---- */

test('the org always mints; outsiders mint only settled or free', () => {
  assert.deepEqual(downloadDecision({ isOrgMember: true, feeCents: 2500, ledgerStatus: null }), {
    action: 'mint',
    reason: 'org_member',
  });
  assert.deepEqual(downloadDecision({ isOrgMember: false, feeCents: 2500, ledgerStatus: 'paid' }), {
    action: 'mint',
    reason: 'paid',
  });
  assert.deepEqual(downloadDecision({ isOrgMember: false, feeCents: 2500, ledgerStatus: 'waived' }), {
    action: 'mint',
    reason: 'waived',
  });
  assert.deepEqual(downloadDecision({ isOrgMember: false, feeCents: 0, ledgerStatus: null }), {
    action: 'mint',
    reason: 'no_fee',
  });
  assert.deepEqual(
    downloadDecision({ isOrgMember: false, feeCents: 2500, ledgerStatus: 'pending_payment' }),
    { action: 'require_payment', feeCents: 2500 },
  );
  assert.deepEqual(downloadDecision({ isOrgMember: false, feeCents: 2500, ledgerStatus: null }), {
    action: 'require_payment',
    feeCents: 2500,
  });
});

/* ---- recipient pinning ---- */

test('a share opens only for the pinned account; a legacy share for any account', () => {
  assert.equal(shareRecipientAllowed('R.Calloway@Alliance.com', 'r.calloway@alliance.com'), true);
  assert.equal(shareRecipientAllowed('r.calloway@alliance.com', 'someone@else.com'), false);
  // No session is never allowed, pin or no pin — the account is the floor.
  assert.equal(shareRecipientAllowed('r.calloway@alliance.com', null), false);
  assert.equal(shareRecipientAllowed(null, null), false);
  // Legacy rows without a pin still require an account, any account.
  assert.equal(shareRecipientAllowed(null, 'anyone@example.com'), true);
});
