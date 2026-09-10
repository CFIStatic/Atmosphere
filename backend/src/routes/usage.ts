import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrg } from '../middleware/requireOrg.js';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { toNanos } from '../lib/money.js';
import { billingError, serializeBalance } from '../lib/billing.js';
import { quoteUsageSchema, recordUsageSchema } from '../lib/validation.js';

export const usageRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

usageRouter.use(requireAuth, requireOrg);

/**
 * Metering is the hot path — one call per model request. The cap is generous
 * enough not to interfere with real traffic but stops a runaway client from
 * hammering the ledger.
 */
const meterLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many metering requests', code: 'rate_limited' },
});

/** Turn the validated body into the RPC's parameter names. */
function usageParams(orgId: string, input: ReturnType<typeof quoteUsageSchema.parse>) {
  return {
    p_org: orgId,
    p_model_id: input.modelId,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cache_write_5m_tokens: input.cacheWrite5mTokens,
    p_cache_write_1h_tokens: input.cacheWrite1hTokens,
    p_cache_read_tokens: input.cacheReadTokens,
    p_is_batch: input.isBatch,
  };
}

function serializeBreakdown(raw: any) {
  const part = (k: string) => ({
    tokens: Number(raw?.[k]?.tokens ?? 0),
    priceNanos: toNanos(raw?.[k]?.price_nanos ?? 0),
  });
  return {
    input: part('input'),
    output: part('output'),
    cacheWrite5m: part('cache_write_5m'),
    cacheWrite1h: part('cache_write_1h'),
    cacheRead: part('cache_read'),
  };
}

/**
 * POST /api/usage/quote
 * Price a call without charging for it. Used to show an estimate before a run
 * and to power the pricing calculator. Never touches the balance.
 */
usageRouter.post('/quote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = quoteUsageSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { p_org: _org, ...params } = usageParams(req.orgId!, input);
    const { data, error } = await supabase.rpc('quote_usage', params);
    if (error) throw billingError(error);

    const row = data as any;
    res.json({
      modelId: row.model_id,
      isBatch: Boolean(row.is_batch),
      priceNanos: toNanos(row.price_nanos),
      breakdown: serializeBreakdown(row.breakdown),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/usage/record
 *
 * Meters a model call from CALLER-SUPPLIED token counts: prices it, debits
 * credits (plan allowance first, then purchased), and appends the usage event
 * and ledger rows in one transaction.
 *
 * `requestId` is an idempotency key — replaying it returns the original charge
 * rather than billing twice, so a client that retries after a timeout cannot be
 * double-charged. Returns 402 when the balance or the spend limit blocks it.
 *
 * Disabled by default in production. Token counts decide revenue, so the
 * trustworthy source is the provider's own `usage` object via POST
 * /api/ai/messages — a browser reporting its own counts could under-report and
 * spend our margin. Set ALLOW_CLIENT_METERING=true only for trusted
 * server-to-server metering of work performed outside this process.
 */
usageRouter.post('/record', meterLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.billing.allowClientMetering) {
      throw forbidden(
        'Client-reported usage is disabled. Route model calls through /api/ai/messages so usage is metered from the provider response.',
        'client_metering_disabled',
      );
    }

    const input = recordUsageSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase.rpc('record_usage', {
      ...usageParams(req.orgId!, input),
      p_request_id: input.requestId,
      p_feature: input.feature ?? null,
    });
    if (error) throw billingError(error);

    const row = data as any;
    res.status(201).json({
      eventId: row.event_id,
      priceNanos: toNanos(row.price_nanos),
      duplicate: Boolean(row.duplicate),
      breakdown: serializeBreakdown(row.breakdown),
      balance: serializeBalance(row.balance),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/usage/events — recent metered calls. */
usageRouter.get('/events', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // events table dropped — sold path uses token_usage_events / metering.
    res.json({ events: [] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/usage/daily?days=30
 * Pre-aggregated daily totals for the usage chart. Reads the rollup table
 * maintained by trigger, so this never scans the raw event stream.
 */
usageRouter.get('/daily', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // daily table dropped — sold path uses token_usage_events / metering.
    res.json({ days: [] });
  } catch (err) {
    next(err);
  }
});
