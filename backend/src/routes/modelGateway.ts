import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { HttpError, paymentRequired } from '../lib/errors.js';
import { toNanos } from '../lib/money.js';
import { billingError, serializeBalance } from '../lib/billing.js';
import { anthropicClient, describeIterations, extractUsage } from '../lib/anthropic.js';
import { recordAiUsageEventAsync } from '../metering/usageEvents.js';
import { recordTokenUsageAsync } from '../metering/tokenUsage.js';

export const modelGatewayRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

modelGatewayRouter.use(requireAuth, requireOrg);

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(z.any())]),
});

const completionSchema = z.object({
  model: z.string().trim().min(1).max(128).optional(),
  messages: z.array(messageSchema).min(1, 'At least one message is required'),
  system: z.union([z.string(), z.array(z.any())]).optional(),
  maxTokens: z.number().int().min(1).max(64_000).default(8_192),
  // Adaptive thinking is the current mode; a fixed token budget is not accepted
  // by the models this app targets.
  thinking: z.boolean().default(false),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  feature: z.string().trim().max(64).optional(),
  /** Idempotency key for the resulting charge; generated when absent. */
  requestId: z.string().trim().min(1).max(200).optional(),
});

const countSchema = z.object({
  model: z.string().trim().min(1).max(128).optional(),
  messages: z.array(messageSchema).min(1),
  system: z.union([z.string(), z.array(z.any())]).optional(),
});

/** Build the provider request shared by the count and completion paths. */
function providerParams(input: { model?: string; messages: any[]; system?: unknown }) {
  return {
    model: input.model ?? config.anthropic.defaultModel,
    messages: input.messages as any,
    ...(input.system ? { system: input.system as any } : {}),
  };
}

/**
 * POST /api/model/count-tokens
 *
 * Exact pre-flight token count from the provider's own tokenizer, plus what the
 * input would cost. This is a real count, not an approximation — character
 * heuristics and third-party tokenizers do not match and would misprice.
 */
modelGatewayRouter.post('/count-tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = countSchema.parse(req.body);
    const params = providerParams(input);

    const counted = await anthropicClient().messages.countTokens(params as any);
    const inputTokens = counted.input_tokens;

    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase.rpc('quote_usage', {
      p_model_id: params.model,
      p_input_tokens: inputTokens,
      p_output_tokens: 0,
      p_cache_write_5m_tokens: 0,
      p_cache_write_1h_tokens: 0,
      p_cache_read_tokens: 0,
      p_is_batch: false,
    });
    if (error) throw billingError(error);

    res.json({
      model: params.model,
      inputTokens,
      inputPriceNanos: toNanos((data as any)?.price_nanos ?? 0),
    });
  } catch (err) {
    next(mapProviderError(err));
  }
});

/**
 * POST /api/model/messages
 *
 * Runs a model call and meters it. This is the only path that should ever
 * produce a charge, because it is the only one where the token counts come from
 * the provider rather than from the caller.
 *
 * The flow is authorize-then-capture, the same shape a card payment uses:
 *
 *   1. Count the input exactly, and price the worst case (that input plus a
 *      full `maxTokens` of output).
 *   2. Refuse with 402 if the balance cannot cover that worst case — checked
 *      BEFORE the upstream call, so we never buy tokens we cannot bill for.
 *   3. Make the call.
 *   4. Meter the ACTUAL usage from the response, which is almost always less
 *      than the authorized worst case.
 *
 * Step 2 is what stops an organization from running its balance negative, and
 * step 4 is what stops us from overcharging for output that was never produced.
 */
modelGatewayRouter.post('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = completionSchema.parse(req.body);
    const params = providerParams(input);
    const supabase = createUserClient(req.accessToken!);
    const client = anthropicClient();

    // --- 1. Exact pre-flight count -----------------------------------------
    const counted = await client.messages.countTokens(params as any);

    // --- 2. Authorize the worst case ---------------------------------------
    const { data: quote, error: quoteError } = await supabase.rpc('quote_usage', {
      p_model_id: params.model,
      p_input_tokens: counted.input_tokens,
      p_output_tokens: input.maxTokens,
      p_cache_write_5m_tokens: 0,
      p_cache_write_1h_tokens: 0,
      p_cache_read_tokens: 0,
      p_is_batch: false,
    });
    if (quoteError) throw billingError(quoteError);

    const authorizedNanos = toNanos((quote as any)?.price_nanos ?? 0);

    const { data: balanceRaw, error: balanceError } = await supabase.rpc('credit_balance', {
      p_org: req.orgId,
    });
    if (balanceError) throw billingError(balanceError);
    const balance = serializeBalance(balanceRaw);

    if (balance.totalNanos < authorizedNanos) {
      throw paymentRequired(
        'Not enough credits to cover this request. Top up your balance to continue.',
        'insufficient_credits',
      );
    }

    // --- 3. Run the call ----------------------------------------------------
    // Streamed so a long generation cannot trip an HTTP timeout; the final
    // message carries the authoritative usage totals.
    const stream = client.messages.stream({
      ...(params as any),
      max_tokens: input.maxTokens,
      ...(input.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
      ...(input.effort ? { output_config: { effort: input.effort } } : {}),
    });
    const message = await stream.finalMessage();

    // --- 4. Meter the actuals ----------------------------------------------
    const usage = extractUsage(message.usage);

    const iterations = describeIterations(message.usage);
    if (iterations) {
      console.warn(`[usage] response billed across multiple attempts (${iterations})`);
    }

    const requestId = input.requestId ?? randomUUID();

    const { data: charge, error: chargeError } = await supabase.rpc('record_usage', {
      p_org: req.orgId,
      // Bill against the model that actually served the response — a
      // server-side fallback can answer on a different model than requested.
      p_model_id: message.model ?? params.model,
      p_request_id: requestId,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cache_write_5m_tokens: usage.cacheWrite5mTokens,
      p_cache_write_1h_tokens: usage.cacheWrite1hTokens,
      p_cache_read_tokens: usage.cacheReadTokens,
      p_is_batch: false,
      p_feature: input.feature ?? null,
    });
    if (chargeError) throw billingError(chargeError);
    const charged = charge as any;

    recordAiUsageEventAsync(supabase, {
      orgId: req.orgId!,
      idempotencyKey: `model:${requestId}`,
      actionType: 'model_completion',
      provider: 'anthropic',
      model: message.model ?? params.model,
      userId: req.user?.id ?? null,
      workflowId: input.feature ?? null,
      agentType: 'model_gateway',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
      metadata: { feature: input.feature ?? null },
    });

    const { data: actualQuote } = await supabase.rpc('quote_usage', {
      p_model_id: message.model ?? params.model,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cache_write_5m_tokens: usage.cacheWrite5mTokens,
      p_cache_write_1h_tokens: usage.cacheWrite1hTokens,
      p_cache_read_tokens: usage.cacheReadTokens,
      p_is_batch: false,
    });
    const providerCostNanos = toNanos((actualQuote as { cost_nanos?: unknown } | null)?.cost_nanos ?? 0);

    recordTokenUsageAsync(supabase, {
      orgId: req.orgId!,
      requestId: `model:${requestId}`,
      feature: input.feature ?? 'chat',
      source: 'model_gateway',
      userId: req.user?.id ?? null,
      modelId: message.model ?? params.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
      costNanos: providerCostNanos > 0 ? providerCostNanos : undefined,
      priceNanos: providerCostNanos > 0 ? undefined : toNanos(charged.price_nanos),
      metadata: { feature: input.feature ?? null },
    });

    res.json({
      id: message.id,
      model: message.model,
      stopReason: message.stop_reason,
      content: message.content,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheWrite5mTokens: usage.cacheWrite5mTokens,
        cacheWrite1hTokens: usage.cacheWrite1hTokens,
        cacheReadTokens: usage.cacheReadTokens,
        totalTokens: usage.totalTokens,
      },
      billing: {
        authorizedNanos,
        chargedNanos: toNanos(charged.price_nanos),
        duplicate: Boolean(charged.duplicate),
        balance: serializeBalance(charged.balance),
      },
    });
  } catch (err) {
    next(mapProviderError(err));
  }
});

/** Surface upstream provider failures as clean, non-leaky HTTP errors. */
function mapProviderError(err: unknown): unknown {
  if (err instanceof HttpError) return err;

  const anyErr = err as { status?: number; name?: string; message?: string };
  if (typeof anyErr?.status === 'number' && anyErr.status >= 400) {
    if (anyErr.status === 429) {
      return new HttpError(429, 'The model provider is rate limiting this request.', 'provider_rate_limited');
    }
    if (anyErr.status >= 500) {
      return new HttpError(503, 'The model provider is unavailable.', 'provider_unavailable');
    }
    return new HttpError(400, anyErr.message ?? 'The model provider rejected this request.', 'provider_rejected');
  }

  return err;
}
