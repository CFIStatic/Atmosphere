/**
 * Voice recognition privacy and speaker verification.
 *
 * Voiceprints are learned automatically from job clips (audio/voiceprintLearn)
 * for people with a recorded voiceprint consent. There is no manual sample.
 * The account can turn recognition off (deletes the voiceprint) and opt into
 * cross-company matching. Embeddings are never returned to the client.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { createUserClient } from '../lib/supabase.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import {
  loadVoiceConsent,
  recordVoiceConsent,
  revokeVoiceConsent,
  type VoiceConsentStatus,
} from '../legal/voiceConsent.js';
import { clientIp, clientUserAgent } from '../legal/terms.js';
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

const voiceConsentSchema = z.object({ consented: z.literal(true) });

const optInSchema = z.object({ crossCompanyOptIn: z.boolean() });
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

/** Writes go through the service role. Authenticated clients have no insert or update grant. */
function writerOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Speaker storage is unavailable.', 'speaker_storage_unavailable');
  return admin;
}

type Db = ReturnType<typeof userClient>;

function identityUnchanged(prev: SpeakerIdentityRow, next: SpeakerIdentityRow): boolean {
  return (
    prev.displayName === next.displayName &&
    prev.status === next.status &&
    prev.method === next.method &&
    prev.confidence === next.confidence &&
    prev.proofId === next.proofId
  );
}

function guessUnchanged(prev: RoleGuessRow, next: RoleGuessRow): boolean {
  return prev.role === next.role && prev.status === next.status && prev.proofId === next.proofId;
}

/** Ownership for clips this answer changes. A soft-deleted clip in this company is not clip_missing. */
async function requireChangedClips(user: Db, orgId: string, jobId: string, proofIds: string[]): Promise<void> {
  const admin = createAdminClient() ?? user;
  await requireCompanyClips(admin, orgId, jobId, proofIds, { skipDeleted: true });
}

function privacyState(
  print: { consented_at?: string | null; cross_company_opt_in?: boolean | null; duration_seconds?: number | null } | null,
  consent: VoiceConsentStatus,
) {
  return {
    enabled: consent.consented,
    consentedAt: consent.consentedAt,
    learned: Boolean(print),
    crossCompanyOptIn: Boolean(print?.cross_company_opt_in),
  };
}

/** Account privacy: is voice recognition on, has a voice been learned yet, cross-company opt-in. */
speakerIdentityRouter.get('/voiceprint', async (req, res, next) => {
  try {
    const admin = writerOrThrow();
    const userId = req.user!.id;
    const [{ data: print }, consent] = await Promise.all([
      admin.from('voiceprints').select('consented_at, cross_company_opt_in, duration_seconds').eq('user_id', userId).maybeSingle(),
      loadVoiceConsent(admin, userId),
    ]);
    res.json({ voice: privacyState(print ?? null, consent) });
  } catch (err) {
    next(err);
  }
});

/** Turn voice recognition back on. Same clickwrap record as the Terms checkbox. */
speakerIdentityRouter.post('/voice-consent', async (req, res, next) => {
  try {
    voiceConsentSchema.parse(req.body);
    const admin = writerOrThrow();
    const consent = await recordVoiceConsent(admin, {
      userId: req.user!.id,
      orgId: req.orgId!,
      ip: clientIp(req),
      userAgent: clientUserAgent(req),
    });
    res.status(201).json({ voice: privacyState(null, consent) });
  } catch (err) {
    next(err);
  }
});

speakerIdentityRouter.patch('/voiceprint', async (req, res, next) => {
  try {
    const body = optInSchema.parse(req.body);
    const admin = writerOrThrow();
    const consent = await loadVoiceConsent(admin, req.user!.id);
    if (!consent.consented) throw badRequest('Turn on voice recognition first.', 'voice_consent_required');
    const { data, error } = await admin
      .from('voiceprints')
      .update({ cross_company_opt_in: body.crossCompanyOptIn, updated_at: new Date().toISOString() })
      .eq('user_id', req.user!.id)
      .select('consented_at, cross_company_opt_in, duration_seconds')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'voiceprint_failed');
    if (!data) throw notFound('Your voice has not been learned yet. Try again after your next job clip.', 'voiceprint_missing');
    res.json({ voice: privacyState(data, consent) });
  } catch (err) {
    next(err);
  }
});

/** Turn voice recognition off: deletes the voiceprint and the consent record. */
speakerIdentityRouter.delete('/voiceprint', async (req, res, next) => {
  try {
    await revokeVoiceConsent(writerOrThrow(), { userId: req.user!.id, orgId: req.orgId! });
    res.json({ voice: { enabled: false, consentedAt: null, learned: false, crossCompanyOptIn: false } });
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
  // A newly confirmed name can teach that person's voiceprint (consent checked inside).
  const proofIds = [...new Set(rows.filter((row) => row.status === 'confirmed' || row.method === 'voice_high').map((row) => row.proofId))];
  if (proofIds.length) {
    void (async () => {
      const { learnVoiceprintsFromClip } = await import('../audio/voiceprintLearn.js');
      for (const proofId of proofIds.slice(0, 5)) await learnVoiceprintsFromClip(admin, proofId);
    })().catch((err) => console.warn('[voiceprint-learn] failed:', err instanceof Error ? err.message : err));
  }
}

export function identityRewritten(prior: SpeakerIdentityRow, next: SpeakerIdentityRow): boolean {
  return !identityUnchanged(prior, next);
}

export function guessRewritten(prior: RoleGuessRow, next: RoleGuessRow): boolean {
  return !guessUnchanged(prior, next);
}

/**
 * Proof ids an answer rewrites. Untouched speaker rows are left alone, including
 * rows whose clip was soft-deleted. job_proofs RLS hides those clips from
 * everyone except the deleter, so the ownership check must not load them.
 */
export function rewrittenProofIds<T extends { proofId: string }>(
  before: readonly T[],
  after: readonly T[],
  rewritten: (prior: T, next: T) => boolean,
): string[] {
  if (before === after) return [];
  const ids: string[] = [];
  for (let i = 0; i < after.length; i += 1) {
    const prior = before[i];
    const next = after[i];
    if (next && (!prior || rewritten(prior, next))) ids.push(next.proofId);
  }
  return ids;
}

async function saveIdentities(db: Db, orgId: string, rows: SpeakerIdentityRow[]) {
  for (const row of rows) {
    const { error } = await db
      .from('speaker_identities')
      .update({
        display_name: row.displayName,
        status: row.status,
        method: row.method,
        confidence: row.confidence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('org_id', orgId);
    if (error) throw new HttpError(500, error.message, 'speakers_failed');
  }
}

function rowsChanged<T extends { id: string }>(before: T[], after: T[], unchanged: (prev: T, next: T) => boolean): T[] {
  const prior = new Map(before.map((row) => [row.id, row]));
  return after.filter((row) => {
    const prev = prior.get(row.id);
    return !prev || !unchanged(prev, row);
  });
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
      const identityWrites = rowsChanged(identities, nextRows, identityUnchanged);
      const guessWrites = roleOnly ? rowsChanged(guesses, nextGuesses, guessUnchanged) : [];
      await requireChangedClips(supabase, orgId, jobId, [
        ...rewrittenProofIds(identities, nextRows, identityRewritten),
        ...rewrittenProofIds(guesses, nextGuesses, guessRewritten),
        ...identityWrites.map((row) => row.proofId),
        ...guessWrites.map((row) => row.proofId),
      ]);
      if (identityWrites.length || guessWrites.length) {
        const admin = writerOrThrow();
        if (guessWrites.length) await saveGuesses(admin, orgId, guessWrites);
        if (identityWrites.length) await saveIdentities(admin, orgId, identityWrites);
      }
      await publishConfirmedNames(orgId, nextRows);
      res.json({ verifications: pendingQuestions(nextRows, nextGuesses) });
      return;
    }
    const guess = guesses.find((row) => row.id === req.params.id);
    if (!guess) throw notFound('That question is no longer open.', 'verification_missing');
    if (body.answer === 'other' && body.displayName?.trim()) {
      const nextGuesses = resolveRoleAnswer(guesses, {
        speakerLabel: guess.speakerLabel,
        proofId: guess.proofId,
        answer: 'no',
      });
      const guessWrites = rowsChanged(guesses, nextGuesses, guessUnchanged);
      await requireChangedClips(supabase, orgId, jobId, [guess.proofId, ...guessWrites.map((row) => row.proofId)]);
      const admin = writerOrThrow();
      const created = await admin
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
      if (guessWrites.length) await saveGuesses(admin, orgId, guessWrites);
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
    const guessWrites = rowsChanged(guesses, nextGuesses, guessUnchanged);
    await requireChangedClips(supabase, orgId, jobId, guessWrites.map((row) => row.proofId));
    if (guessWrites.length) await saveGuesses(writerOrThrow(), orgId, guessWrites);
    res.json({ verifications: pendingQuestions(identities, nextGuesses) });
  } catch (err) {
    next(err);
  }
});

async function saveGuesses(db: Db, orgId: string, rows: RoleGuessRow[]) {
  for (const row of rows) {
    const { error } = await db
      .from('speaker_role_guesses')
      .update({ role: row.role, status: row.status, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('org_id', orgId);
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
        const identityWrites = rowsChanged(identities, nextRows, identityUnchanged);
        await requireChangedClips(supabase, orgId, jobId, [
          ...rewrittenProofIds(identities, nextRows, identityRewritten),
          ...identityWrites.map((row) => row.proofId),
        ]);
        if (identityWrites.length) await saveIdentities(writerOrThrow(), orgId, identityWrites);
        await publishConfirmedNames(orgId, nextRows);
      } else {
        const { error } = await writerOrThrow().from('speaker_identities').insert({
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
      const { error } = await writerOrThrow().from('speaker_role_guesses').upsert(
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
