import { z } from 'zod';
import type { TaskType } from './types.js';

/**
 * The task registry: every kind of work the platform executes on a user's
 * behalf, and how to judge whether it was executed *correctly*.
 *
 * A task spec is the contract that makes learning possible. It pins down the
 * output shape (so a machine can check it), the reward weights (so "correct"
 * means something specific and per-task), and the budgets (so cost and latency
 * are measured against an expectation rather than in the abstract). Registering
 * a new kind of work here is all it takes for the loop to start improving at it
 * — no policy code changes.
 */

/** Deterministic, task-specific check run on a parsed output. */
export interface Check {
  name: string;
  /** Fatal checks block the output from being served at all. */
  fatal?: boolean;
  weight?: number;
  run: (output: unknown, input: unknown) => { passed: boolean; detail?: string };
}

export interface RewardWeights {
  /** Was the work right? Almost always dominant. */
  quality: number;
  /** Was it cheap? */
  cost: number;
  /** Was it fast? */
  latency: number;
}

export interface TaskSpec {
  type: TaskType;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  /** Core instruction; prompt variants decorate this rather than replace it. */
  instruction: string;
  /** Whether the model is asked for JSON. Nearly always true — see below. */
  json: boolean;
  maxOutputTokens: number;
  checks: Check[];
  rewardWeights: RewardWeights;
  /** What a run of this task is expected to cost / take, for scoring. */
  costBudgetUsd: number;
  latencyBudgetMs: number;
  /**
   * Never explore on this task — always serve the champion. For work where a
   * bad output is expensive to un-do (money, legal, customer-facing sends),
   * candidates must earn promotion from shadow traffic instead. See
   * docs/reinforcement-learning.md § Safety rails.
   */
  highStakes?: boolean;
}

/* ─── Prompt variants: the second axis of the action space ─────────────────── */

/**
 * Prompt strategies are *generic decorators*, not per-task prompt copies.
 *
 * This is what keeps the action space from becoming unmaintainable. With N
 * models and M strategies the router has N×M arms to learn over, but a human
 * only ever writes N + M things. It also makes the comparison clean: the same
 * strategy means the same thing on every task, so "deliberate helps on
 * extraction but not on summaries" is a finding you can actually read off the
 * stats, rather than an artifact of two independently-written prompts.
 */
export type PromptVariant = 'baseline' | 'structured' | 'deliberate';

export const PROMPT_VARIANTS: PromptVariant[] = ['baseline', 'structured', 'deliberate'];

const VARIANT_DECORATIONS: Record<PromptVariant, string> = {
  // Trust the model; shortest prompt, cheapest tokens.
  baseline: '',
  // Spell out the procedure. Tends to help smaller and open-weights models most
  // — which is exactly the kind of interaction the policy exists to discover.
  structured:
    '\n\nWork through this in order:\n' +
    '1. List the facts present in the input. Do not infer any that are absent.\n' +
    '2. Identify what the output requires and which of those facts supply it.\n' +
    '3. Emit the final JSON. Every field must trace to a fact from step 1.',
  // Buy accuracy with output tokens: self-check before committing.
  deliberate:
    '\n\nBefore answering, privately check your draft for: unsupported claims, ' +
    'arithmetic errors, and missing required fields. Correct any you find. ' +
    'Return only the final JSON — no reasoning, no preamble.',
};

export function decorateInstruction(instruction: string, variant: string): string {
  const decoration = VARIANT_DECORATIONS[variant as PromptVariant] ?? '';
  return `${instruction}${decoration}`;
}

/* ─── Shared field vocabulary ──────────────────────────────────────────────── */

const confidence = z.number().min(0).max(1);

/** Every task returns a citation trail. Unsupported output is the failure mode
 *  that matters most in this domain — an invented moisture reading or a line
 *  item nobody authorised — so groundedness is checked, not hoped for. */
const sourceRefs = z.array(z.string()).default([]);

/* ─── The registry ─────────────────────────────────────────────────────────── */

const scopeSpec: TaskSpec = {
  type: 'draft_scope',
  description: 'Draft a scope of work from job notes, photos metadata and readings.',
  instruction:
    'You are an experienced restoration estimator. Draft a scope of work from the job ' +
    'record supplied. Include only work the record supports; if the record is missing ' +
    'something a scope would normally cover, list it under `openQuestions` rather than ' +
    'assuming it. Use industry-standard terminology (IICRC S500/S520 where relevant).',
  inputSchema: z.object({
    jobSummary: z.string().min(1).max(20_000),
    workType: z.enum(['mitigation', 'construction']).optional(),
    readings: z.array(z.string()).max(200).optional(),
  }),
  outputSchema: z.object({
    scopeItems: z
      .array(
        z.object({
          area: z.string().min(1),
          task: z.string().min(1),
          justification: z.string().min(1),
        }),
      )
      .min(1),
    openQuestions: z.array(z.string()).default([]),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 2000,
  checks: [
    {
      name: 'justifications_present',
      weight: 2,
      run: (output) => {
        const items = (output as { scopeItems?: Array<{ justification?: string }> }).scopeItems ?? [];
        const bad = items.filter((i) => !i.justification || i.justification.trim().length < 10);
        return { passed: bad.length === 0, detail: `${bad.length} item(s) lack a justification` };
      },
    },
    {
      name: 'no_fabricated_areas',
      weight: 3,
      // Cheap groundedness proxy: an area named in the scope should appear in
      // the source record. Catches the confident-invention failure mode without
      // paying for a judge model on every single run.
      run: (output, input) => {
        const haystack = JSON.stringify(input).toLowerCase();
        const items = (output as { scopeItems?: Array<{ area?: string }> }).scopeItems ?? [];
        const unmatched = items
          .map((i) => i.area ?? '')
          .filter((area) => area.length > 2 && !haystack.includes(area.toLowerCase()));
        return {
          passed: unmatched.length === 0,
          detail: unmatched.length ? `areas not in source: ${unmatched.join(', ')}` : undefined,
        };
      },
    },
  ],
  rewardWeights: { quality: 0.8, cost: 0.1, latency: 0.1 },
  costBudgetUsd: 0.05,
  latencyBudgetMs: 20_000,
};

const estimateSpec: TaskSpec = {
  type: 'estimate_line_items',
  description: 'Turn an approved scope into priced estimate line items.',
  instruction:
    'You are a construction estimator. Convert the approved scope into estimate line ' +
    'items. Use only the unit prices supplied in the price list. Never invent a price; ' +
    'if no price exists for a line, set `unitPrice` to null and add the line to ' +
    '`needsPricing`. Quantities must follow from the measurements given.',
  inputSchema: z.object({
    scope: z.string().min(1).max(20_000),
    priceList: z.array(z.object({ code: z.string(), description: z.string(), unitPrice: z.number() })).max(2000),
    measurements: z.record(z.number()).optional(),
  }),
  outputSchema: z.object({
    lineItems: z
      .array(
        z.object({
          code: z.string().nullable(),
          description: z.string().min(1),
          quantity: z.number().nonnegative(),
          unit: z.string().min(1),
          unitPrice: z.number().nonnegative().nullable(),
          lineTotal: z.number().nonnegative().nullable(),
        }),
      )
      .min(1),
    needsPricing: z.array(z.string()).default([]),
    subtotal: z.number().nonnegative(),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 3000,
  checks: [
    {
      name: 'line_totals_multiply',
      fatal: true, // money that does not add up must never reach a customer
      weight: 4,
      run: (output) => {
        const items = (output as { lineItems?: Array<{ quantity?: number; unitPrice?: number | null; lineTotal?: number | null }> }).lineItems ?? [];
        const wrong = items.filter((i) => {
          if (i.unitPrice == null || i.lineTotal == null) return false;
          const expected = (i.quantity ?? 0) * i.unitPrice;
          return Math.abs(expected - i.lineTotal) > 0.01;
        });
        return { passed: wrong.length === 0, detail: `${wrong.length} line total(s) do not multiply out` };
      },
    },
    {
      name: 'subtotal_matches',
      fatal: true,
      weight: 4,
      run: (output) => {
        const parsed = output as { lineItems?: Array<{ lineTotal?: number | null }>; subtotal?: number };
        const sum = (parsed.lineItems ?? []).reduce((acc, i) => acc + (i.lineTotal ?? 0), 0);
        const passed = Math.abs(sum - (parsed.subtotal ?? 0)) <= 0.01;
        return { passed, detail: passed ? undefined : `lines sum to ${sum.toFixed(2)}, subtotal says ${(parsed.subtotal ?? 0).toFixed(2)}` };
      },
    },
    {
      name: 'prices_from_list',
      fatal: true,
      weight: 5,
      // The single most damaging failure this task can produce: a plausible
      // invented price. Verified exactly, against the supplied list.
      run: (output, input) => {
        const allowed = new Set(
          ((input as { priceList?: Array<{ code?: string; unitPrice?: number }> }).priceList ?? []).map(
            (p) => `${p.code}:${p.unitPrice}`,
          ),
        );
        const items = (output as { lineItems?: Array<{ code?: string | null; unitPrice?: number | null }> }).lineItems ?? [];
        const invented = items.filter(
          (i) => i.unitPrice != null && i.code != null && !allowed.has(`${i.code}:${i.unitPrice}`),
        );
        return {
          passed: invented.length === 0,
          detail: invented.length ? `${invented.length} price(s) not in the supplied price list` : undefined,
        };
      },
    },
  ],
  // Quality is nearly everything: a wrong estimate costs far more than the most
  // expensive model call, so it is never worth saving pennies here.
  rewardWeights: { quality: 0.9, cost: 0.05, latency: 0.05 },
  costBudgetUsd: 0.1,
  latencyBudgetMs: 30_000,
  highStakes: true,
};

const summarySpec: TaskSpec = {
  type: 'summarize_job_notes',
  description: 'Condense a job note thread into a status brief.',
  instruction:
    'Summarise this job note thread for a project manager picking the file up cold. ' +
    'Lead with current status, then what changed since the last entry, then blockers. ' +
    'State only what the notes say.',
  inputSchema: z.object({
    notes: z.array(z.object({ author: z.string(), at: z.string(), body: z.string() })).min(1).max(500),
  }),
  outputSchema: z.object({
    status: z.string().min(1),
    recentChanges: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 900,
  checks: [
    {
      name: 'summary_is_shorter',
      weight: 1,
      run: (output, input) => {
        const inputLength = JSON.stringify(input).length;
        const outputLength = JSON.stringify(output).length;
        return { passed: outputLength < inputLength * 0.6, detail: `${outputLength} vs ${inputLength} chars` };
      },
    },
  ],
  // High volume, low stakes, read at a glance — the one task where cost and
  // speed genuinely deserve real weight. This is where cheap arms should win.
  rewardWeights: { quality: 0.6, cost: 0.25, latency: 0.15 },
  costBudgetUsd: 0.01,
  latencyBudgetMs: 8000,
};

const emailSpec: TaskSpec = {
  type: 'customer_update_email',
  description: 'Draft a customer-facing progress update.',
  instruction:
    'Draft a short, warm, plain-English progress update for the homeowner. No jargon, ' +
    'no industry acronyms. Never promise a date, price or insurance outcome that is not ' +
    'stated in the job record. If the record implies bad news, say it plainly and kindly.',
  inputSchema: z.object({
    jobSummary: z.string().min(1).max(10_000),
    customerName: z.string().min(1).max(120),
    orgName: z.string().min(1).max(120),
  }),
  outputSchema: z.object({
    subject: z.string().min(1).max(160),
    body: z.string().min(1),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 800,
  checks: [
    {
      name: 'no_unsupported_commitments',
      fatal: true,
      weight: 4,
      // A drafted promise about money or dates becomes a real obligation the
      // moment someone hits send. Refuse to serve one the record cannot back.
      run: (output, input) => {
        const body = (output as { body?: string }).body ?? '';
        const source = JSON.stringify(input).toLowerCase();
        const commitments = body.match(/\b(guarantee\w*|covered by insurance|no cost to you|fully paid)\b/gi) ?? [];
        const unsupported = commitments.filter((c) => !source.includes(c.toLowerCase()));
        return {
          passed: unsupported.length === 0,
          detail: unsupported.length ? `unsupported commitment: ${unsupported.join(', ')}` : undefined,
        };
      },
    },
    {
      name: 'no_internal_jargon',
      weight: 2,
      run: (output) => {
        const body = ((output as { body?: string }).body ?? '').toLowerCase();
        const jargon = ['iicrc', 's500', 'afd', 'psychrometric', 'gpp', 'xactimate'].filter((t) => body.includes(t));
        return { passed: jargon.length === 0, detail: jargon.length ? `jargon: ${jargon.join(', ')}` : undefined };
      },
    },
  ],
  rewardWeights: { quality: 0.85, cost: 0.08, latency: 0.07 },
  costBudgetUsd: 0.02,
  latencyBudgetMs: 12_000,
  highStakes: true,
};

const extractSpec: TaskSpec = {
  type: 'extract_document_fields',
  description: 'Pull structured fields out of an insurance or permit document.',
  instruction:
    'Extract the requested fields from the document text. Copy values verbatim — do not ' +
    'normalise, reformat or correct them. If a field is not present, return null for it ' +
    'and do not guess. Quote the supporting span for every field you do return.',
  inputSchema: z.object({
    documentText: z.string().min(1).max(200_000),
    fields: z.array(z.string().min(1)).min(1).max(60),
  }),
  outputSchema: z.object({
    values: z.record(z.union([z.string(), z.null()])),
    evidence: z.record(z.string()).default({}),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 2000,
  checks: [
    {
      name: 'all_fields_answered',
      fatal: true,
      weight: 3,
      run: (output, input) => {
        const requested = (input as { fields?: string[] }).fields ?? [];
        const values = (output as { values?: Record<string, unknown> }).values ?? {};
        const missing = requested.filter((f) => !(f in values));
        return { passed: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : undefined };
      },
    },
    {
      name: 'evidence_is_verbatim',
      weight: 4,
      // The strongest check in the registry: every quoted span must literally
      // occur in the source. Extraction is the one task where groundedness can
      // be verified exactly rather than approximated, so it is.
      run: (output, input) => {
        const doc = ((input as { documentText?: string }).documentText ?? '').replace(/\s+/g, ' ');
        const evidence = (output as { evidence?: Record<string, string> }).evidence ?? {};
        const fabricated = Object.entries(evidence)
          .filter(([, span]) => typeof span === 'string' && span.length > 0)
          .filter(([, span]) => !doc.includes(span.replace(/\s+/g, ' ')))
          .map(([field]) => field);
        return {
          passed: fabricated.length === 0,
          detail: fabricated.length ? `evidence not found in document: ${fabricated.join(', ')}` : undefined,
        };
      },
    },
  ],
  rewardWeights: { quality: 0.9, cost: 0.05, latency: 0.05 },
  costBudgetUsd: 0.08,
  latencyBudgetMs: 30_000,
  highStakes: true,
};

const moistureSpec: TaskSpec = {
  type: 'classify_moisture_reading',
  description: 'Classify a moisture reading against dry standard and recommend an action.',
  instruction:
    'Classify this moisture reading against the dry standard for the material. Return ' +
    'one of: dry, drying, wet, saturated. Recommend the next action. If the material or ' +
    'the dry standard is not supplied, say so in `openQuestions` and lower your confidence ' +
    'rather than assuming a standard.',
  inputSchema: z.object({
    material: z.string().min(1).max(120),
    reading: z.number(),
    unit: z.string().min(1).max(20),
    dryStandard: z.number().optional(),
    daysElapsed: z.number().nonnegative().optional(),
  }),
  outputSchema: z.object({
    classification: z.enum(['dry', 'drying', 'wet', 'saturated']),
    recommendedAction: z.string().min(1),
    openQuestions: z.array(z.string()).default([]),
    confidence,
    sourceRefs,
  }),
  json: true,
  maxOutputTokens: 500,
  checks: [
    {
      name: 'flags_missing_standard',
      weight: 3,
      // Guards the specific failure of confidently classifying against a dry
      // standard the model silently made up.
      run: (output, input) => {
        const hasStandard = (input as { dryStandard?: number }).dryStandard !== undefined;
        if (hasStandard) return { passed: true };
        const parsed = output as { openQuestions?: string[]; confidence?: number };
        const flagged = (parsed.openQuestions ?? []).length > 0 || (parsed.confidence ?? 1) < 0.7;
        return { passed: flagged, detail: flagged ? undefined : 'classified confidently with no dry standard supplied' };
      },
    },
  ],
  rewardWeights: { quality: 0.75, cost: 0.15, latency: 0.1 },
  costBudgetUsd: 0.005,
  latencyBudgetMs: 6000,
};

const SPECS: TaskSpec[] = [scopeSpec, estimateSpec, summarySpec, emailSpec, extractSpec, moistureSpec];

const specsByType = new Map<TaskType, TaskSpec>(SPECS.map((spec) => [spec.type, spec]));

export function getTaskSpec(type: TaskType): TaskSpec {
  const spec = specsByType.get(type);
  if (!spec) throw new Error(`Unknown task type: ${type}`);
  return spec;
}

export function listTaskSpecs(): TaskSpec[] {
  return SPECS;
}

export const TASK_TYPES = SPECS.map((spec) => spec.type) as [TaskType, ...TaskType[]];
