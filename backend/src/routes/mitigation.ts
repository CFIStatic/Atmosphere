import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { buildEstimate, identifyFromSources } from '../estimator/mitigation/agent.js';
import { MockSlaSource, ManualSlaSource, PortalSlaSource, parseAgreement, resolveAgreement, type SlaSource } from '../estimator/mitigation/carrier/source.js';
import { CARRIERS, PROGRAMS } from '../estimator/mitigation/carrier/identify.js';
import { buildEstimatorConfig } from '../estimator/mitigation/settings.js';
import { CATALOG } from '../estimator/mitigation/catalog/lineItems.js';
import {
  CITATIONS,
  formatCitation,
  S500_EDITION,
  S520_EDITION,
} from '../estimator/mitigation/standards/s500.js';
import { toLineItemCsv, toScopeSheet, toSketchXml } from '../estimator/mitigation/export/xactimateExport.js';
import {
  agreementFetchSchema,
  agreementSchema,
  buildEstimateSchema,
  deviationSchema,
  estimatorSettingsSchema,
  exportFormatSchema,
} from '../estimator/mitigation/validation.js';
import {
  deleteAgreement,
  deleteDeviation,
  getAgreement,
  getEstimate,
  getPriceList,
  getSettings,
  listAgreements,
  listDeviations,
  listJobs,
  resolveOrgId,
  saveAgreement,
  saveDeviation,
  saveEstimate,
  saveSettings,
  getConnection,
} from '../estimator/mitigation/store.js';

export const mitigationRouter = Router();

mitigationRouter.use(requireAuth);

/**
 * Building an estimate parses several megabytes of vendor export and runs the
 * whole rule set, so it is metered — not against abuse so much as against a
 * client that re-fires on every keystroke of a notes field.
 */
const buildLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many estimate builds. Wait a moment and try again.', code: 'rate_limited' },
});

/**
 * Resolve everything an estimate run needs: the caller's org, its settings, and
 * the price list their Xactimate connection selected.
 */
async function loadContext(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const userId = req.user!.id;
  const orgId = await resolveOrgId(supabase, userId);
  const stored = await getSettings(supabase, orgId);

  const connection = await getConnection(supabase, userId);
  const priceList = connection?.priceListId
    ? await getPriceList(supabase, orgId, connection.priceListId)
    : null;

  return { supabase, userId, orgId, stored, priceList };
}

/**
 * Resolve the program agreement for a job before it is priced.
 *
 * The carrier has to be known first, so the sources are normalised once here to
 * identify it. The org's own hand-entered agreement is preferred over anything a
 * portal serves — a hand-entered agreement was read by someone at the franchise
 * who is accountable for it; a portal response is a system's opinion.
 */
async function resolveJobAgreement(
  supabase: ReturnType<typeof createUserClient>,
  orgId: string,
  input: { docusketch?: unknown; mica?: unknown; photos?: unknown; notes?: string; carrier?: { carrierId?: string; programId?: string } },
) {
  const identification = identifyFromSources(input as never, { override: input.carrier });
  if (!identification.carrierId) return { identification, agreement: null, errors: [] as string[] };

  const sources: SlaSource[] = [
    new ManualSlaSource((lookup) => getAgreement(supabase, orgId, lookup.carrierId, lookup.programId)),
  ];

  // The remote sources are added only when configured. An unconfigured portal
  // throwing on construction would take down the manual path with it.
  try {
    if (config.sla.source === 'portal') sources.push(new PortalSlaSource());
    if (config.sla.source === 'mock') sources.push(new MockSlaSource());
  } catch {
    // Reported through `errors` below rather than thrown — a missing portal
    // config must not stop an estimate being built from local terms.
  }

  const { agreement, errors } = await resolveAgreement(
    { carrierId: identification.carrierId, programId: identification.programId },
    sources,
  );
  return { identification, agreement, errors };
}

/**
 * POST /api/mitigation/build
 *
 * Build an estimate from raw sources without saving anything. This is the
 * endpoint the UI calls while the user is still adding sources and adjusting
 * assumptions — an estimate is cheap to recompute and there is no reason to
 * litter the database with drafts.
 */
mitigationRouter.post(
  '/build',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = buildEstimateSchema.parse(req.body);
      const { supabase, orgId, stored, priceList } = await loadContext(req);

      const { config, warnings } = buildEstimatorConfig(
        {
          ...stored,
          ...(input.settings ?? {}),
          codeOverrides: {
            ...(stored.codeOverrides ?? {}),
            ...(input.settings?.codeOverrides ?? {}),
            ...(input.codeOverrides ?? {}),
          },
        },
        priceList,
      );

      const { agreement, errors } = await resolveJobAgreement(supabase, orgId, input);
      const deviations = input.jobId ? await listDeviations(supabase, orgId, input.jobId) : [];

      const estimate = buildEstimate(
        {
          jobId: input.jobId,
          docusketch: input.docusketch,
          mica: input.mica,
          photos: input.photos,
          notes: input.notes,
          overrides: input.overrides,
        },
        { ...config, agreement, deviations, carrier: { override: input.carrier } },
      );

      res.json({
        estimate: {
          ...estimate,
          openQuestions: [...new Set([...estimate.openQuestions, ...warnings, ...errors])],
        },
        priceListConnected: Boolean(priceList),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/estimates
 *
 * Build and persist. Separate from /build on purpose: saving is the deliberate
 * act, and it is the one that puts claim data in the database.
 */
mitigationRouter.post(
  '/estimates',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = buildEstimateSchema.parse(req.body);
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);

      const { config, warnings } = buildEstimatorConfig(
        {
          ...stored,
          ...(input.settings ?? {}),
          codeOverrides: {
            ...(stored.codeOverrides ?? {}),
            ...(input.settings?.codeOverrides ?? {}),
            ...(input.codeOverrides ?? {}),
          },
        },
        priceList,
      );

      const { agreement, errors } = await resolveJobAgreement(supabase, orgId, input);
      const deviations = input.jobId ? await listDeviations(supabase, orgId, input.jobId) : [];

      const estimate = buildEstimate(
        {
          jobId: input.jobId,
          docusketch: input.docusketch,
          mica: input.mica,
          photos: input.photos,
          notes: input.notes,
          overrides: input.overrides,
        },
        { ...config, agreement, deviations, carrier: { override: input.carrier } },
      );
      estimate.openQuestions = [...new Set([...estimate.openQuestions, ...warnings, ...errors])];

      const name =
        estimate.assessment.propertyAddress ??
        estimate.assessment.claimNumber ??
        `Mitigation estimate ${new Date().toISOString().slice(0, 10)}`;

      const record = await saveEstimate(supabase, { orgId, userId, name, estimate });

      res.status(201).json({ estimateId: record.id, jobId: record.jobId, estimate });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/mitigation/standards
 *
 * The full IICRC citation registry — every requirement the estimator reasons
 * from, how firmly each is anchored, and where a familiar "the S500 requires…"
 * is really industry convention. Published because an estimator defending a
 * scope needs to know which of their citations is a clause and which is custom.
 */
mitigationRouter.get('/standards', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      editions: { s500: S500_EDITION, s520: S520_EDITION },
      note: 'The ANSI/IICRC S500 and S520 are copyrighted publications of the IICRC and are not reproduced here. Each requirement below is a paraphrase; the location is given so a reader with their own copy can turn to it.',
      references: Object.values(CITATIONS).map((reference) => ({
        ...reference,
        formatted: formatCitation(reference.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/mitigation/demo-sources
 *
 * The worked example, so the estimator can be evaluated before anyone uploads a
 * real claim. It is a Category 2 appliance loss that sat two days, with a wet
 * wall cavity and an equipment log left open — enough to exercise the paths that
 * matter without any customer data changing hands.
 */
mitigationRouter.get('/demo-sources', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { SAMPLE_JOB } = await import('../estimator/mitigation/fixtures/sampleJob.js');
    res.json({ sources: SAMPLE_JOB });
  } catch (err) {
    next(err);
  }
});

/** GET /api/mitigation/jobs — the org's estimating jobs, newest first. */
mitigationRouter.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ jobs: await listJobs(supabase, orgId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/mitigation/estimates/:id */
mitigationRouter.get('/estimates/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const record = await getEstimate(supabase, req.params.id);
    // RLS already hides other orgs' rows, so "not visible" and "not there" are
    // the same answer and neither confirms the id exists.
    if (!record) throw new HttpError(404, 'That estimate was not found.', 'estimate_not_found');
    res.json({ estimate: record.estimate, savedAt: record.createdAt });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/mitigation/estimates/:id/export?format=csv|xml|scope
 *
 * The route that needs no Xactimate login at all: download the file, import it
 * by hand. For most orgs this is the whole integration.
 */
mitigationRouter.get(
  '/estimates/:id/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { format } = exportFormatSchema.parse(req.query);
      const supabase = createUserClient(req.accessToken!);
      const record = await getEstimate(supabase, req.params.id);
      if (!record) throw new HttpError(404, 'That estimate was not found.', 'estimate_not_found');

      const base = `estimate-${record.id.slice(0, 8)}`;

      if (format === 'csv') {
        res.type('text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}-line-items.csv"`);
        res.send(toLineItemCsv(record.estimate.lineItems));
        return;
      }
      if (format === 'xml') {
        res.type('application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}-sketch.xml"`);
        res.send(toSketchXml(record.estimate));
        return;
      }

      res.type('text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}-scope.txt"`);
      res.send(toScopeSheet(record.estimate));
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/mitigation/settings — the org's estimating assumptions. */
mitigationRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ settings: await getSettings(supabase, orgId) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/mitigation/settings */
mitigationRouter.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = estimatorSettingsSchema.parse(req.body);
    if (!parsed) throw badRequest('Nothing to save.');

    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ settings: await saveSettings(supabase, orgId, parsed) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/mitigation/catalog
 *
 * The line-item catalog the estimator can write, with each entry's verification
 * state. Exposed so the UI can be honest about which prices are real.
 */
mitigationRouter.get('/catalog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const orgId = await resolveOrgId(supabase, userId);
    const connection = await getConnection(supabase, userId);
    const priceList = connection?.priceListId
      ? await getPriceList(supabase, orgId, connection.priceListId)
      : null;

    const { config } = buildEstimatorConfig(await getSettings(supabase, orgId), priceList);

    res.json({
      priceListId: priceList?.id ?? null,
      verifiedCount: config.catalog.filter((item) => item.verified).length,
      totalCount: config.catalog.length,
      items: config.catalog.map((item) => ({
        code: item.code,
        category: item.category,
        description: item.description,
        unit: item.unit,
        unitPrice: item.defaultUnitPrice,
        unitCost: item.defaultUnitCost,
        verified: item.verified,
        note: item.note,
      })),
      seedCount: CATALOG.length,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Carrier program agreements
 * ------------------------------------------------------------------ */

/**
 * GET /api/mitigation/carriers
 *
 * The carriers and assignment networks the identifier recognises, so the UI can
 * offer a correction rather than making someone guess the canonical id.
 */
mitigationRouter.get('/carriers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      carriers: CARRIERS.map(({ id, name }) => ({ id, name })),
      programs: PROGRAMS.map(({ id, name }) => ({ id, name })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/mitigation/agreements — the org's loaded program terms. */
mitigationRouter.get('/agreements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const orgId = await resolveOrgId(supabase, req.user!.id);
    res.json({ agreements: await listAgreements(supabase, orgId), source: config.sla.source });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/mitigation/agreements
 *
 * Enter a program agreement's terms by hand. This is the source that always
 * works and the only one guaranteed to match what the franchise actually
 * signed — someone reads the contract and records what it requires.
 */
mitigationRouter.put('/agreements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = agreementSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const userId = req.user!.id;
    const orgId = await resolveOrgId(supabase, userId);

    const agreement = parseAgreement(input, {
      kind: 'manual',
      reference: `entered by hand — ${input.carrier.name} / ${input.program.name}`,
      enteredBy: req.user!.email ?? userId,
    });

    await saveAgreement(supabase, orgId, userId, agreement);
    res.status(201).json({ agreement });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mitigation/agreements/fetch
 *
 * Pull terms from the configured franchisor contractor portal.
 *
 * Deliberately does not save what it retrieves. Program terms decide what the
 * franchise may bill, so a human reviews what came back and stores it via PUT —
 * a portal response that silently became the org's binding terms would be a bad
 * way to discover an endpoint had changed shape.
 */
mitigationRouter.post(
  '/agreements/fetch',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { carrierId, programId } = agreementFetchSchema.parse(req.body);

      if (config.sla.source === 'manual') {
        throw new HttpError(
          400,
          'This server is configured for hand-entered program terms only. Set SLA_SOURCE=portal with a contractor-portal endpoint, or enter the agreement under Agreements.',
          'sla_source_manual',
        );
      }

      const source = config.sla.source === 'portal' ? new PortalSlaSource() : new MockSlaSource();
      const agreement = await source.fetchAgreement({ carrierId, programId });

      if (!agreement) {
        throw new HttpError(
          404,
          `No agreement came back for ${carrierId}${programId ? ` via ${programId}` : ''}. Enter the terms by hand rather than estimating without them.`,
          'agreement_not_found',
        );
      }

      res.json({ agreement, saved: false });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/mitigation/agreements/:carrierId/:programId */
mitigationRouter.delete(
  '/agreements/:carrierId/:programId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const orgId = await resolveOrgId(supabase, req.user!.id);
      await deleteAgreement(supabase, orgId, req.params.carrierId, req.params.programId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Deviations
 * ------------------------------------------------------------------ */

/** GET /api/mitigation/jobs/:jobId/deviations */
mitigationRouter.get(
  '/jobs/:jobId/deviations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const orgId = await resolveOrgId(supabase, req.user!.id);
      res.json({ deviations: await listDeviations(supabase, orgId, req.params.jobId) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/jobs/:jobId/deviations
 *
 * Accept a deviation from a program term.
 *
 * The evidence ids are checked against the job's own build, not taken on trust.
 * A deviation citing evidence that is not in the file would look documented on
 * the page and be worthless on review, which is the precise failure this whole
 * mechanism exists to prevent.
 */
mitigationRouter.post(
  '/jobs/:jobId/deviations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = deviationSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const userId = req.user!.id;
      const orgId = await resolveOrgId(supabase, userId);

      await saveDeviation(supabase, orgId, userId, req.params.jobId, {
        ruleId: input.ruleId,
        reason: input.reason,
        evidenceIds: input.evidenceIds,
        authorizedBy: input.authorizedBy ?? req.user!.email ?? undefined,
        authorizedAt: new Date().toISOString(),
      });

      res.status(201).json({ deviations: await listDeviations(supabase, orgId, req.params.jobId) });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/mitigation/jobs/:jobId/deviations/:ruleId */
mitigationRouter.delete(
  '/jobs/:jobId/deviations/:ruleId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const orgId = await resolveOrgId(supabase, req.user!.id);
      await deleteDeviation(supabase, orgId, req.params.jobId, req.params.ruleId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
