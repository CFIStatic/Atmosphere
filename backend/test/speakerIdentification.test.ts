import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { linesFromTranscript, pickupSpeakerNames } from '../src/audio/speakerNamePickup.js';
import { cosineSimilarity, embedPcm, encodePcm16Wav, embedWav, SpeakerEmbeddingError } from '../src/audio/speakerEmbedding.js';
import { bestVoiceMatch, eligibleVoiceprints, matchBand, type VoiceprintCandidate } from '../src/audio/speakerMatch.js';
import { guessSpeakerRoles, parseRoleGuessResponse } from '../src/audio/speakerRoleGuess.js';
import {
  factSpeakerLabel,
  pendingQuestions,
  resolveSpeakerAnswer,
  uiSpeakerLabel,
  verificationQuestion,
  type SpeakerIdentityRow,
} from '../src/audio/speakerVerification.js';
import { VOICE_CONSENT_TEXT, canConfirmEnrollment, canStoreVoiceprint, consentAccepted } from '../src/audio/speakerEnrollment.js';
import { candidatesFromMatchableRpc } from '../src/audio/speakerIdentityStore.js';
import { sanitizeSpeakerProse } from '../src/shared/askSpeakers.js';

function tone(freq: number, seconds = 1.2, rate = 16_000): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    samples[i] =
      0.5 * Math.sin(2 * Math.PI * freq * t) +
      0.25 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.12 * Math.sin(2 * Math.PI * freq * 3 * t);
  }
  return samples;
}

function row(partial: Partial<SpeakerIdentityRow> & Pick<SpeakerIdentityRow, 'id' | 'proofId' | 'speakerLabel'>): SpeakerIdentityRow {
  return {
    jobId: 'job-1',
    displayName: 'Marco',
    status: 'pending',
    method: 'name_pickup',
    confidence: null,
    voiceprintId: null,
    subjectUserId: null,
    sourceProofId: partial.proofId,
    sourceTSec: 42,
    sourceQuote: "I'm Marco",
    clipTitle: 'North slope walkthrough',
    ...partial,
  };
}

const print = (partial: Partial<VoiceprintCandidate>): VoiceprintCandidate => ({
  id: 'vp-1',
  userId: 'user-1',
  orgId: 'org-a',
  displayName: 'Marco Diaz',
  embedding: [1, 0],
  consentText: VOICE_CONSENT_TEXT,
  consentedAt: '2026-09-29T00:00:00Z',
  crossCompanyOptIn: false,
  ...partial,
});

test('name pickup attaches a self-introduction to that speaker and keeps the quote', () => {
  const lines = linesFromTranscript('[0:42] SPEAKER_01: I\'m Marco, from the roof.');
  const names = pickupSpeakerNames(lines);
  assert.equal(names.length, 1);
  assert.equal(names[0]!.speakerLabel, 'Speaker 2');
  assert.equal(names[0]!.name, 'Marco');
  assert.equal(names[0]!.kind, 'self_introduction');
  assert.equal(names[0]!.tSec, 42);
  assert.equal(lines[0]!.text.includes(names[0]!.quote), true);
});

test('hey Marco attaches to the other diarized speaker, not the person who said it', () => {
  const lines = linesFromTranscript('[0:10] Speaker 1: hey Marco\n[0:14] Speaker 2: yeah?');
  const names = pickupSpeakerNames(lines);
  assert.equal(names.length, 1);
  assert.equal(names[0]!.speakerLabel, 'Speaker 2');
  assert.equal(names[0]!.name, 'Marco');
  assert.equal(names[0]!.kind, 'direct_address');
  assert.equal(lines[0]!.text.includes(names[0]!.quote), true);
});

test('a direct address with nobody else to attach is not assigned to the speaker', () => {
  const lines = linesFromTranscript('[0:10] Speaker 1: hey Marco, you around?');
  assert.deepEqual(pickupSpeakerNames(lines), []);
});

test('the same voice sample matches itself and a different tone matches less', () => {
  const a = embedPcm(tone(140), 16_000);
  const again = embedPcm(tone(140), 16_000);
  const b = embedPcm(tone(320), 16_000);
  assert.ok(cosineSimilarity(a, again) > 0.99);
  assert.ok(cosineSimilarity(a, b) < cosineSimilarity(a, again));
  const wav = encodePcm16Wav(tone(180), 16_000);
  const round = embedWav(wav);
  assert.equal(round.length, a.length);
});

test('silence is not a voiceprint', () => {
  assert.throws(() => embedPcm(new Float32Array(16_000), 16_000), SpeakerEmbeddingError);
});

test('cross-company matching ignores people who did not opt in', () => {
  const prints = [
    print({ id: 'same', orgId: 'org-a', crossCompanyOptIn: false }),
    print({ id: 'out', orgId: 'org-b', userId: 'user-2', crossCompanyOptIn: false }),
    print({ id: 'opt', orgId: 'org-b', userId: 'user-3', crossCompanyOptIn: true, embedding: [0, 1] }),
    print({ id: 'bare', orgId: 'org-a', userId: 'user-4', consentText: null, consentedAt: null, crossCompanyOptIn: true }),
  ];
  const eligible = eligibleVoiceprints(prints, 'org-a').map((row) => row.id);
  assert.deepEqual(eligible.sort(), ['opt', 'same']);
  const high = bestVoiceMatch([1, 0], prints, 'org-a', { high: 0.85, medium: 0.72 });
  assert.equal(high?.voiceprintId, 'same');
  assert.equal(high?.band, 'high');
  const medium = bestVoiceMatch([0.8, 0.6], [print({ embedding: [1, 0], id: 'near' })], 'org-a', { high: 0.99, medium: 0.7 });
  assert.equal(matchBand(medium?.score ?? 0, { high: 0.99, medium: 0.7 }), medium?.band);
  assert.equal(bestVoiceMatch([1, 0], [print({ consentText: '   ', consentedAt: '2026-09-29T00:00:00Z' })], 'org-a'), null);
});

test('the matchable query result is filtered again before a score is used', () => {
  const rows = candidatesFromMatchableRpc(
    [
      { voiceprint_id: 'a', user_id: 'u', org_id: 'org-a', full_name: 'Alex', embedding: [1, 0], cross_company_opt_in: false },
      { voiceprint_id: 'b', user_id: 'v', org_id: 'org-b', full_name: 'Blair', embedding: [0, 1], cross_company_opt_in: false },
    ],
    'org-a',
  );
  assert.deepEqual(rows.map((row) => row.id), ['a']);
});

test('a confirmed name applies across clips that picked up the same name', () => {
  const identities = [
    row({ id: 'a', proofId: 'clip-1', speakerLabel: 'Speaker 2' }),
    row({ id: 'b', proofId: 'clip-2', speakerLabel: 'Speaker 1', displayName: 'Marco' }),
    row({ id: 'c', proofId: 'clip-3', speakerLabel: 'Speaker 4', displayName: 'Priya' }),
  ];
  const next = resolveSpeakerAnswer(identities, { id: 'a', answer: 'yes' });
  assert.equal(next.find((item) => item.id === 'a')?.status, 'confirmed');
  assert.equal(next.find((item) => item.id === 'b')?.status, 'confirmed');
  assert.equal(next.find((item) => item.id === 'b')?.displayName, 'Marco');
  assert.equal(next.find((item) => item.id === 'c')?.status, 'pending');
  const no = resolveSpeakerAnswer(identities, { id: 'a', answer: 'no' });
  assert.equal(no.find((item) => item.id === 'a')?.status, 'rejected');
  assert.equal(no.find((item) => item.id === 'b')?.status, 'pending');
});

test('someone else stores the typed name on that speaker', () => {
  const identities = [row({ id: 'a', proofId: 'clip-1', speakerLabel: 'Speaker 2' })];
  const next = resolveSpeakerAnswer(identities, { id: 'a', answer: 'other', displayName: 'Elena Vargas' });
  assert.equal(next[0]!.status, 'confirmed');
  assert.equal(next[0]!.displayName, 'Elena Vargas');
  assert.equal(next[0]!.method, 'user');
});

test('Ask asks the pending name with the clip and timestamp', () => {
  const identities = [row({ id: 'a', proofId: 'clip-1', speakerLabel: 'Speaker 2', sourceTSec: 42 })];
  const [question] = pendingQuestions(identities);
  assert.equal(question!.question, 'Is Speaker 2 in North slope walkthrough at 0:42 Marco?');
  assert.equal(
    verificationQuestion({ speakerLabel: 'Speaker 2', clipTitle: 'North slope walkthrough', tSec: 42, candidateName: 'Marco' }),
    'Is Speaker 2 in North slope walkthrough at 0:42 Marco?',
  );
});

test('a role guess is labeled as a guess and is not a fact', async () => {
  const lines = linesFromTranscript('[1:05] Speaker 3: The deductible on my house is still open.');
  const guesses = await guessSpeakerRoles(lines, [], null);
  assert.equal(guesses[0]?.role, 'homeowner');
  assert.equal(lines[0]!.text.includes(guesses[0]!.quote), true);
  assert.equal(guesses[0]?.source, 'transcript');
  const ui = uiSpeakerLabel({ speakerLabel: 'Speaker 3', role: 'homeowner', roleStatus: 'tentative' });
  assert.equal(ui, 'Speaker 3 (likely homeowner)');
  assert.equal(ui.split('(').length, ui.split(')').length);
  assert.equal(factSpeakerLabel({ speakerLabel: 'Speaker 3' }), 'Speaker 3');
  assert.equal(factSpeakerLabel({ speakerLabel: 'Speaker 3', confirmedName: 'Marco' }), 'Marco');
  const prose = sanitizeSpeakerProse('Speaker 3 (likely homeowner) said the deductible is open.');
  assert.equal(prose.includes('likely'), false);
  assert.equal(prose.includes('Speaker 3'), true);
  const parsed = parseRoleGuessResponse(
    '{"guesses":[{"speaker":"Speaker 3","role":"crew","confidence":0.4,"quote":"not in the transcript","name":"Marco"}]}',
    lines,
  );
  assert.deepEqual(parsed, []);
});

test('a coworker cannot store a voiceprint until they confirm as themselves', () => {
  assert.equal(canStoreVoiceprint('alex', 'marco'), false);
  assert.equal(canStoreVoiceprint('marco', 'marco'), true);
  assert.equal(
    canConfirmEnrollment('alex', { id: 'r', requesterUserId: 'alex', subjectUserId: 'marco', status: 'pending' }),
    false,
  );
  assert.equal(
    canConfirmEnrollment('marco', { id: 'r', requesterUserId: 'alex', subjectUserId: 'marco', status: 'pending' }),
    true,
  );
  assert.equal(consentAccepted(VOICE_CONSENT_TEXT, true), true);
  assert.equal(consentAccepted('I agree', true), false);
  assert.equal(consentAccepted(VOICE_CONSENT_TEXT, false), false);
});

test('speaker identity routes require a session', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const voice = await fetch(`http://127.0.0.1:${address.port}/api/speaker-identity/voiceprint`);
    assert.equal(voice.status, 401);
    const team = await fetch(`http://127.0.0.1:${address.port}/api/speaker-identity/team`);
    assert.equal(team.status, 401);
    const ask = await fetch(`http://127.0.0.1:${address.port}/api/speaker-identity/jobs/job-1/verifications`);
    assert.equal(ask.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
