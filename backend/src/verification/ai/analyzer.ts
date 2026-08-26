/**
 * Provider-independent vision analysis interface for verification.
 *
 * Primary path: low-cost multimodal (Gemini Flash by default).
 * Escalation: stronger frontier model only when policy says so.
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { googleVisionApiKey } from '../../lib/visionProvider.js';
import { getProvider, type ProviderId } from '../../ai/providers/index.js';
import { verificationConfig } from '../config.js';
import {
  frameComparisonSchema,
  frameObservationSchema,
  parseModelJson,
  sequenceAnalysisSchema,
  type FrameObservationParsed,
} from '../schemas.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import { estimateCostUsd, recordAiCost, wouldExceedBudget } from '../cost/tracker.js';
import { appendAuditEvent } from '../audit/auditLog.js';

export interface VisionImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  frameId?: string;
}

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerRequestId: string | null;
  estimatedCostUsd: number;
}

export interface AnalysisResult<T> {
  parsed: T;
  raw: string;
  provider: string;
  modelName: string;
  modelVersion: string | null;
  promptVersion: string;
  usage: AnalysisUsage;
  cached: boolean;
}

export interface VisionAnalyzer {
  analyzeFrame(image: VisionImage, context?: AnalysisContext): Promise<AnalysisResult<FrameObservationParsed>>;
  compareFrames(
    before: VisionImage,
    after: VisionImage,
    context?: AnalysisContext,
  ): Promise<AnalysisResult<z.output<typeof frameComparisonSchema>>>;
  analyzeFrameSequence(
    images: VisionImage[],
    context?: AnalysisContext,
  ): Promise<AnalysisResult<z.output<typeof sequenceAnalysisSchema>>>;
  escalateAnalysis(
    images: VisionImage[],
    reason: string,
    context?: AnalysisContext,
  ): Promise<AnalysisResult<FrameObservationParsed>>;
}

export interface AnalysisContext {
  roomHint?: string;
  scopeLines?: string[];
  priorActivities?: string[];
}

const FRAME_SYSTEM = `You analyze a single frame from a restoration or construction job-site video.
Describe ONLY what is visible. Do not infer completed work from a single still.
Reply with JSON only matching this schema:
{"room_type":string,"observed_conditions":string[],"damage_types":string[],"work_activities":string[],"materials_present":string[],"equipment_present":string[],"completion_indicators":string[],"safety_issues":string[],"visible_text":string[],"uncertainty_reasons":string[],"confidence":number,"evidence_regions":[{"label":string,"x":number,"y":number,"width":number,"height":number}]}
work_activities examples: drywall_removed, insulation_removed, framing_exposed, drying_equipment_installed, dehumidifier_operating, air_mover_present, containment_installed, flooring_removed, subfloor_exposed, drywall_installed, drywall_finished, primer_applied, painting_completed, flooring_installed, cabinets_installed, debris_removed, final_cleaning_completed, insulation_installed.
confidence is 0-1 for your own certainty about what is visible, not whether work is verified.`;

const COMPARE_SYSTEM = `You compare two frames from the same job site area at different times.
Do not claim work was completed solely because an object appears in one frame.
Prefer evidence of progression. Reply JSON only:
{"same_area":boolean,"before_state":string,"after_state":string,"inferred_activity":string|null,"evidence":string[],"conflicting_evidence":string[],"confidence":number,"uncertainty_reasons":string[]}`;

const SEQUENCE_SYSTEM = `You analyze an ordered sequence of frames from one walkthrough.
Describe progression without inventing off-camera work. JSON only:
{"room_type":string,"progression_summary":string,"observed_activities":string[],"before_state":string|null,"after_state":string|null,"confidence":number,"uncertainty_reasons":string[]}`;

function inputDigest(frameIds: string[], promptVersion: string, purpose: string): string {
  return createHash('sha256')
    .update(`${purpose}|${promptVersion}|${frameIds.join(',')}`)
    .digest('hex');
}

async function completeText(opts: {
  providerId: ProviderId;
  model: string;
  system: string;
  userText: string;
  /** When the text provider cannot take images, callers that need vision should use VisionHttpAnalyzer. */
}): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const provider = getProvider(opts.providerId);
  if (!provider.isConfigured()) {
    throw new Error(`Provider ${opts.providerId} is not configured`);
  }
  const started = Date.now();
  const result = await provider.complete({
    model: opts.model,
    system: opts.system,
    messages: [{ role: 'user', content: opts.userText }],
    json: true,
    maxOutputTokens: 2048,
    temperature: 0,
  });
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: Date.now() - started,
  };
}

/**
 * HTTP vision analyzer using Gemini generateContent (images) or Anthropic-style
 * fallbacks. Text-only providers get a degraded path that embeds a note — tests
 * inject MockVisionAnalyzer instead.
 */
export class GeminiVisionAnalyzer implements VisionAnalyzer {
  constructor(
    private readonly opts?: {
      apiKey?: string;
      baseUrl?: string;
      fetchFn?: typeof fetch;
    },
  ) {}

  private get apiKey(): string {
    return this.opts?.apiKey || googleVisionApiKey();
  }

  private get baseUrl(): string {
    return (
      this.opts?.baseUrl ||
      process.env.GOOGLE_BASE_URL ||
      'https://generativelanguage.googleapis.com'
    ).replace(/\/+$/, '');
  }

  async analyzeFrame(
    image: VisionImage,
    context?: AnalysisContext,
  ): Promise<AnalysisResult<FrameObservationParsed>> {
    const scopeNote = context?.scopeLines?.length
      ? `Job scope lines (note if visible; do not invent completed work):\n${context.scopeLines.map((t) => `- ${t}`).join('\n')}`
      : 'No job scope attached — describe only what the worker appears to be doing in this frame.';
    return this.runStructured({
      purpose: 'frame_analysis',
      system: FRAME_SYSTEM,
      images: [image],
      schema: frameObservationSchema,
      userNote: [
        context?.roomHint ? `Room hint: ${context.roomHint}` : 'Analyze this frame.',
        scopeNote,
      ].join('\n'),
      model: verificationConfig.primaryModel,
      escalate: false,
    });
  }

  async compareFrames(
    before: VisionImage,
    after: VisionImage,
    _context?: AnalysisContext,
  ): Promise<AnalysisResult<z.output<typeof frameComparisonSchema>>> {
    return this.runStructured({
      purpose: 'comparison',
      system: COMPARE_SYSTEM,
      images: [before, after],
      schema: frameComparisonSchema,
      userNote: 'Image 1 is before. Image 2 is after.',
      model: verificationConfig.primaryModel,
      escalate: false,
    });
  }

  async analyzeFrameSequence(
    images: VisionImage[],
    context?: AnalysisContext,
  ): Promise<AnalysisResult<z.output<typeof sequenceAnalysisSchema>>> {
    return this.runStructured({
      purpose: 'sequence_analysis',
      system: SEQUENCE_SYSTEM,
      images,
      schema: sequenceAnalysisSchema,
      userNote: context?.roomHint
        ? `Ordered frames. Room hint: ${context.roomHint}`
        : 'Ordered frames from one walkthrough.',
      model: verificationConfig.primaryModel,
      escalate: false,
    });
  }

  async escalateAnalysis(
    images: VisionImage[],
    reason: string,
    context?: AnalysisContext,
  ): Promise<AnalysisResult<FrameObservationParsed>> {
    // Prefer Anthropic for escalation when configured; otherwise Gemini Pro-class model.
    if (verificationConfig.escalationProvider === 'anthropic') {
      try {
        const textParts = [
          reason,
          context?.roomHint ? `Room hint: ${context.roomHint}` : '',
          `Analyze ${images.length} frame(s). Return the frame observation JSON schema.`,
        ]
          .filter(Boolean)
          .join('\n');
        // Text-only complete through learning provider — images summarized by count for interface compliance.
        // Production escalation should use Anthropic Messages API with image blocks (see escalateWithAnthropic).
        const result = await escalateWithAnthropic(images, textParts);
        return result;
      } catch {
        // fall through to Gemini
      }
    }
    return this.runStructured({
      purpose: 'escalation',
      system: FRAME_SYSTEM,
      images,
      schema: frameObservationSchema,
      userNote: `Escalation: ${reason}`,
      model: verificationConfig.escalationModel,
      escalate: true,
    });
  }

  private async runStructured<S extends z.ZodTypeAny>(opts: {
    purpose: string;
    system: string;
    images: VisionImage[];
    schema: S;
    userNote: string;
    model: string;
    escalate: boolean;
  }): Promise<AnalysisResult<z.output<S>>> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY / GEMINI_API_KEY is not configured');
    }
    const fetchFn = this.opts?.fetchFn ?? fetch;
    const started = Date.now();
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
    const body = {
      system_instruction: { parts: [{ text: opts.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: opts.userNote },
            ...opts.images.map((img) => ({
              inline_data: { mime_type: img.mimeType, data: img.base64 },
            })),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 2048,
      },
    };
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini vision error ${response.status}: ${errText.slice(0, 400)}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      responseId?: string;
    };
    const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsed = parseModelJson(text, opts.schema);
    const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      parsed,
      raw: text,
      provider: 'google',
      modelName: opts.model,
      modelVersion: null,
      promptVersion: verificationConfig.promptVersion,
      usage: {
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        providerRequestId: payload.responseId ?? null,
        estimatedCostUsd: estimateCostUsd('google', inputTokens, outputTokens),
      },
      cached: false,
    };
  }
}

async function escalateWithAnthropic(
  images: VisionImage[],
  userText: string,
): Promise<AnalysisResult<FrameObservationParsed>> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const started = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: verificationConfig.escalationModel,
      max_tokens: 2048,
      temperature: 0,
      system: FRAME_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
            })),
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic escalation failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    id?: string;
  };
  const text = (payload.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  const parsed = parseModelJson(text, frameObservationSchema);
  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  return {
    parsed,
    raw: text,
    provider: 'anthropic',
    modelName: verificationConfig.escalationModel,
    modelVersion: null,
    promptVersion: verificationConfig.promptVersion,
    usage: {
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      providerRequestId: payload.id ?? null,
      estimatedCostUsd: estimateCostUsd('anthropic', inputTokens, outputTokens),
    },
    cached: false,
  };
}

/** Deterministic mock for tests — never calls a paid API. */
export class MockVisionAnalyzer implements VisionAnalyzer {
  constructor(
    private readonly fixtures?: {
      frame?: FrameObservationParsed;
      compare?: z.output<typeof frameComparisonSchema>;
      sequence?: z.output<typeof sequenceAnalysisSchema>;
    },
  ) {}

  async analyzeFrame(image: VisionImage): Promise<AnalysisResult<FrameObservationParsed>> {
    const parsed =
      this.fixtures?.frame ??
      frameObservationSchema.parse({
        room_type: 'kitchen',
        observed_conditions: ['exposed_studs'],
        damage_types: [],
        work_activities: ['drywall_removed', 'framing_exposed'],
        materials_present: ['wood_studs'],
        equipment_present: [],
        completion_indicators: [],
        safety_issues: [],
        visible_text: [],
        uncertainty_reasons: [],
        confidence: 0.82,
        evidence_regions: [],
        model_name: 'mock',
      });
    return this.wrap(parsed, image.frameId);
  }

  async compareFrames(
    _before: VisionImage,
    _after: VisionImage,
  ): Promise<AnalysisResult<z.output<typeof frameComparisonSchema>>> {
    const parsed =
      this.fixtures?.compare ??
      frameComparisonSchema.parse({
        same_area: true,
        before_state: 'drywall_present',
        after_state: 'framing_exposed',
        inferred_activity: 'drywall_removed',
        evidence: ['studs visible after', 'drywall face missing'],
        conflicting_evidence: [],
        confidence: 0.8,
        uncertainty_reasons: [],
      });
    return {
      parsed,
      raw: JSON.stringify(parsed),
      provider: 'mock',
      modelName: 'mock-vision',
      modelVersion: 'test',
      promptVersion: verificationConfig.promptVersion,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 1,
        providerRequestId: null,
        estimatedCostUsd: 0,
      },
      cached: false,
    };
  }

  async analyzeFrameSequence(
    _images: VisionImage[],
  ): Promise<AnalysisResult<z.output<typeof sequenceAnalysisSchema>>> {
    const parsed =
      this.fixtures?.sequence ??
      sequenceAnalysisSchema.parse({
        room_type: 'kitchen',
        progression_summary: 'Walkthrough shows drywall removal progressing.',
        observed_activities: ['drywall_removed'],
        before_state: 'drywall_present',
        after_state: 'framing_exposed',
        confidence: 0.75,
        uncertainty_reasons: [],
      });
    return {
      parsed,
      raw: JSON.stringify(parsed),
      provider: 'mock',
      modelName: 'mock-vision',
      modelVersion: 'test',
      promptVersion: verificationConfig.promptVersion,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 1,
        providerRequestId: null,
        estimatedCostUsd: 0,
      },
      cached: false,
    };
  }

  async escalateAnalysis(
    images: VisionImage[],
    _reason: string,
  ): Promise<AnalysisResult<FrameObservationParsed>> {
    return this.analyzeFrame(images[0] ?? { mimeType: 'image/jpeg', base64: '' });
  }

  private wrap(
    parsed: FrameObservationParsed,
    frameId?: string,
  ): AnalysisResult<FrameObservationParsed> {
    return {
      parsed: { ...parsed, model_name: parsed.model_name ?? 'mock' },
      raw: JSON.stringify(parsed),
      provider: 'mock',
      modelName: 'mock-vision',
      modelVersion: 'test',
      promptVersion: verificationConfig.promptVersion,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 1,
        providerRequestId: frameId ?? null,
        estimatedCostUsd: 0,
      },
      cached: false,
    };
  }
}

export function shouldEscalate(opts: {
  confidence: number;
  schemaFailures: number;
  disagreement: boolean;
  contradictory: boolean;
  rulesUnresolved: boolean;
  highRisk: boolean;
  humanRequested: boolean;
}): boolean {
  if (opts.humanRequested) return true;
  if (opts.highRisk) return true;
  if (opts.contradictory) return true;
  if (opts.rulesUnresolved) return true;
  if (opts.disagreement) return true;
  if (opts.schemaFailures >= 2) return true;
  if (opts.confidence < verificationConfig.escalateBelowConfidence) return true;
  return false;
}

/** Agreed scope lines for the job (optional party filter). */
export async function loadJobScopeLines(
  supabase: PipelineContext['supabase'],
  jobId: string,
  partyId?: string | null,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('job_scope_items')
    .select('title, party_id, state')
    .eq('job_id', jobId)
    .in('state', ['included', 'approved']);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ title: string; party_id: string | null }>)
    .filter((row) => !row.party_id || !partyId || row.party_id === partyId)
    .map((row) => String(row.title).trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function createAnalyzeFramesHandler(opts: {
  analyzer: VisionAnalyzer;
  loadFrameBase64: (ctx: PipelineContext, storagePath: string) => Promise<string>;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    if (await wouldExceedBudget(ctx.supabase, ctx.orgId)) {
      throw new Error('Monthly verification AI budget exceeded');
    }

    const scopeLines = await loadJobScopeLines(ctx.supabase, ctx.jobId, ctx.partyId);
    const analysisContext: AnalysisContext = { scopeLines };

    const { data: frames, error } = await ctx.supabase
      .from('verification_frames')
      .select('id, storage_path, scene_id, timestamp_seconds')
      .eq('video_id', ctx.videoId)
      .eq('selected_for_analysis', true)
      .order('sequence_number', { ascending: true });
    if (error) throw new Error(error.message);

    let analyzed = 0;
    let cached = 0;
    let escalated = 0;

    for (const frame of frames ?? []) {
      const digest = inputDigest([frame.id], verificationConfig.promptVersion, 'frame_analysis');
      const { data: prior } = await ctx.supabase
        .from('ai_analysis_runs')
        .select('id, parsed_response, model_name, prompt_version')
        .eq('org_id', ctx.orgId)
        .eq('input_digest', digest)
        .eq('schema_valid', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let observation: FrameObservationParsed;
      let runId: string;
      let modelName: string;
      let promptVersion: string;

      if (prior?.parsed_response) {
        observation = frameObservationSchema.parse(prior.parsed_response);
        runId = prior.id;
        modelName = prior.model_name;
        promptVersion = prior.prompt_version;
        cached += 1;
        await ctx.supabase.from('ai_analysis_runs').insert({
          id: randomUUID(),
          org_id: ctx.orgId,
          video_id: ctx.videoId,
          processing_job_id: ctx.processingJobId,
          purpose: 'cache_hit',
          provider: 'cache',
          model_name: modelName,
          prompt_version: promptVersion,
          input_frame_ids: [frame.id],
          input_digest: digest,
          parsed_response: observation,
          schema_valid: true,
          estimated_cost_usd: 0,
          latency_ms: 0,
        });
      } else {
        const base64 = await opts.loadFrameBase64(ctx, frame.storage_path);
        let result = await opts.analyzer.analyzeFrame(
          {
            mimeType: 'image/jpeg',
            base64,
            frameId: frame.id,
          },
          analysisContext,
        );
        if (
          shouldEscalate({
            confidence: result.parsed.confidence,
            schemaFailures: 0,
            disagreement: false,
            contradictory: false,
            rulesUnresolved: false,
            highRisk: (result.parsed.safety_issues?.length ?? 0) > 0,
            humanRequested: false,
          })
        ) {
          result = await opts.analyzer.escalateAnalysis(
            [{ mimeType: 'image/jpeg', base64, frameId: frame.id }],
            'low_confidence_or_safety',
            analysisContext,
          );
          escalated += 1;
        }

        runId = randomUUID();
        observation = result.parsed;
        modelName = result.modelName;
        promptVersion = result.promptVersion;

        await ctx.supabase.from('ai_analysis_runs').insert({
          id: runId,
          org_id: ctx.orgId,
          video_id: ctx.videoId,
          processing_job_id: ctx.processingJobId,
          purpose: escalated ? 'escalation' : 'frame_analysis',
          provider: result.provider,
          model_name: result.modelName,
          model_version: result.modelVersion,
          prompt_version: result.promptVersion,
          input_frame_ids: [frame.id],
          input_digest: digest,
          raw_response: result.raw,
          parsed_response: result.parsed,
          schema_valid: true,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          estimated_cost_usd: result.usage.estimatedCostUsd,
          latency_ms: result.usage.latencyMs,
          provider_request_id: result.usage.providerRequestId,
        });

        await recordAiCost(ctx.supabase, {
          orgId: ctx.orgId,
          videoId: ctx.videoId,
          jobId: ctx.jobId,
          analysisRunId: runId,
          provider: result.provider,
          modelName: result.modelName,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCostUsd: result.usage.estimatedCostUsd,
        });
      }

      await ctx.supabase.from('frame_observations').insert({
        org_id: ctx.orgId,
        video_id: ctx.videoId,
        frame_id: frame.id,
        analysis_run_id: runId,
        scene_id: frame.scene_id,
        room_type: observation.room_type,
        observed_conditions: observation.observed_conditions,
        damage_types: observation.damage_types,
        work_activities: observation.work_activities,
        materials_present: observation.materials_present,
        equipment_present: observation.equipment_present,
        completion_indicators: observation.completion_indicators,
        safety_issues: observation.safety_issues,
        visible_text: observation.visible_text,
        uncertainty_reasons: observation.uncertainty_reasons,
        evidence_regions: observation.evidence_regions,
        model_confidence: observation.confidence,
        model_name: modelName,
        prompt_version: promptVersion,
        parsed: observation,
      });

      // Promote AI room type onto scenes that are still unidentified.
      if (frame.scene_id && observation.room_type && observation.room_type !== 'unidentified') {
        await ctx.supabase
          .from('verification_scenes')
          .update({
            room_type: observation.room_type,
            confidence: Math.max(observation.confidence, 0.5),
            source: 'mixed',
          })
          .eq('id', frame.scene_id)
          .eq('room_type', 'unidentified')
          .eq('user_corrected', false);
      }

      analyzed += 1;
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'ai.frames_analyzed',
      entityType: 'verification_video',
      entityId: ctx.videoId,
      payload: { analyzed, cached, escalated },
    });

    return { output: { analyzed, cached, escalated } };
  };
}

// silence unused import when tree-shaken in some builds
void completeText;
