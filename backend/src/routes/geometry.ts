import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { badRequest, notFound } from '../lib/errors.js';
import { GEOMETRY_SOURCES } from '../geometry/types.js';
import {
  createSession,
  createTwin,
  getSession,
  getTwin,
  listTwinsForOrgHydrated,
  saveSession,
  saveTwin,
} from '../geometry/store.js';
import {
  attachVideoEvidenceOnly,
  ingestMeasurementsOntoTwin,
  summarizeTwin,
} from '../geometry/twin.js';
import { isMetricGeometrySource } from '../geometry/fromDevice.js';

/**
 * Property digital twin + Field measurement API.
 *
 * App Store Field Capture posts RoomPlan / ARKit / LiDAR rooms here while
 * (or after) filming. The twin holds measured spaces, optional mesh, and
 * linked video of the area and the work. RGB video alone is evidence, not
 * a substitute for on-device metric measurement.
 */
export const geometryRouter = Router();

geometryRouter.use(requireAuth);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many geometry requests. Try again later.', code: 'rate_limited' },
});

geometryRouter.use(limiter);

const openingSchema = z.object({
  kind: z.enum(['door', 'window', 'cased_opening', 'other']),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  sharedWithRoomId: z.string().optional(),
});

const roomSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  roomType: z.string().max(64).optional(),
  level: z.string().max(64).optional(),
  lengthFt: z.number().positive().optional(),
  widthFt: z.number().positive().optional(),
  heightFt: z.number().positive().optional(),
  floorAreaSqFt: z.number().nonnegative().optional(),
  ceilingAreaSqFt: z.number().nonnegative().optional(),
  wallAreaSqFt: z.number().nonnegative().optional(),
  perimeterLf: z.number().nonnegative().optional(),
  openings: z.array(openingSchema).max(40).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const meshSchema = z.object({
  format: z.enum(['usdz', 'obj', 'glb', 'ply', 'other']),
  url: z.string().url().max(4000),
  byteSize: z.number().int().positive().optional(),
  contentType: z.string().max(128).optional(),
  producedBy: z.enum(GEOMETRY_SOURCES).optional(),
});

/**
 * GET /api/geometry/capabilities
 * What the server accepts from the App Store Field app and web.
 */
geometryRouter.get('/capabilities', (_req, res) => {
  res.json({
    metricSources: GEOMETRY_SOURCES.filter((s) => isMetricGeometrySource(s)),
    evidenceOnlySources: ['video_evidence'],
    deviceApis: ['roomplan', 'arkit', 'lidar'],
    meshFormats: ['usdz', 'obj', 'glb', 'ply'],
    note:
      'Metric rooms come from on-device AR (App Store) or DocuSketch. Field video attaches as evidence and work overlay on the twin; it does not invent scale by itself.',
  });
});

const createTwinSchema = z.object({
  jobId: z.string().trim().min(1).max(128).optional(),
  label: z.string().trim().min(1).max(200).default('Property twin'),
  primarySource: z.enum(GEOMETRY_SOURCES).default('roomplan'),
});

/** POST /api/geometry/twins — create an empty twin for a job / site. */
geometryRouter.post('/twins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const body = createTwinSchema.parse(req.body ?? {});
    const twin = await createTwin({
      orgId,
      jobId: body.jobId,
      label: body.label,
      primarySource: body.primarySource,
    });
    res.status(201).json({ twin, summary: summarizeTwin(twin) });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
    else next(err);
  }
});

/** GET /api/geometry/twins */
geometryRouter.get('/twins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const twins = (await listTwinsForOrgHydrated(orgId)).map((t) => ({
      twin: t,
      summary: summarizeTwin(t),
    }));
    res.json({ twins });
  } catch (err) {
    next(err);
  }
});

/** GET /api/geometry/twins/:id */
geometryRouter.get('/twins/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const twin = await getTwin(String(req.params.id));
    if (!twin || twin.orgId !== orgId) throw notFound('Digital twin not found');
    res.json({ twin, summary: summarizeTwin(twin) });
  } catch (err) {
    next(err);
  }
});

const sessionSchema = z.object({
  twinId: z.string().uuid().optional(),
  jobId: z.string().trim().min(1).max(128).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(['ios', 'android', 'web', 'external']).default('ios'),
  measureApi: z.enum(['roomplan', 'arkit', 'lidar', 'none']).optional(),
  lidarAvailable: z.boolean().optional(),
  videoRef: z.string().trim().min(1).max(500).optional(),
});

/**
 * POST /api/geometry/sessions
 * Open a Field capture session (App Store). Creates a twin when needed.
 */
geometryRouter.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const body = sessionSchema.parse(req.body ?? {});
    let twin = body.twinId ? await getTwin(body.twinId) : null;
    if (twin && twin.orgId !== orgId) throw notFound('Digital twin not found');
    if (!twin) {
      twin = await createTwin({
        orgId,
        jobId: body.jobId,
        label: body.label ?? 'Field capture twin',
        primarySource:
          body.measureApi === 'none' ? 'video_evidence' : (body.measureApi ?? 'roomplan'),
      });
      twin.status = 'measuring';
      await saveTwin(twin);
    }
    const session = await createSession({
      orgId,
      jobId: body.jobId ?? twin.jobId,
      twinId: twin.id,
      platform: body.platform,
      measureApi: body.measureApi,
      lidarAvailable: body.lidarAvailable,
      videoRef: body.videoRef,
    });
    res.status(201).json({ session, twin, summary: summarizeTwin(twin) });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
    else next(err);
  }
});

const ingestSchema = z.object({
  source: z.enum(['arkit', 'roomplan', 'lidar', 'manual']),
  rooms: z.array(roomSchema).max(80),
  mesh: meshSchema.nullable().optional(),
  videoRef: z.string().trim().min(1).max(500).optional(),
  dictationSummary: z.string().max(4000).optional(),
  capturedAt: z.string().datetime().optional(),
  work: z
    .array(
      z.object({
        id: z.string().optional(),
        roomId: z.string().optional(),
        label: z.string().trim().min(1).max(200),
        scopeTitle: z.string().max(200).optional(),
        status: z.enum(['planned', 'in_progress', 'done', 'blocked']),
        evidenceVideoIds: z.array(z.string()).max(20).optional(),
        note: z.string().max(2000).optional(),
      }),
    )
    .max(40)
    .optional(),
});

/**
 * POST /api/geometry/sessions/:id/ingest
 * App Store Field app: RoomPlan/ARKit rooms (+ optional USDZ) + video ref.
 */
geometryRouter.post(
  '/sessions/:id/ingest',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const session = await getSession(String(req.params.id));
      if (!session || session.orgId !== orgId) {
        throw notFound('Capture session not found');
      }
      const body = ingestSchema.parse(req.body ?? {});
      if (!body.rooms.length) {
        throw badRequest('At least one measured room is required for metric ingest.', 'no_rooms');
      }
      const twin = await ingestMeasurementsOntoTwin(session.twinId, {
        source: body.source,
        rooms: body.rooms,
        mesh: body.mesh ?? null,
        videoRef: body.videoRef ?? session.videoRef,
        dictationSummary: body.dictationSummary,
        work: body.work,
        capturedAt: body.capturedAt,
      });
      session.status = 'ingested';
      session.error = null;
      if (body.videoRef) session.videoRef = body.videoRef;
      await saveSession(session);
      res.json({ session, twin, summary: summarizeTwin(twin) });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

const videoOnlySchema = z.object({
  videoRef: z.string().trim().min(1).max(500),
  roomId: z.string().optional(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().nonnegative().optional(),
  capturedAt: z.string().datetime().optional(),
  dictationSummary: z.string().max(4000).optional(),
});

/**
 * POST /api/geometry/twins/:id/video
 * Attach filmed area / work video without new measurements.
 */
geometryRouter.post(
  '/twins/:id/video',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const twin = await getTwin(String(req.params.id));
      if (!twin || twin.orgId !== orgId) throw notFound('Digital twin not found');
      const body = videoOnlySchema.parse(req.body ?? {});
      const updated = await attachVideoEvidenceOnly(twin.id, body);
      res.json({ twin: updated, summary: summarizeTwin(updated) });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);
