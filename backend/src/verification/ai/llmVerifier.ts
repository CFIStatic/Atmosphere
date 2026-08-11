/**
 * Provider-independent LLM work-event verifier.
 *
 * Visual observations propose evidence. This layer is the primary reviewer:
 * approve / reject / mark uncertain with cited frames. Rules supply a checklist;
 * they do not decide.
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verificationConfig } from '../config.js';
import { parseModelJson } from '../schemas.js';
import { estimateCostUsd, recordAiCost, wouldExceedBudget } from '../cost/tracker.js';
import { appendAuditEvent } from '../audit/auditLog.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import {
  BUILTIN_RULES,
  evaluateAllRules,
  type RulesResult,
  type VerificationRule,
} from '../rules/engine.js';
import { scoreConfidence } from '../confidence/score.js';
import { createReviewTask } from '../review/queue.js';
import {
  DEFAULT_VERIFIER_SYSTEM,
  VERIFIER_PROMPT_KEY,
  VERIFIER_PROMPT_VERSION,
} from '../prompts/registry.js';

export const LLM_DECISIONS = [
  'verified',
  'likely_verified',
  'partially_verified',
  'uncertain',
  'contradicted',
  'rejected',
] as const;
export type LlmDecision = (typeof LLM_DECISIONS)[number];

export const evidenceCiteSchema = z.object({
  frame_id: z.string().min(1),
  reason: z.string().max(500),
});

export const workEventVerificationResultSchema = z.object({
  decision: z.enum(LLM_DECISIONS),
  proposed_activity: z.string().min(1).max(120),
  room_id: z.string().max(120).nullable().optional(),
  before_state: z.object({
    description: z.string().max(1000),
    evidence_frame_ids: z.array(z.string()).default([]),
  }),
  after_state: z.object({
    description: z.string().max(1000),
    evidence_frame_ids: z.array(z.string()).default([]),
  }),
  supporting_evidence: z.array(evidenceCiteSchema).default([]),
  contradictory_evidence: z.array(evidenceCiteSchema).default([]),
  sequence_analysis: z.string().max(2000),
  completion_state: z.enum(['not_started', 'started', 'partial', 'complete', 'unknown']),
  model_confidence: z.number().min(0).max(1),
  uncertainty_reasons: z.array(z.string().max(300)).default([]),
  required_follow_up: z.string().max(500).nullable(),
});

export type WorkEventVerificationResult = z.output<typeof workEventVerificationResultSchema>;

export interface WorkEventVerificationInput {
  proposedActivity: string;
  roomId?: string | null;
  roomOrArea?: string | null;
  beforeState: string;
  afterState: string;
  beforeFrameIds: string[];
  duringFrameIds?: string[];
  afterFrameIds: string[];
  observations: string[];
  contradictoryObservations: string[];
  ruleChecklist: RulesResult | null;
  rule: VerificationRule | null;
  captureTimestamps?: { before?: string | null; after?: string | null };
  scopeLines?: string[];
  /** Optional JPEG base64 frames keyed by frame id — omitted in text-only mocks. */
  frameImages?: Record<string, { mimeType: string; base64: string }>;
  highRisk?: boolean;
}

export interface VerificationProvider {
  verifyWorkEvent(input: WorkEventVerificationInput): Promise<{
    parsed: WorkEventVerificationResult;
    raw: string;
    provider: string;
    modelName: string;
    modelVersion: string | null;
    promptKey: string;
    promptVersion: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      providerRequestId: string | null;
      estimatedCostUsd: number;
    };
  }>;
}

export interface EscalationVerificationProvider {
  reviewDisputedEvent(
    input: WorkEventVerificationInput & { priorDecision: WorkEventVerificationResult; reason: string },
  ): Promise<ReturnType<VerificationProvider['verifyWorkEvent']> extends Promise<infer R> ? R : never>;
}

function buildUserPayload(input: WorkEventVerificationInput): string {
  return JSON.stringify(
    {
      proposed_activity: input.proposedActivity,
      room_id: input.roomId ?? input.roomOrArea ?? null,
      before_state_label: input.beforeState,
      after_state_label: input.afterState,
      before_frame_ids: input.beforeFrameIds,
      during_frame_ids: input.duringFrameIds ?? [],
      after_frame_ids: input.afterFrameIds,
      structured_observations: input.observations,
      contradictory_observations: input.contradictoryObservations,
      rule_checklist: input.ruleChecklist,
      rule: input.rule
        ? {
            activity: input.rule.activityType,
            version: input.rule.version,
            required_before: input.rule.requiredBeforeStates,
            required_after: input.rule.requiredAfterStates,
            min_frames: input.rule.minSupportingFrames,
            contradictions: input.rule.contradictoryObservations,
          }
        : null,
      capture_timestamps: input.captureTimestamps ?? null,
      scope_lines: input.scopeLines ?? [],
      instruction:
        'Evaluate whether the evidence ADEQUATELY SUPPORTS the proposed activity. Reject weak claims.',
    },
    null,
    2,
  );
}

/** Deterministic skeptical mock — never calls a paid API. */
export class MockVerificationProvider implements VerificationProvider {
  constructor(private readonly fixture?: Partial<WorkEventVerificationResult>) {}

  async verifyWorkEvent(input: WorkEventVerificationInput) {
    const hasBefore = input.beforeFrameIds.length > 0;
    const hasAfter = input.afterFrameIds.length > 0;
    const hasConflict = input.contradictoryObservations.length > 0;
    const checklistFailed = input.ruleChecklist && !input.ruleChecklist.passed;

    let decision: LlmDecision = 'verified';
    let completion: WorkEventVerificationResult['completion_state'] = 'complete';
    let confidence = 0.92;
    const uncertainty: string[] = [];

    if (!hasBefore || !hasAfter) {
      decision = 'rejected';
      completion = 'unknown';
      confidence = 0.35;
      uncertainty.push('Insufficient before-and-after evidence');
    } else if (hasConflict) {
      decision = 'contradicted';
      completion = 'unknown';
      confidence = 0.4;
      uncertainty.push('Contradictory observations present');
    } else if (checklistFailed) {
      decision = 'uncertain';
      completion = 'partial';
      confidence = 0.45;
      uncertainty.push(...(input.ruleChecklist?.missing ?? []), 'Rule checklist not fully satisfied');
    } else if (input.beforeState === input.afterState) {
      decision = 'rejected';
      confidence = 0.5;
      uncertainty.push('Before and after states are identical — no visible change');
    }

    const parsed = workEventVerificationResultSchema.parse({
      decision: this.fixture?.decision ?? decision,
      proposed_activity: this.fixture?.proposed_activity ?? input.proposedActivity,
      room_id: this.fixture?.room_id ?? input.roomId ?? input.roomOrArea ?? null,
      before_state: this.fixture?.before_state ?? {
        description: `Before: ${input.beforeState}`,
        evidence_frame_ids: input.beforeFrameIds,
      },
      after_state: this.fixture?.after_state ?? {
        description: `After: ${input.afterState}`,
        evidence_frame_ids: input.afterFrameIds,
      },
      supporting_evidence:
        this.fixture?.supporting_evidence ??
        input.afterFrameIds.map((frame_id) => ({
          frame_id,
          reason: 'After-state evidence consistent with proposed activity',
        })),
      contradictory_evidence:
        this.fixture?.contradictory_evidence ??
        input.contradictoryObservations.map((c) => ({
          frame_id: input.afterFrameIds[0] ?? 'unknown',
          reason: c,
        })),
      sequence_analysis:
        this.fixture?.sequence_analysis ??
        (decision === 'verified'
          ? 'Timestamps and states are consistent with the proposed activity in the same area.'
          : 'Evidence is insufficient or conflicting for a verified claim.'),
      completion_state: this.fixture?.completion_state ?? completion,
      model_confidence: this.fixture?.model_confidence ?? confidence,
      uncertainty_reasons: this.fixture?.uncertainty_reasons ?? uncertainty,
      required_follow_up:
        this.fixture?.required_follow_up ??
        (decision === 'uncertain' || decision === 'rejected'
          ? 'Capture clearer before-and-after frames of the same wall/area.'
          : null),
    });

    return {
      parsed,
      raw: JSON.stringify(parsed),
      provider: 'mock',
      modelName: 'mock-verifier',
      modelVersion: 'test',
      promptKey: VERIFIER_PROMPT_KEY,
      promptVersion: VERIFIER_PROMPT_VERSION,
      usage: {
        inputTokens: 50,
        outputTokens: 80,
        latencyMs: 1,
        providerRequestId: null,
        estimatedCostUsd: 0,
      },
    };
  }
}

export class MockEscalationProvider implements EscalationVerificationProvider {
  constructor(private readonly primary = new MockVerificationProvider()) {}

  async reviewDisputedEvent(
    input: WorkEventVerificationInput & { priorDecision: WorkEventVerificationResult; reason: string },
  ) {
    // Escalation is slightly more conservative.
    const result = await this.primary.verifyWorkEvent(input);
    if (result.parsed.decision === 'verified') {
      result.parsed.decision = 'likely_verified';
      result.parsed.model_confidence = Math.min(result.parsed.model_confidence, 0.88);
      result.parsed.sequence_analysis += ` Escalation review (${input.reason}).`;
    }
    return { ...result, modelName: 'mock-escalation-verifier', provider: 'mock-escalation' };
  }
}

/** Text LLM verifier via OpenAI-compatible or Anthropic Messages JSON mode. */
export class HttpLlmVerificationProvider implements VerificationProvider {
  constructor(
    private readonly opts: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl?: string;
      systemPrompt?: string;
      fetchFn?: typeof fetch;
    },
  ) {}

  async verifyWorkEvent(input: WorkEventVerificationInput) {
    const started = Date.now();
    const system = this.opts.systemPrompt ?? DEFAULT_VERIFIER_SYSTEM;
    const user = buildUserPayload(input);
    const fetchFn = this.opts.fetchFn ?? fetch;

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let requestId: string | null = null;

    if (this.opts.provider === 'anthropic') {
      const response = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: 2048,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic verifier failed: ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        id?: string;
      };
      text = (payload.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      inputTokens = payload.usage?.input_tokens ?? 0;
      outputTokens = payload.usage?.output_tokens ?? 0;
      requestId = payload.id ?? null;
    } else {
      // Gemini generateContent JSON
      const base = (this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
      const url = `${base}/v1beta/models/${encodeURIComponent(this.opts.model)}:generateContent`;
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0,
            maxOutputTokens: 2048,
          },
        }),
      });
      if (!response.ok) throw new Error(`Gemini verifier failed: ${response.status}`);
      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        responseId?: string;
      };
      text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
      requestId = payload.responseId ?? null;
    }

    const parsed = parseModelJson(text, workEventVerificationResultSchema);
    return {
      parsed,
      raw: text,
      provider: this.opts.provider,
      modelName: this.opts.model,
      modelVersion: null,
      promptKey: VERIFIER_PROMPT_KEY,
      promptVersion: VERIFIER_PROMPT_VERSION,
      usage: {
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        providerRequestId: requestId,
        estimatedCostUsd: estimateCostUsd(this.opts.provider, inputTokens, outputTokens),
      },
    };
  }
}

export function createDefaultVerifier(): VerificationProvider {
  if (process.env.VERIFICATION_USE_MOCK_AI === 'true' || process.env.NODE_ENV === 'test') {
    return new MockVerificationProvider();
  }
  if (process.env.VERIFICATION_ALLOW_MOCK_FALLBACK === 'true' && !process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    return new MockVerificationProvider();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new HttpLlmVerificationProvider({
      provider: 'anthropic',
      model: process.env.VERIFICATION_LLM_VERIFIER_MODEL ?? verificationConfig.escalationModel,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  if (googleKey) {
    return new HttpLlmVerificationProvider({
      provider: 'google',
      model: process.env.VERIFICATION_LLM_VERIFIER_MODEL ?? verificationConfig.primaryModel,
      apiKey: googleKey,
    });
  }
  return new MockVerificationProvider();
}

export function createDefaultEscalationVerifier(): EscalationVerificationProvider {
  if (process.env.VERIFICATION_USE_MOCK_AI === 'true' || process.env.NODE_ENV === 'test') {
    return new MockEscalationProvider();
  }
  const primary = createDefaultVerifier();
  return {
    async reviewDisputedEvent(input) {
      // Prefer a stronger model when Anthropic is configured.
      if (process.env.ANTHROPIC_API_KEY && !(primary instanceof MockVerificationProvider)) {
        const esc = new HttpLlmVerificationProvider({
          provider: 'anthropic',
          model: verificationConfig.escalationModel,
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        return esc.verifyWorkEvent(input);
      }
      return primary.verifyWorkEvent(input);
    },
  };
}

export function shouldEscalateVerification(opts: {
  decision: LlmDecision;
  modelConfidence: number;
  contradictory: boolean;
  highRisk: boolean;
  schemaFailures: number;
  humanDisputed: boolean;
  disagreement: boolean;
}): boolean {
  if (opts.humanDisputed) return true;
  if (opts.highRisk) return true;
  if (opts.disagreement) return true;
  if (opts.schemaFailures >= 2) return true;
  if (opts.contradictory) return true;
  if (opts.decision === 'uncertain' || opts.decision === 'contradicted') return true;
  if (opts.modelConfidence < verificationConfig.escalateBelowConfidence) return true;
  return false;
}

function inputDigest(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

async function loadRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
): Promise<VerificationRule[]> {
  const { data } = await supabase
    .from('verification_rules')
    .select('*')
    .eq('is_active', true)
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  if (!data?.length) return BUILTIN_RULES;
  const byActivity = new Map<string, VerificationRule>();
  for (const row of data) {
    const rule: VerificationRule = {
      id: row.id,
      activityType: row.activity_type,
      version: row.version,
      name: row.name,
      requiredObservations: row.required_observations ?? [],
      requiredBeforeStates: row.required_before_states ?? [],
      requiredAfterStates: row.required_after_states ?? [],
      minSupportingFrames: row.min_supporting_frames,
      minConfidence: Number(row.min_confidence),
      contradictoryObservations: row.contradictory_observations ?? [],
      allowedRoomTypes: row.allowed_room_types ?? [],
      humanReviewTriggers: row.human_review_triggers ?? [],
      projectRequirements: row.project_requirements ?? {},
    };
    const existing = byActivity.get(rule.activityType);
    if (!existing || row.org_id === orgId) byActivity.set(rule.activityType, rule);
  }
  return [...byActivity.values()];
}

export function createLlmVerifyEvidenceHandler(opts: {
  verifier: VerificationProvider;
  escalation?: EscalationVerificationProvider;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    if (await wouldExceedBudget(ctx.supabase, ctx.orgId)) {
      throw new Error('Monthly verification AI budget exceeded');
    }

    const rules = await loadRules(ctx.supabase, ctx.orgId);
    const { data: scopeRows } = await ctx.supabase
      .from('job_scope_items')
      .select('title, party_id, state')
      .eq('job_id', ctx.jobId)
      .in('state', ['included', 'approved']);
    const scopeLines = ((scopeRows ?? []) as Array<{ title: string; party_id: string | null }>)
      .filter((row) => !row.party_id || !ctx.partyId || row.party_id === ctx.partyId)
      .map((row) => String(row.title).trim())
      .filter(Boolean)
      .slice(0, 40);

    const { data: events, error } = await ctx.supabase
      .from('temporal_change_events')
      .select('*')
      .eq('job_id', ctx.jobId)
      .eq('org_id', ctx.orgId)
      .in('candidate_status', ['proposed'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    let reviewed = 0;
    let escalated = 0;

    for (const event of events ?? []) {
      const supportingFrameCount =
        (event.before_frame_ids?.length ?? 0) + (event.after_frame_ids?.length ?? 0);
      const ruleChecklist = evaluateAllRules(rules, {
        activityType: event.inferred_activity,
        roomType: event.room_or_area,
        observations: [event.before_state, event.after_state, event.inferred_activity],
        beforeStates: [event.before_state],
        afterStates: [event.after_state],
        supportingFrameCount,
        confidence: Number(event.confidence ?? 0),
        contradictory: event.conflicting_evidence ?? [],
      });
      const rule = rules.find((r) => r.activityType === event.inferred_activity) ?? null;

      const digest = inputDigest({
        change: event.id,
        prompt: VERIFIER_PROMPT_VERSION,
        before: event.before_frame_ids,
        after: event.after_frame_ids,
      });

      const { data: cached } = await ctx.supabase
        .from('llm_verification_runs')
        .select('id, parsed_decision, decision')
        .eq('org_id', ctx.orgId)
        .eq('input_digest', digest)
        .eq('schema_valid', true)
        .eq('purpose', 'primary')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let verification = cached?.parsed_decision
        ? {
            parsed: workEventVerificationResultSchema.parse(cached.parsed_decision),
            raw: JSON.stringify(cached.parsed_decision),
            provider: 'cache',
            modelName: 'cache',
            modelVersion: null,
            promptKey: VERIFIER_PROMPT_KEY,
            promptVersion: VERIFIER_PROMPT_VERSION,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: 0,
              providerRequestId: null,
              estimatedCostUsd: 0,
            },
          }
        : await opts.verifier.verifyWorkEvent({
            proposedActivity: event.inferred_activity,
            roomOrArea: event.room_or_area,
            beforeState: event.before_state,
            afterState: event.after_state,
            beforeFrameIds: event.before_frame_ids ?? [],
            duringFrameIds: event.during_frame_ids ?? [],
            afterFrameIds: event.after_frame_ids ?? [],
            observations: [...(event.evidence ?? [])],
            contradictoryObservations: event.conflicting_evidence ?? [],
            ruleChecklist,
            rule,
            scopeLines,
            captureTimestamps: {
              before: event.first_observed_at,
              after: event.last_observed_at,
            },
          });

      const primaryRunId = randomUUID();
      if (!cached) {
        await ctx.supabase.from('llm_verification_runs').insert({
          id: primaryRunId,
          org_id: ctx.orgId,
          job_id: ctx.jobId,
          video_id: ctx.videoId,
          change_event_id: event.id,
          purpose: 'primary',
          provider: verification.provider,
          model_name: verification.modelName,
          model_version: verification.modelVersion,
          prompt_key: verification.promptKey,
          prompt_version: verification.promptVersion,
          rule_id: rule?.id?.startsWith('builtin') ? null : rule?.id ?? null,
          rule_version: rule?.version ?? null,
          input_frame_ids: [
            ...(event.before_frame_ids ?? []),
            ...(event.after_frame_ids ?? []),
          ],
          input_digest: digest,
          raw_response: verification.raw,
          parsed_decision: verification.parsed,
          decision: verification.parsed.decision,
          model_confidence: verification.parsed.model_confidence,
          schema_valid: true,
          input_tokens: verification.usage.inputTokens,
          output_tokens: verification.usage.outputTokens,
          estimated_cost_usd: verification.usage.estimatedCostUsd,
          latency_ms: verification.usage.latencyMs,
          provider_request_id: verification.usage.providerRequestId,
        });
        await recordAiCost(ctx.supabase, {
          orgId: ctx.orgId,
          videoId: ctx.videoId,
          jobId: ctx.jobId,
          analysisRunId: primaryRunId,
          provider: verification.provider,
          modelName: verification.modelName,
          inputTokens: verification.usage.inputTokens,
          outputTokens: verification.usage.outputTokens,
          estimatedCostUsd: verification.usage.estimatedCostUsd,
        });
      }

      let finalRunId = cached?.id ?? primaryRunId;
      let finalDecision = verification.parsed;

      if (
        opts.escalation &&
        shouldEscalateVerification({
          decision: verification.parsed.decision,
          modelConfidence: verification.parsed.model_confidence,
          contradictory: (event.conflicting_evidence ?? []).length > 0,
          highRisk: false,
          schemaFailures: 0,
          humanDisputed: false,
          disagreement: false,
        })
      ) {
        const esc = await opts.escalation.reviewDisputedEvent({
          proposedActivity: event.inferred_activity,
          roomOrArea: event.room_or_area,
          beforeState: event.before_state,
          afterState: event.after_state,
          beforeFrameIds: event.before_frame_ids ?? [],
          afterFrameIds: event.after_frame_ids ?? [],
          observations: [...(event.evidence ?? [])],
          contradictoryObservations: event.conflicting_evidence ?? [],
          ruleChecklist,
          rule,
          priorDecision: verification.parsed,
          reason: 'primary_uncertain_or_conflict',
        });
        const escId = randomUUID();
        await ctx.supabase.from('llm_verification_runs').insert({
          id: escId,
          org_id: ctx.orgId,
          job_id: ctx.jobId,
          video_id: ctx.videoId,
          change_event_id: event.id,
          parent_run_id: finalRunId,
          purpose: 'escalation',
          provider: esc.provider,
          model_name: esc.modelName,
          prompt_key: esc.promptKey,
          prompt_version: esc.promptVersion,
          rule_version: rule?.version ?? null,
          input_frame_ids: [
            ...(event.before_frame_ids ?? []),
            ...(event.after_frame_ids ?? []),
          ],
          raw_response: esc.raw,
          parsed_decision: esc.parsed,
          decision: esc.parsed.decision,
          model_confidence: esc.parsed.model_confidence,
          schema_valid: true,
          input_tokens: esc.usage.inputTokens,
          output_tokens: esc.usage.outputTokens,
          estimated_cost_usd: esc.usage.estimatedCostUsd,
          latency_ms: esc.usage.latencyMs,
        });
        finalRunId = escId;
        finalDecision = esc.parsed;
        escalated += 1;
      }

      const breakdown = scoreConfidence({
        modelConfidence: finalDecision.model_confidence,
        supportingFrameCount,
        visualQuality: Number(event.evidence_quality_score ?? 0.7),
        temporalConsistency: (event.conflicting_evidence ?? []).length ? 0.3 : 0.85,
        sceneMatchConfidence: Number(event.scene_match_confidence ?? 0.7),
        modelAgreement: escalated ? 0.7 : 0.9,
        rulesResult: ruleChecklist,
        hasContradictoryEvidence:
          (event.conflicting_evidence ?? []).length > 0 ||
          finalDecision.contradictory_evidence.length > 0,
        metadataQuality: 0.6,
        humanConfirmation: 0,
      });

      const resultId = randomUUID();
      await ctx.supabase.from('verification_results').insert({
        id: resultId,
        org_id: ctx.orgId,
        job_id: ctx.jobId,
        video_id: ctx.videoId,
        change_event_id: event.id,
        llm_run_id: finalRunId,
        rule_id: rule?.id?.startsWith('builtin') ? null : rule?.id ?? null,
        rule_version: rule?.version ?? null,
        activity_type: event.inferred_activity,
        activity_ontology_id: event.activity_ontology_id ?? event.inferred_activity,
        room_or_area: event.room_or_area,
        title: `${(event.room_or_area ?? 'area').replace(/_/g, ' ')} — ${event.inferred_activity.replace(/_/g, ' ')}`,
        summary: finalDecision.sequence_analysis,
        status: finalDecision.decision,
        completion_state: finalDecision.completion_state,
        model_confidence: finalDecision.model_confidence,
        system_confidence: breakdown.final,
        confidence_breakdown: {
          ...breakdown,
          llmVerifierConfidence: finalDecision.model_confidence,
          visualObservationConfidence: Number(event.confidence ?? 0),
          roomMatchConfidence: Number(event.scene_match_confidence ?? 0.7),
          temporalChangeConfidence: Number(event.confidence ?? 0),
          evidenceQualityScore: Number(event.evidence_quality_score ?? 0.7),
        },
        observed_at: event.last_observed_at ?? event.first_observed_at,
        first_evidence_at: event.first_observed_at,
        last_evidence_at: event.last_observed_at,
        ai_observation: finalDecision,
        rules_result: ruleChecklist,
      });

      await ctx.supabase.from('verification_evidence').insert([
        ...(event.before_frame_ids ?? []).map((frameId: string) => ({
          org_id: ctx.orgId,
          result_id: resultId,
          frame_id: frameId,
          video_id: event.before_video_id,
          role: 'before',
        })),
        ...(event.after_frame_ids ?? []).map((frameId: string) => ({
          org_id: ctx.orgId,
          result_id: resultId,
          frame_id: frameId,
          video_id: event.after_video_id,
          role: 'after',
        })),
      ]);

      await ctx.supabase
        .from('temporal_change_events')
        .update({
          candidate_status: 'llm_reviewed',
          verification_status: finalDecision.decision,
        })
        .eq('id', event.id);

      await appendAuditEvent(ctx.supabase, {
        orgId: ctx.orgId,
        jobId: ctx.jobId,
        videoId: ctx.videoId,
        resultId,
        eventType: 'llm.verified',
        entityType: 'llm_verification_run',
        entityId: finalRunId,
        payload: { decision: finalDecision.decision, changeEventId: event.id },
      });

      const needsHuman =
        ['uncertain', 'contradicted', 'rejected', 'partially_verified'].includes(
          finalDecision.decision,
        ) || finalDecision.uncertainty_reasons.length > 0;
      if (needsHuman && finalDecision.decision !== 'verified') {
        await createReviewTask(ctx.supabase, {
          orgId: ctx.orgId,
          jobId: ctx.jobId,
          resultId,
          videoId: ctx.videoId,
          changeEventId: event.id,
          reason: finalDecision.uncertainty_reasons.join(',') || finalDecision.decision,
          priority: finalDecision.decision === 'contradicted' ? 'high' : 'normal',
          context: { llm: finalDecision, rules: ruleChecklist, breakdown },
        });
      }

      reviewed += 1;
    }

    return { output: { reviewed, escalated } };
  };
}
