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
  captureImportSchema,
  captureSyncSchema,
  deviationSchema,
  dryingReportSchema,
  estimatorSettingsSchema,
  exportFormatSchema,
  rebuildEstimateSchema,
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
  listDryingReports,
  listJobs,
  resolveOrgId,
  saveAgreement,
  saveDeviation,
  saveDryingReport,
  saveEstimate,
  saveJobSources,
  saveSettings,
  getConnection,
} from '../estimator/mitigation/store.js';
import { normalizeSources } from '../estimator/mitigation/ingest/index.js';
import { buildEquipmentPlan } from '../estimator/mitigation/planning/equipmentPlan.js';
import {
  dryingReportFromManual,
  mergeDryingReports,
  type DryingReport,
} from '../estimator/mitigation/planning/dryingProgress.js';
import { syncCaptureAndRebuild } from '../estimator/mitigation/capture/sync.js';
import { buildCaptureConnectors, captureMode } from '../estimator/mitigation/capture/connectors.js';
import {
  listOpenCaptureJobs,
  readCaptureAgentStatus,
  runCaptureAgentForJob,
  runCaptureAgentPass,
} from '../estimator/mitigation/capture/agent.js';
import { createAdminClient } from '../lib/supabase.js';
import type { MaterialType } from '../estimator/mitigation/types.js';

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
          dryingReports: normalizeDryingReports(input.dryingReports),
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
          dryingReports: normalizeDryingReports(input.dryingReports),
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

      // Persist sources so MICA Dash / Outlook sync can auto-rebuild later
      // without the client re-posting the whole scan.
      await saveJobSources(supabase, orgId, estimate.jobId, {
        jobId: estimate.jobId,
        docusketch: input.docusketch,
        mica: input.mica,
        photos: input.photos,
        notes: input.notes,
        claimNumber: estimate.assessment.claimNumber,
        updatedAt: new Date().toISOString(),
      });

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

/* ------------------------------------------------------------------ *
 * Drying reports + progress
 * ------------------------------------------------------------------ */

/**
 * POST /api/mitigation/jobs/:jobId/drying-reports
 *
 * Append a visit report. Persisted under estimator_settings.settings.dryingReports
 * keyed by the job's external id.
 */
mitigationRouter.post(
  '/jobs/:jobId/drying-reports',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = dryingReportSchema.parse(req.body);
      const supabase = createUserClient(req.accessToken!);
      const orgId = await resolveOrgId(supabase, req.user!.id);
      const jobId = req.params.jobId;

      const report: DryingReport = {
        ...dryingReportFromManual({
          takenAt: parsed.takenAt,
          notes: parsed.notes,
          moistureReadings: parsed.moistureReadings?.map((r) => ({
            ...r,
            material: r.material as MaterialType,
          })),
          psychrometrics: parsed.psychrometrics,
          equipment: parsed.equipment,
          roomsAtDryStandard: parsed.roomsAtDryStandard,
          roomsStillWet: parsed.roomsStillWet,
        }),
        id: parsed.id ?? `report-${Date.now().toString(36)}`,
        source: parsed.source,
        evidence: parsed.evidence,
      };

      const reports = await saveDryingReport(supabase, orgId, jobId, report);
      res.status(201).json({ report, reports });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/mitigation/jobs/:jobId/progress
 *
 * Merge stored drying reports onto a baseline assessment and return the
 * equipment plan + drying progress for the job.
 */
mitigationRouter.get(
  '/jobs/:jobId/progress',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, stored, priceList } = await loadContext(req);
      const jobId = req.params.jobId;
      const reports = await listDryingReports(supabase, orgId, jobId);

      const baseline = normalizeSources({ jobId });
      const merged = mergeDryingReports(reports, {
        moistureReadings: baseline.moistureReadings,
        psychrometrics: baseline.psychrometrics,
        equipment: baseline.equipment,
        evidence: baseline.evidence,
        dryingDays: baseline.dryingDays,
        monitoringVisits: baseline.monitoringVisits,
      });

      const assessment = {
        ...baseline,
        moistureReadings: merged.moistureReadings,
        psychrometrics: merged.psychrometrics,
        equipment: merged.equipment,
        evidence: merged.evidence,
        dryingDays: merged.dryingDays,
        monitoringVisits: merged.monitoringVisits,
        warnings: [...baseline.warnings, ...merged.warnings],
      };

      const { config } = buildEstimatorConfig(stored, priceList);
      const equipmentPlan = buildEquipmentPlan(assessment, {
        billingMode: config.scope.equipmentBillingMode,
        planCutHeightIn: config.scope.planCutHeightIn,
        preferInjectidryWhenSalvageable: assessment.category < 3,
      });

      res.json({
        jobId,
        reports,
        dryingProgress: merged.progress,
        equipmentPlan,
        assessment,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/jobs/:jobId/rebuild
 *
 * Load stored drying reports, merge with body sources (when provided), and
 * rebuild the estimate. Optionally persist.
 */
mitigationRouter.post(
  '/jobs/:jobId/rebuild',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = rebuildEstimateSchema.parse(req.body);
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);
      const jobId = req.params.jobId;

      const storedReports = await listDryingReports(supabase, orgId, jobId);
      const bodyReports = normalizeDryingReports(input.dryingReports) ?? [];
      // Body reports win on id collision; otherwise append.
      const byId = new Map<string, DryingReport>();
      for (const report of storedReports) byId.set(report.id, report);
      for (const report of bodyReports) byId.set(report.id, report);
      const dryingReports = [...byId.values()].sort(
        (a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt),
      );

      const hasSources = Boolean(
        input.docusketch || input.mica || input.photos?.length || input.notes?.trim(),
      );
      if (!hasSources && dryingReports.length === 0) {
        throw badRequest(
          'Rebuild needs sources in the body and/or stored drying reports for this job.',
        );
      }

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

      const sources = {
        jobId,
        docusketch: input.docusketch,
        mica: input.mica,
        photos: input.photos,
        notes: input.notes,
        dryingReports,
        overrides: input.overrides,
      };

      const { agreement, errors } = await resolveJobAgreement(supabase, orgId, sources);
      const deviations = await listDeviations(supabase, orgId, jobId);

      const estimate = buildEstimate(sources, {
        ...config,
        agreement,
        deviations,
        carrier: { override: input.carrier },
      });
      estimate.openQuestions = [...new Set([...estimate.openQuestions, ...warnings, ...errors])];

      if (input.save) {
        const name =
          estimate.assessment.propertyAddress ??
          estimate.assessment.claimNumber ??
          `Mitigation estimate ${new Date().toISOString().slice(0, 10)}`;
        const record = await saveEstimate(supabase, { orgId, userId, name, estimate });
        res.json({ estimateId: record.id, jobId: record.jobId, estimate, saved: true });
        return;
      }

      res.json({ estimate, saved: false });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Capture apps — MICA Dash + Outlook drying reports
 * ------------------------------------------------------------------ */

/**
 * GET /api/mitigation/capture/status
 *
 * Capture connectors + background agent status. Sync is automatic on this
 * platform; the status exists so operators can see the agent is alive.
 */
mitigationRouter.get('/capture/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mode = captureMode();
    const connectors = buildCaptureConnectors().map((c) => ({
      kind: c.kind,
      name: c.name,
    }));
    const { stored } = await loadContext(req);
    const agent = readCaptureAgentStatus(stored);
    res.json({
      mode,
      connectors,
      configured: {
        micaDash: Boolean(config.estimator.micaDashBaseUrl && config.estimator.micaDashApiKey),
        outlook: Boolean(config.estimator.outlookAccessToken),
      },
      agent,
      note:
        'The capture agent watches open jobs and updates estimates when MICA Dash or Outlook land new drying reports. Manual sync is a fallback, not the primary path.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mitigation/capture/agent/run
 *
 * Run the capture agent now for this org's open jobs (or one jobId in the body).
 */
mitigationRouter.post(
  '/capture/agent/run',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);
      const jobId =
        typeof req.body?.jobId === 'string' && req.body.jobId.trim()
          ? req.body.jobId.trim()
          : undefined;

      if (jobId) {
        const { config: estimatorConfig } = buildEstimatorConfig(stored, priceList);
        const deviations = await listDeviations(supabase, orgId, jobId);
        const result = await syncCaptureAndRebuild(
          supabase,
          { orgId, userId, config: estimatorConfig, deviations },
          {
            jobId,
            claimNumber: typeof req.body?.claimNumber === 'string' ? req.body.claimNumber : undefined,
            sources: config.estimator.captureAgent.sources,
            autoRebuild: true,
            save: true,
            baselineSources: {
              jobId,
              docusketch: req.body?.docusketch,
              mica: req.body?.mica,
              photos: req.body?.photos,
              notes: req.body?.notes,
            },
          },
        );
        res.json({ scope: 'job', result });
        return;
      }

      // Prefer admin pass when available so the agent mirrors production.
      const admin = createAdminClient();
      if (admin) {
        const pass = await runCaptureAgentPass(admin, { orgId });
        res.json({ scope: 'org', pass });
        return;
      }

      const jobs = await listOpenCaptureJobs(supabase, { orgId });
      const results = [];
      for (const job of jobs) {
        results.push(await runCaptureAgentForJob(supabase, job));
      }
      res.json({
        scope: 'org',
        pass: {
          jobsConsidered: jobs.length,
          jobsUpdated: results.filter((r) => r.modified).length,
          visitsImported: results.reduce((sum, r) => sum + r.reportsImported, 0),
          estimatesSaved: results.filter((r) => r.saved).length,
          errors: [],
          results,
          ranAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/jobs/:jobId/capture/webhook
 *
 * Push from MICA Dash / Outlook / Graph — the agent path. Import the payload
 * and modify the estimate immediately without waiting for the poll interval.
 */
mitigationRouter.post(
  '/jobs/:jobId/capture/webhook',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = captureImportSchema.parse(req.body);
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);
      const jobId = req.params.jobId;
      const { config: estimatorConfig, warnings } = buildEstimatorConfig(stored, priceList);
      const deviations = await listDeviations(supabase, orgId, jobId);

      const result = await syncCaptureAndRebuild(
        supabase,
        { orgId, userId, config: estimatorConfig, deviations },
        {
          jobId,
          claimNumber: input.claimNumber,
          payload: input.payload,
          payloadSource: input.source,
          autoRebuild: true,
          save: true,
          baselineSources: {
            jobId,
            docusketch: input.docusketch,
            mica: input.mica ?? (input.source === 'mica_dash' ? input.payload : undefined),
            photos: input.photos,
            notes: input.notes,
          },
        },
      );
      result.warnings = [...new Set([...result.warnings, ...warnings])];
      res.status(202).json({ accepted: true, result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/jobs/:jobId/capture/sync
 *
 * Pull from MICA Dash and/or Outlook, append new drying visits, and
 * automatically rebuild a modified estimate. Prefer the background agent /
 * webhook; this remains for operators and the UI fallback.
 */
mitigationRouter.post(
  '/jobs/:jobId/capture/sync',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = captureSyncSchema.parse(req.body ?? {});
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);
      const jobId = req.params.jobId;

      const { config: estimatorConfig, warnings } = buildEstimatorConfig(stored, priceList);
      const { agreement, errors } = await resolveJobAgreement(supabase, orgId, {
        docusketch: input.docusketch,
        mica: input.mica,
        photos: input.photos,
        notes: input.notes,
      });
      const deviations = await listDeviations(supabase, orgId, jobId);

      const result = await syncCaptureAndRebuild(
        supabase,
        {
          orgId,
          userId,
          config: estimatorConfig,
          agreement,
          deviations,
        },
        {
          jobId,
          sources: input.sources,
          claimNumber: input.claimNumber,
          since: input.since,
          payload: input.payload,
          payloadSource: input.payloadSource,
          autoRebuild: input.autoRebuild,
          save: input.save,
          baselineSources: {
            jobId,
            docusketch: input.docusketch,
            mica: input.mica,
            photos: input.photos,
            notes: input.notes,
          },
        },
      );

      result.warnings = [...new Set([...result.warnings, ...warnings, ...errors])];
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mitigation/jobs/:jobId/capture/import
 *
 * Push a MICA Dash export or Outlook message payload (webhook / file / Graph
 * notification). Same auto-rebuild path as sync.
 */
mitigationRouter.post(
  '/jobs/:jobId/capture/import',
  buildLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = captureImportSchema.parse(req.body);
      const { supabase, userId, orgId, stored, priceList } = await loadContext(req);
      const jobId = req.params.jobId;

      const { config: estimatorConfig, warnings } = buildEstimatorConfig(stored, priceList);
      const { agreement, errors } = await resolveJobAgreement(supabase, orgId, {
        docusketch: input.docusketch,
        mica: input.mica ?? (input.source === 'mica_dash' ? input.payload : undefined),
        photos: input.photos,
        notes: input.notes,
      });
      const deviations = await listDeviations(supabase, orgId, jobId);

      const result = await syncCaptureAndRebuild(
        supabase,
        {
          orgId,
          userId,
          config: estimatorConfig,
          agreement,
          deviations,
        },
        {
          jobId,
          claimNumber: input.claimNumber,
          payload: input.payload,
          payloadSource: input.source,
          autoRebuild: input.autoRebuild,
          save: input.save,
          baselineSources: {
            jobId,
            docusketch: input.docusketch,
            mica: input.mica ?? (input.source === 'mica_dash' ? input.payload : undefined),
            photos: input.photos,
            notes: input.notes,
          },
        },
      );

      result.warnings = [...new Set([...result.warnings, ...warnings, ...errors])];
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** Coerce validated report rows into DryingReport (mint ids when omitted). */
function normalizeDryingReports(
  rows: Array<{
    id?: string;
    takenAt: string;
    source: DryingReport['source'];
    notes?: string;
    moistureReadings?: Array<{
      roomId: string;
      material: string;
      value: number;
      dryStandard: number;
      takenAt: string;
      location?: string;
    }>;
    psychrometrics?: DryingReport['psychrometrics'];
    equipment?: DryingReport['equipment'];
    roomsAtDryStandard?: string[];
    roomsStillWet?: string[];
    evidence?: DryingReport['evidence'];
  }> | undefined,
): DryingReport[] | undefined {
  if (!rows?.length) return undefined;
  return rows.map((row, index) => ({
    id: row.id ?? `report-${Date.now().toString(36)}-${index}`,
    takenAt: row.takenAt,
    source: row.source,
    notes: row.notes,
    moistureReadings: row.moistureReadings?.map((r) => ({
      ...r,
      material: r.material as MaterialType,
    })),
    psychrometrics: row.psychrometrics,
    equipment: row.equipment,
    roomsAtDryStandard: row.roomsAtDryStandard,
    roomsStillWet: row.roomsStillWet,
    evidence: row.evidence,
  }));
}
