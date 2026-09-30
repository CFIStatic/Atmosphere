/**
 * Voice enrollment and speaker verification.
 *
 * Enrollment always stores the caller's own voiceprint. A coworker request
 * stays pending until that person confirms from their account. Embeddings are
 * not returned to the client. Matching uses the service role and the consent
 * filter in speakerMatch.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { createUserClient } from '../lib/supabase.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import {
  VOICE_CONSENT_TEXT,
  canConfirmEnrollment,
  canStoreVoiceprint,
  consentAccepted,
} from '../audio/speakerEnrollment.js';
import { SPEAKER_EMBEDDING_MODEL, decodeWavPcm, embedPcm, SpeakerEmbeddingError } from '../audio/speakerEmbedding.js';
import { stampConfirmedSpeakers } from '../audio/speakerClipApply.js';
import { requireCompanyClip, requireCompanyClips, requireCompanyJob } from '../audio/speakerAccess.js';
import {
  factSpeakerLabel,
  pendingQuestions,
  resolveRoleAnswer,
  resolveSpeakerAnswer,
  uiSpeakerLabel,
  type RoleGuessRow,
  type SpeakerIdentityRow,
} from '../audio/speakerVerification.js';
import { SPEAKER_ROLES, type SpeakerRole } from '../audio/speakerRoleGuess.js';

export const speakerIdentityRouter = Router();
speakerIdentityRouter.use(requireAuth, requireOrg);

const wavSchema = z.object({
  consentText: z.string().min(20).max(4000),
  consented: z.literal(true),
  wavBase64: z.string().min(100).max(1_500_000),
  crossCompanyOptIn: z.boolean().optional(),
});

const optInSchema = z.object({ crossCompanyOptIn: z.boolean() });
const requestSchema = z.object({ subjectUserId: z.string().uuid() });
const answerSchema = z.object({
  answer: z.enum(['yes', 'no', 'other']),
  displayName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(SPEAKER_ROLES).optional(),
});
const renameSchema = z.object({
  speakerLabel: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  role: z.enum(SPEAKER_ROLES).nullable().optional(),
});

function userClient(req: Request) {
  return createUserClient(req.accessToken!);
}

function wavBytes(wavBase64: string): Uint8Array {
  const bytes = Buffer.from(wavBase64, 'base64');
  if (bytes.length < 1000 || bytes.length > 800_000) {
    throw badRequest('Record between one and twenty seconds.', 'voice_sample_size');
  }
  return bytes;
}

function embedOrReject(bytes: Uint8Array): { embedding: number[]; durationSeconds: number } {
  try {
    const { sampleRate, samples } = decodeWavPcm(bytes);
    return {
      embedding: embedPcm(samples, sampleRate),
      durationSeconds: Math.round((samples.length / sampleRate) * 100) / 100,
    };
  } catch (err) {
    if (err instanceof SpeakerEmbeddingError) throw badRequest(err.message, err.code);
    throw err;
  }
}

async function writeVoiceprint(
  supabase: ReturnType<typeof userClient>,
  input: { userId: string; orgId: string; consentText: string; crossCompanyOptIn: boolean; embedding: number[]; durationSeconds: number },
) {
  if (!canStoreVoiceprint(input.userId, input.userId)) {
    throw badRequest('A coworker has to confirm enrollment from their own account.', 'coworker_must_confirm');
  }
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from('voiceprints').select('id').eq('user_id', input.userId).maybeSingle();
  const row = {
    user_id: input.userId,
    org_id: input.orgId,
    consent_text: input.consentText,
    consented_at: now,
    cross_company_opt_in: input.crossCompanyOptIn,
    duration_seconds: input.durationSeconds,
    embedding_model: SPEAKER_EMBEDDING_MODEL,
    updated_at: now,
  };
  const saved = existing?.id
    ? await supabase.from('voiceprints').update(row).eq('id', existing.id).select('id, consented_at, cross_company_opt_in').single()
    : await supabase.from('voiceprints').insert(row).select('id, consented_at, cross_company_opt_in').single();
  if (saved.error || !saved.data) throw new HttpError(500, saved.error?.message ?? 'Could not store the voiceprint.', 'voiceprint_failed');
  const embedding = await supabase.from('voiceprint_embeddings').upsert(
    { voiceprint_id: saved.data.id, embedding: input.embedding, dimension: input.embedding.length },
    { onConflict: 'voiceprint_id' },
  );
  if (embedding.error) throw new HttpError(500, embedding.error.message, 'voiceprint_failed');
  await supabase.from('voice_consent_events').insert({
    user_id: input.userId,
    org_id: input.orgId,
    action: 'granted',
    consent_text: input.consentText,
  });
  return saved.data;
}

speakerIdentityRouter.get('/consent-text', (_req, res) => {
  res.json({ consentText: VOICE_CONSENT_TEXT });
});

speakerIdentityRouter.get('/voiceprint', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const userId = req.user!.id;
    const [{ data: print }, { data: requests }] = await Promise.all([
      supabase
        .from('voiceprints')
        .select('id, consented_at, cross_company_opt_in, consent_text, duration_seconds')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('voice_enrollment_requests')
        .select('id, requester_user_id, subject_user_id, status, created_at')
        .eq('subject_user_id', userId)
        .eq('status', 'pending'),
    ]);
    res.json({
      consentText: VOICE_CONSENT_TEXT,
      voiceprint: print
        ? {
            enrolled: true,
            consentedAt: print.consented_at,
            crossCompanyOptIn: Boolean(print.cross_company_opt_in),
            durationSeconds: print.duration_seconds,
          }
        : { enrolled: false, consentedAt: null, crossCompanyOptIn: false, durationSeconds: null },
      pendingRequests: requests ?? [],
    });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/voiceprint', async (req, res, next) => {
  try {
    const body = wavSchema.parse(req.body);
    if (!consentAccepted(body.consentText, body.consented)) {
      throw badRequest('Consent to the voiceprint wording before enrolling.', 'consent_required');
    }
    const sample = embedOrReject(wavBytes(body.wavBase64));
    const supabase = userClient(req);
    const saved = await writeVoiceprint(supabase, {
      userId: req.user!.id,
      orgId: req.orgId!,
      consentText: body.consentText.trim(),
      crossCompanyOptIn: body.crossCompanyOptIn === true,
      embedding: sample.embedding,
      durationSeconds: sample.durationSeconds,
    });
    res.status(201).json({
      voiceprint: { enrolled: true, consentedAt: saved.consented_at, crossCompanyOptIn: Boolean(saved.cross_company_opt_in) },
    });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.patch('/voiceprint', async (req, res, next) => {
  try {
    const body = optInSchema.parse(req.body);
    const supabase = userClient(req);
    const { data, error } = await supabase
      .from('voiceprints')
      .update({ cross_company_opt_in: body.crossCompanyOptIn, updated_at: new Date().toISOString() })
      .eq('user_id', req.user!.id)
      .select('consented_at, cross_company_opt_in')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'voiceprint_failed');
    if (!data) throw notFound('Enroll a voiceprint before changing this setting.', 'voiceprint_missing');
    res.json({ voiceprint: { enrolled: true, consentedAt: data.consented_at, crossCompanyOptIn: Boolean(data.cross_company_opt_in) } });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.delete('/voiceprint', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const userId = req.user!.id;
    const { data: existing } = await supabase.from('voiceprints').select('id').eq('user_id', userId).maybeSingle();
    const { error } = await supabase.from('voiceprints').delete().eq('user_id', userId);
    if (error) throw new HttpError(500, error.message, 'voiceprint_failed');
    await supabase.from('voice_consent_events').insert({
      user_id: userId,
      org_id: req.orgId!,
      action: 'revoked',
      consent_text: null,
    });
    const admin = createAdminClient();
    if (admin && existing?.id) {
      await admin
        .from('speaker_identities')
        .update({ status: 'rejected', voiceprint_id: null })
        .eq('voiceprint_id', existing.id)
        .eq('status', 'pending');
    }
    res.json({ voiceprint: { enrolled: false, consentedAt: null, crossCompanyOptIn: false } });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.get('/team', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const orgId = req.orgId!;
    const { data: members, error } = await supabase
      .from('org_members')
      .select('user_id, profiles(full_name, email)')
      .eq('org_id', orgId);
    if (error) throw new HttpError(500, error.message, 'team_failed');
    const [{ data: prints }, { data: requests }, { data: events }] = await Promise.all([
      supabase.from('voiceprints').select('user_id, consented_at, cross_company_opt_in').eq('org_id', orgId),
      supabase.from('voice_enrollment_requests').select('id, subject_user_id, requester_user_id, status').eq('org_id', orgId).eq('status', 'pending'),
      supabase.from('voice_consent_events').select('user_id, action, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(500),
    ]);
    const printByUser = new Map((prints ?? []).map((row) => [row.user_id, row]));
    const pendingByUser = new Map((requests ?? []).map((row) => [row.subject_user_id, row]));
    const latestEvent = new Map<string, { action: string; created_at: string }>();
    for (const event of events ?? []) {
      if (!latestEvent.has(event.user_id)) latestEvent.set(event.user_id, event);
    }
    const people = (members ?? []).map((member) => {
      const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
      const print = printByUser.get(member.user_id);
      const pending = pendingByUser.get(member.user_id);
      const event = latestEvent.get(member.user_id);
      const consentStatus = print ? 'enrolled' : pending ? 'pending' : event?.action === 'revoked' ? 'revoked' : 'none';
      return {
        userId: member.user_id,
        fullName: profile?.full_name ?? null,
        email: profile?.email ?? null,
        consentStatus,
        consentedAt: print?.consented_at ?? null,
        crossCompanyOptIn: Boolean(print?.cross_company_opt_in),
        pendingRequestId: pending?.id ?? null,
      };
    });
    res.json({ people });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/enrollment-requests', async (req, res, next) => {
  try {
    const body = requestSchema.parse(req.body);
    if (body.subjectUserId === req.user!.id) {
      throw badRequest('Enroll your own voice from this account.', 'self_enroll');
    }
    const supabase = userClient(req);
    const { data: member } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', req.orgId!)
      .eq('user_id', body.subjectUserId)
      .maybeSingle();
    if (!member) throw notFound('That person is not in this company.', 'not_in_org');
    const { data, error } = await supabase
      .from('voice_enrollment_requests')
      .insert({
        org_id: req.orgId!,
        requester_user_id: req.user!.id,
        subject_user_id: body.subjectUserId,
        status: 'pending',
      })
      .select('id, status, subject_user_id')
      .single();
    if (error) throw new HttpError(409, 'That person already has a pending enrollment request.', 'enrollment_pending');
    res.status(201).json({ request: data });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/enrollment-requests/:id/confirm', async (req, res, next) => {
  try {
    const body = wavSchema.parse(req.body);
    if (!consentAccepted(body.consentText, body.consented)) {
      throw badRequest('Consent to the voiceprint wording before enrolling.', 'consent_required');
    }
    const supabase = userClient(req);
    const { data: request } = await supabase
      .from('voice_enrollment_requests')
      .select('id, requester_user_id, subject_user_id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!request) throw notFound('Enrollment request not found.', 'enrollment_missing');
    if (!canConfirmEnrollment(req.user!.id, {
      id: request.id,
      requesterUserId: request.requester_user_id,
      subjectUserId: request.subject_user_id,
      status: request.status,
    })) {
      throw badRequest('A coworker has to confirm enrollment from their own account.', 'coworker_must_confirm');
    }
    const sample = embedOrReject(wavBytes(body.wavBase64));
    await writeVoiceprint(supabase, {
      userId: req.user!.id,
      orgId: req.orgId!,
      consentText: body.consentText.trim(),
      crossCompanyOptIn: body.crossCompanyOptIn === true,
      embedding: sample.embedding,
      durationSeconds: sample.durationSeconds,
    });
    await supabase
      .from('voice_enrollment_requests')
      .update({ status: 'confirmed', resolved_at: new Date().toISOString() })
      .eq('id', request.id);
    res.json({ request: { id: request.id, status: 'confirmed' } });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/enrollment-requests/:id/decline', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const { data, error } = await supabase
      .from('voice_enrollment_requests')
      .update({ status: 'declined', resolved_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('subject_user_id', req.user!.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'enrollment_failed');
    if (!data) throw notFound('Enrollment request not found.', 'enrollment_missing');
    res.json({ request: { id: data.id, status: 'declined' } });
  } catch (err) {
    next(err);
  }
});

function mapIdentity(row: Record<string, unknown>): SpeakerIdentityRow {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    proofId: String(row.proof_id),
    speakerLabel: String(row.speaker_label),
    displayName: row.display_name == null ? null : String(row.display_name),
    status: row.status as SpeakerIdentityRow['status'],
    method: row.method as SpeakerIdentityRow['method'],
    confidence: row.confidence == null ? null : Number(row.confidence),
    voiceprintId: row.voiceprint_id == null ? null : String(row.voiceprint_id),
    subjectUserId: row.subject_user_id == null ? null : String(row.subject_user_id),
    sourceProofId: row.source_proof_id == null ? null : String(row.source_proof_id),
    sourceTSec: row.source_t_sec == null ? null : Number(row.source_t_sec),
    sourceQuote: row.source_quote == null ? null : String(row.source_quote),
    clipTitle: row.clip_title == null ? null : String(row.clip_title),
  };
}

function mapGuess(row: Record<string, unknown>): RoleGuessRow {
  return {
    id: String(row.id),
    proofId: String(row.proof_id),
    speakerLabel: String(row.speaker_label),
    role: row.role as RoleGuessRow['role'],
    confidence: Number(row.confidence),
    tSec: row.source_t_sec == null ? null : Number(row.source_t_sec),
    quote: String(row.source_quote ?? ''),
    clipTitle: row.clip_title == null ? null : String(row.clip_title),
    status: row.status as RoleGuessRow['status'],
  };
}

const IDENTITY_COLUMNS =
  'id, job_id, proof_id, speaker_label, display_name, status, method, confidence, voiceprint_id, subject_user_id, source_proof_id, source_t_sec, source_quote, clip_title';

async function loadJobSpeakers(supabase: ReturnType<typeof userClient>, orgId: string, jobId: string) {
  const [{ data: identities, error: identityError }, { data: guesses, error: guessError }] = await Promise.all([
    supabase.from('speaker_identities').select(IDENTITY_COLUMNS).eq('job_id', jobId).eq('org_id', orgId),
    supabase.from('speaker_role_guesses').select('id, proof_id, speaker_label, role, confidence, source_t_sec, source_quote, clip_title, status, job_id').eq('job_id', jobId).eq('org_id', orgId),
  ]);
  if (identityError) throw new HttpError(500, identityError.message, 'speakers_failed');
  if (guessError) throw new HttpError(500, guessError.message, 'speakers_failed');
  return {
    identities: (identities ?? []).map(mapIdentity),
    guesses: (guesses ?? []).map(mapGuess),
  };
}

async function publishConfirmedNames(orgId: string, rows: SpeakerIdentityRow[]) {
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await stampConfirmedSpeakers(admin, orgId, rows);
  } catch (err) {
    console.warn('[speaker-identity] name stamp failed:', err instanceof Error ? err.message : err);
  }
}

async function saveIdentities(supabase: ReturnType<typeof userClient>, rows: SpeakerIdentityRow[]) {
  for (const row of rows) {
    const { error } = await supabase
      .from('speaker_identities')
      .update({
        display_name: row.displayName,
        status: row.status,
        method: row.method,
        confidence: row.confidence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) throw new HttpError(500, error.message, 'speakers_failed');
  }
}

speakerIdentityRouter.get('/jobs/:jobId/verifications', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const orgId = req.orgId!;
    const jobId = req.params.jobId;
    await requireCompanyJob(supabase, orgId, jobId);
    const { identities, guesses } = await loadJobSpeakers(supabase, orgId, jobId);
    res.json({ verifications: pendingQuestions(identities, guesses) });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/jobs/:jobId/verifications/:id', async (req, res, next) => {
  try {
    const body = answerSchema.parse(req.body);
    if (body.answer === 'other' && !body.displayName?.trim() && !body.role) {
      throw badRequest('Say who it is, or pick a role.', 'speaker_name_required');
    }
    const supabase = userClient(req);
    const orgId = req.orgId!;
    const jobId = req.params.jobId;
    await requireCompanyJob(supabase, orgId, jobId);
    const { identities, guesses } = await loadJobSpeakers(supabase, orgId, jobId);
    const identity = identities.find((row) => row.id === req.params.id);
    if (identity) {
      const roleOnly = body.answer === 'other' && Boolean(body.role) && !body.displayName?.trim();
      const nextRows = resolveSpeakerAnswer(identities, {
        id: identity.id,
        answer: roleOnly ? 'no' : body.answer,
        displayName: body.displayName,
      });
      const nextGuesses = roleOnly
        ? resolveRoleAnswer(guesses, {
            speakerLabel: identity.speakerLabel,
            proofId: identity.proofId,
            answer: 'other',
            role: body.role,
          })
        : guesses;
      await requireCompanyClips(supabase, orgId, jobId, [
        ...nextRows.map((row) => row.proofId),
        ...nextGuesses.map((row) => row.proofId),
      ]);
      if (roleOnly) await saveGuesses(supabase, nextGuesses);
      await saveIdentities(supabase, nextRows);
      await publishConfirmedNames(orgId, nextRows);
      res.json({ verifications: pendingQuestions(nextRows, nextGuesses) });
      return;
    }
    const guess = guesses.find((row) => row.id === req.params.id);
    if (!guess) throw notFound('That question is no longer open.', 'verification_missing');
    await requireCompanyClips(supabase, orgId, jobId, guesses.map((row) => row.proofId));
    if (body.answer === 'other' && body.displayName?.trim()) {
      const created = await supabase
        .from('speaker_identities')
        .insert({
          org_id: orgId,
          job_id: jobId,
          proof_id: guess.proofId,
          speaker_label: guess.speakerLabel,
          display_name: body.displayName.trim(),
          status: 'confirmed',
          method: 'user',
          confidence: 1,
          source_proof_id: guess.proofId,
          source_t_sec: guess.tSec,
          source_quote: guess.quote,
          clip_title: guess.clipTitle,
        })
        .select(IDENTITY_COLUMNS)
        .single();
      if (created.error) throw new HttpError(500, created.error.message, 'speakers_failed');
      const nextGuesses = resolveRoleAnswer(guesses, {
        speakerLabel: guess.speakerLabel,
        proofId: guess.proofId,
        answer: 'no',
      });
      await saveGuesses(supabase, nextGuesses);
      const named = mapIdentity(created.data as Record<string, unknown>);
      await publishConfirmedNames(orgId, [named]);
      res.json({ verifications: pendingQuestions([...identities, named], nextGuesses) });
      return;
    }
    const nextGuesses = resolveRoleAnswer(guesses, {
      speakerLabel: guess.speakerLabel,
      proofId: guess.proofId,
      answer: body.answer,
      role: body.role ?? null,
    });
    await saveGuesses(supabase, nextGuesses);
    res.json({ verifications: pendingQuestions(identities, nextGuesses) });
  } catch (err) {
    next(err);
  }
});

async function saveGuesses(supabase: ReturnType<typeof userClient>, rows: RoleGuessRow[]) {
  for (const row of rows) {
    const { error } = await supabase
      .from('speaker_role_guesses')
      .update({ role: row.role, status: row.status, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw new HttpError(500, error.message, 'speakers_failed');
  }
}

speakerIdentityRouter.get('/jobs/:jobId/clips/:proofId/speakers', async (req, res, next) => {
  try {
    const supabase = userClient(req);
    const orgId = req.orgId!;
    const jobId = req.params.jobId;
    await requireCompanyClip(supabase, orgId, jobId, req.params.proofId);
    const { identities, guesses } = await loadJobSpeakers(supabase, orgId, jobId);
    const proofId = req.params.proofId;
    const labels = new Set<string>();
    for (const row of identities) if (row.proofId === proofId) labels.add(row.speakerLabel);
    for (const row of guesses) if (row.proofId === proofId) labels.add(row.speakerLabel);
    const speakers = [...labels].map((label) => {
      const identity = identities.find(
        (row) => row.proofId === proofId && row.speakerLabel === label && (row.status === 'confirmed' || row.method === 'voice_high'),
      );
      const guess = guesses.find((row) => row.proofId === proofId && row.speakerLabel === label && row.status !== 'dismissed');
      const confirmedName = identity?.displayName ?? null;
      return {
        speakerLabel: label,
        confirmedName,
        role: guess?.role ?? null,
        roleStatus: guess?.status ?? null,
        roleConfidence: guess?.confidence ?? null,
        quote: guess?.quote ?? identity?.sourceQuote ?? null,
        tSec: guess?.tSec ?? identity?.sourceTSec ?? null,
        uiLabel: uiSpeakerLabel({
          speakerLabel: label,
          confirmedName,
          role: confirmedName ? null : guess?.role,
          roleStatus: guess?.status,
        }),
        factLabel: factSpeakerLabel({ speakerLabel: label, confirmedName }),
      };
    });
    res.json({ speakers });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.post('/jobs/:jobId/clips/:proofId/speakers', async (req, res, next) => {
  try {
    const body = renameSchema.parse(req.body);
    const supabase = userClient(req);
    const orgId = req.orgId!;
    const jobId = req.params.jobId;
    const proofId = req.params.proofId;
    await requireCompanyClip(supabase, orgId, jobId, proofId);
    if (body.displayName) {
      const { identities } = await loadJobSpeakers(supabase, orgId, jobId);
      const pending = identities.find(
        (row) => row.proofId === proofId && row.speakerLabel.toLowerCase() === body.speakerLabel.toLowerCase() && row.status === 'pending',
      );
      if (pending) {
        const nextRows = resolveSpeakerAnswer(identities, { id: pending.id, answer: 'other', displayName: body.displayName });
        await requireCompanyClips(supabase, orgId, jobId, nextRows.map((row) => row.proofId));
        await saveIdentities(supabase, nextRows);
        await publishConfirmedNames(orgId, nextRows);
      } else {
        const { error } = await supabase.from('speaker_identities').insert({
          org_id: orgId,
          job_id: jobId,
          proof_id: proofId,
          speaker_label: body.speakerLabel,
          display_name: body.displayName,
          status: 'confirmed',
          method: 'user',
          confidence: 1,
          source_proof_id: proofId,
          clip_title: null,
        });
        if (error) throw new HttpError(500, error.message, 'speakers_failed');
        await publishConfirmedNames(orgId, [
        {
          id: '',
          jobId,
          proofId,
          speakerLabel: body.speakerLabel,
          displayName: body.displayName,
          status: 'confirmed',
          method: 'user',
          confidence: 1,
          voiceprintId: null,
          subjectUserId: req.user!.id,
          sourceProofId: proofId,
          sourceTSec: null,
          sourceQuote: null,
          clipTitle: null,
        },
        ]);
      }
    }
    if (body.role) {
      const { error } = await supabase.from('speaker_role_guesses').upsert(
        {
          org_id: orgId,
          job_id: jobId,
          proof_id: proofId,
          speaker_label: body.speakerLabel,
          role: body.role as SpeakerRole,
          confidence: 1,
          source_quote: 'Corrected by the office.',
          status: 'corrected',
        },
        { onConflict: 'proof_id,speaker_label' },
      );
      if (error) throw new HttpError(500, error.message, 'speakers_failed');
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
