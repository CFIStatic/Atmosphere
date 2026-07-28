import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { generateBrief, writingEnabled } from '../financial/brief.js';
import { runEngine } from '../financial/engine.js';
import { formatCents, totalCashCents } from '../financial/jobCost.js';
import { ruleCatalogue } from '../financial/rules.js';
import { loadOrgSnapshot } from '../financial/snapshot.js';
import { syncConnection } from '../financial/sync.js';
import * as store from '../financial/store.js';
import { PROVIDER_LABELS } from '../financial/types.js';
import {
  accountCreateSchema,
  alertActionSchema,
  briefQuerySchema,
  connectionCreateInputSchema,
  connectionUpdateSchema,
  costCodeCreateSchema,
  jobCostCreateSchema,
  jobCostQuerySchema,
  jobCostUpdateSchema,
  settingsSchema,
} from '../financial/validation.js';

export const financeRouter = Router();

financeRouter.use(requireAuth);

const engineLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many financial runs. Wait a moment.', code: 'rate_limited' },
});

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests. Wait a moment.', code: 'rate_limited' },
});

const writingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many brief requests. Wait a moment.', code: 'rate_limited' },
});

async function ctxOf(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const org = await store.resolveOrgContext(supabase, req.user!.id);
  return { supabase, org, userId: req.user!.id };
}

/**
 * GET /api/finance/overview
 * CFO cockpit: cash, AR, job cost, alerts, connections.
 */
financeRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const snapshot = await loadOrgSnapshot(supabase, org.orgId);
    const alerts = await store.listAlerts(supabase, org.orgId, { limit: 200 });

    const cashCents = totalCashCents(snapshot.accounts);
    const openArCents = snapshot.rollups.reduce((s, r) => s + r.openArCents, 0);
    const totalCostCents = snapshot.rollups.reduce((s, r) => s + r.costCents, 0);
    const totalContractCents = snapshot.rollups.reduce(
      (s, r) => s + (r.contractCents ?? 0),
      0,
    );

    res.json({
      settings: snapshot.settings,
      role: org.role,
      canManage: org.canManage,
      writingEnabled: writingEnabled(),
      providers: PROVIDER_LABELS,
      health: {
        cashCents,
        cashFloorCents: snapshot.settings.cashFloorCents,
        openArCents,
        totalCostCents,
        totalContractCents,
        marginPct:
          totalContractCents > 0
            ? ((totalContractCents - totalCostCents) / totalContractCents) * 100
            : null,
      },
      counts: {
        jobs: snapshot.jobs.length,
        connections: snapshot.connections.length,
        accounts: snapshot.accounts.length,
        critical: alerts.filter((a) => a.severity === 'critical' && a.status === 'open').length,
        warn: alerts.filter((a) => a.severity === 'warn' && a.status === 'open').length,
      },
      alerts,
      jobs: snapshot.rollups,
      connections: snapshot.connections,
      accounts: snapshot.accounts,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Engine / brief / settings
 * ------------------------------------------------------------------ */

financeRouter.post('/run', engineLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : undefined;
    const result = await runEngine(supabase, org.orgId, {
      jobId,
      actorType: 'user',
      actorUserId: userId,
    });
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

financeRouter.get('/brief', writingLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const q = briefQuerySchema.parse(req.query);
    const brief = await generateBrief(supabase, org.orgId, userId, { refresh: q.refresh });
    res.json({ brief });
  } catch (err) {
    next(err);
  }
});

financeRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const settings = await store.getSettings(supabase, org.orgId);
    res.json({
      settings,
      rules: ruleCatalogue(),
      canManage: org.canManage,
      writingEnabled: writingEnabled(),
    });
  } catch (err) {
    next(err);
  }
});

financeRouter.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.assertCanManage(org);
    const patch = settingsSchema.parse(req.body);
    const settings = await store.upsertSettings(supabase, org.orgId, patch);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

financeRouter.post(
  '/alerts/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      const body = alertActionSchema.parse(req.body);
      const alert = await store.actOnAlert(
        supabase,
        req.params.id,
        org.orgId,
        body.status,
        userId,
        body.snoozeHours,
      );
      res.json({ alert });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

financeRouter.get('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const connections = await store.listConnections(supabase, org.orgId);
    res.json({ connections, providers: PROVIDER_LABELS, canManage: org.canManage });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/connections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.assertCanManage(org);
    const input = connectionCreateInputSchema.parse(req.body);
    const connection = await store.createConnection(
      supabase,
      org.orgId,
      input,
      userId,
    );
    res.status(201).json({ connection });
  } catch (err) {
    next(err);
  }
});

financeRouter.patch(
  '/connections/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      store.assertCanManage(org);
      const patch = connectionUpdateSchema.parse(req.body);
      const connection = await store.updateConnection(
        supabase,
        req.params.id,
        org.orgId,
        patch,
      );
      res.json({ connection });
    } catch (err) {
      next(err);
    }
  },
);

financeRouter.post(
  '/connections/:id/sync',
  syncLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      store.assertCanManage(org);
      const connections = await store.listConnections(supabase, org.orgId);
      const connection = connections.find((c) => c.id === req.params.id);
      if (!connection) throw new HttpError(404, 'Connection not found.', 'finance_not_found');
      const result = await syncConnection(supabase, org.orgId, connection, userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Accounts / cost codes / job costs
 * ------------------------------------------------------------------ */

financeRouter.get('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const accounts = await store.listAccounts(supabase, org.orgId);
    res.json({ accounts, cashCents: totalCashCents(accounts), canManage: org.canManage });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.assertCanManage(org);
    const input = accountCreateSchema.parse(req.body);
    const account = await store.createAccount(supabase, org.orgId, input);
    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
});

financeRouter.get('/cost-codes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const costCodes = await store.ensureDefaultCostCodes(supabase, org.orgId);
    res.json({ costCodes, canManage: org.canManage });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/cost-codes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.assertCanManage(org);
    const input = costCodeCreateSchema.parse(req.body);
    const costCode = await store.createCostCode(supabase, org.orgId, input);
    res.status(201).json({ costCode });
  } catch (err) {
    next(err);
  }
});

financeRouter.get('/job-costs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const q = jobCostQuerySchema.parse(req.query);
    const costs = await store.listJobCosts(supabase, org.orgId, q);
    res.json({ costs, canManage: org.canManage });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/job-costs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.assertCanManage(org);
    const input = jobCostCreateSchema.parse(req.body);
    const cost = await store.createJobCost(supabase, org.orgId, input, userId);
    res.status(201).json({ cost });
  } catch (err) {
    next(err);
  }
});

financeRouter.patch(
  '/job-costs/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      store.assertCanManage(org);
      const patch = jobCostUpdateSchema.parse(req.body);
      const cost = await store.updateJobCost(supabase, req.params.id, org.orgId, patch);
      res.json({ cost });
    } catch (err) {
      next(err);
    }
  },
);

financeRouter.get('/job-costs/rollups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const snapshot = await loadOrgSnapshot(supabase, org.orgId);
    res.json({
      jobs: snapshot.rollups,
      totals: {
        costCents: snapshot.rollups.reduce((s, r) => s + r.costCents, 0),
        openArCents: snapshot.rollups.reduce((s, r) => s + r.openArCents, 0),
        contractCents: snapshot.rollups.reduce((s, r) => s + (r.contractCents ?? 0), 0),
      },
      formatHint: formatCents(0),
    });
  } catch (err) {
    next(err);
  }
});
