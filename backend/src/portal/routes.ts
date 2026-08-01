import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createAdminClient, createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError, badRequest, forbidden, notFound, serviceUnavailable } from '../lib/errors.js';
import { analyzeDrying } from '../pm/drying.js';
import * as pmStore from '../pm/store.js';
import type { ProjectContext } from '../pm/types.js';
import { answerHomeownerQuestion, portalAssistantEnabled } from '../portal/assistant.js';
import { buildHomeownerReport, jobFactsForAssistant } from '../portal/report.js';
import * as portalStore from '../portal/store.js';
import { hashShareToken, looksLikeShareToken, mintShareToken } from '../portal/tokens.js';
import {
  askSchema,
  createShareSchema,
  guestMessageSchema,
  policyUploadSchema,
  staffMessageSchema,
  updateVisibilitySchema,
} from '../portal/validation.js';

/**
 * HomeOwner Report portal.
 *
 * Two audiences share one router:
 *   - Staff (cookie session): mint/revoke links, set visibility, reply in chat
 *   - Guests (share token): read the projected report, chat, upload policy, ask
 *
 * Guest paths never reuse staff JWTs. They require the service-role client so
 * RLS does not block tokenized reads of pm_* rows after the BFF has validated
 * the share.
 */
export const portalRouter = Router();

const guestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many portal requests. Wait a moment.', code: 'rate_limited' },
});

const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions. Wait a moment.', code: 'rate_limited' },
});

async function staffCtx(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const org = await pmStore.resolveOrgContext(supabase, req.user!.id);
  return { supabase, org, userId: req.user!.id };
}

function requireAdmin() {
  const admin = createAdminClient();
  if (!admin) {
    throw serviceUnavailable(
      'HomeOwner Report guest access needs SUPABASE_SERVICE_ROLE_KEY on the server.',
      'portal_admin_required',
    );
  }
  return admin;
}

async function loadGuestShare(token: string) {
  if (!looksLikeShareToken(token)) {
    throw badRequest('That report link does not look valid.', 'portal_bad_token');
  }
  const admin = requireAdmin();
  const share = await portalStore.findShareByTokenHash(admin, hashShareToken(token));
  if (!share) throw notFound('This report link was not found.', 'portal_share_missing');
  if (share.status === 'revoked') {
    throw forbidden('This report link has been revoked.', 'portal_share_revoked');
  }
  if (share.status === 'expired' || (share.expiresAt && new Date(share.expiresAt) < new Date())) {
    throw forbidden('This report link has expired.', 'portal_share_expired');
  }
  return { admin, share };
}

async function loadGuestReport(token: string) {
  const { admin, share } = await loadGuestShare(token);
  const project = await pmStore.getProject(admin, share.projectId);
  if (!project || project.orgId !== share.orgId) {
    throw notFound('The job for this report is no longer available.', 'portal_project_missing');
  }

  const [visibility, orgName, milestones, updates, documents, areas, readings, placements, tasks] =
    await Promise.all([
      portalStore.getVisibility(admin, share.projectId, share.orgId),
      portalStore.getOrgName(admin, share.orgId),
      pmStore.listMilestones(admin, { projectId: share.projectId }),
      pmStore.listUpdates(admin, { projectId: share.projectId, limit: 50 }),
      pmStore.listDocuments(admin, { projectId: share.projectId }),
      pmStore.listAreas(admin, { projectId: share.projectId }),
      pmStore.listReadings(admin, { projectId: share.projectId, limit: 500 }),
      pmStore.listPlacements(admin, { projectId: share.projectId, openOnly: true }),
      pmStore.listTasks(admin, { projectId: share.projectId }),
    ]);

  const ctx: ProjectContext = {
    project,
    tasks,
    usedOriginKeys: [],
    assignments: [],
    areas,
    readings,
    placements,
    documents,
    milestones,
  };

  // Sensible defaults — guest headline only; staff thresholds stay on the PM side.
  const drying = analyzeDrying(
    ctx,
    {
      orgId: project.orgId,
      enabled: true,
      timezone: 'America/Chicago',
      digestHour: 7,
      readingIntervalHours: 24,
      dryingStallDays: 3,
      dryingProgressMinPct: 1,
      equipmentIdleHours: 48,
      staleProjectDays: 3,
      milestoneLeadDays: 3,
      maxProjectsPerCrew: 8,
      disabledRules: [],
      autoCreateTasks: false,
      updatedAt: new Date().toISOString(),
    },
    new Date(),
  );

  let dryingGuest = null;
  if (drying.isDrying) {
    dryingGuest = {
      isDrying: true,
      openAreas: drying.openAreas,
      areasAtGoal: drying.areasAtGoal,
      daysDrying: drying.daysDrying,
      headline: drying.allAreasAtGoal
        ? 'Drying goals are met — the team is preparing to pull equipment.'
        : drying.areasStalled > 0
          ? 'Drying is in progress; some areas need closer attention.'
          : 'Drying is in progress on your property.',
    };
  }

  const report = buildHomeownerReport({
    orgName,
    share,
    visibility,
    project,
    milestones,
    updates,
    documents,
    drying: dryingGuest,
  });

  void portalStore.touchShareAccess(admin, share.id).catch(() => undefined);

  return { admin, share, visibility, project, report };
}

/* ------------------------------------------------------------------ *
 * Staff — manage portal for a project
 * ------------------------------------------------------------------ */

const staff = Router({ mergeParams: true });
staff.use(requireAuth);

/** GET /api/portal/projects/:projectId — shares, visibility, conversations */
staff.get('/projects/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await staffCtx(req);
    const projectId = req.params.projectId!;
    const project = await pmStore.getProject(supabase, projectId);
    if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

    const [shares, visibility, conversations, messages] = await Promise.all([
      portalStore.listShares(supabase, projectId),
      portalStore.getVisibility(supabase, projectId, org.orgId),
      portalStore.listProjectConversations(supabase, projectId),
      portalStore.listProjectMessages(supabase, projectId, 80),
    ]);

    res.json({
      projectId,
      shares,
      visibility,
      conversations,
      messages,
      portalPathPrefix: '/report',
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/projects/:projectId/shares — mint a new homeowner link */
staff.post('/projects/:projectId/shares', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await staffCtx(req);
    const projectId = req.params.projectId!;
    const project = await pmStore.getProject(supabase, projectId);
    if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

    const body = createShareSchema.parse(req.body ?? {});
    const { token, tokenHash } = mintShareToken();
    const share = await portalStore.createShare(supabase, {
      orgId: org.orgId,
      projectId,
      tokenHash,
      createdBy: userId,
      label: body.label ?? null,
      customerName: body.customerName ?? project.customerName,
      customerEmail: body.customerEmail ?? project.customerEmail,
      welcomeNote: body.welcomeNote ?? null,
      expiresAt: body.expiresAt ?? null,
    });

    // Ensure a visibility row exists so disclosure defaults are explicit.
    const visibility = await portalStore.upsertVisibility(
      supabase,
      org.orgId,
      projectId,
      userId,
      {},
    );
    const orgName = await portalStore.getOrgName(supabase, org.orgId);
    const brandName =
      visibility.brandName?.trim() ||
      visibility.officeName?.trim() ||
      orgName ||
      'Restoration company';
    await portalStore.ensureConversations(supabase, {
      orgId: org.orgId,
      projectId,
      shareId: share.id,
      brandName,
      adjusterName: project.adjusterName,
      visibility,
    });

    res.status(201).json({
      share,
      token,
      path: `/report/${token}`,
      message: 'Copy this link now — the raw token is not stored and cannot be shown again.',
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/projects/:projectId/shares/:shareId/revoke */
staff.post(
  '/projects/:projectId/shares/:shareId/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await staffCtx(req);
      const projectId = req.params.projectId!;
      const shareId = req.params.shareId!;
      const project = await pmStore.getProject(supabase, projectId);
      if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

      const shares = await portalStore.listShares(supabase, projectId);
      if (!shares.some((s) => s.id === shareId)) throw notFound('Share not found.');

      const share = await portalStore.revokeShare(supabase, shareId, userId);
      res.json({ share });
    } catch (err) {
      next(err);
    }
  },
);

/** PUT /api/portal/projects/:projectId/visibility */
staff.put(
  '/projects/:projectId/visibility',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await staffCtx(req);
      const projectId = req.params.projectId!;
      const project = await pmStore.getProject(supabase, projectId);
      if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

      const body = updateVisibilitySchema.parse(req.body ?? {});
      const visibility = await portalStore.upsertVisibility(
        supabase,
        org.orgId,
        projectId,
        userId,
        body,
      );
      res.json({ visibility });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/portal/projects/:projectId/conversations/:conversationId/messages */
staff.get(
  '/projects/:projectId/conversations/:conversationId/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await staffCtx(req);
      const projectId = req.params.projectId!;
      const conversationId = req.params.conversationId!;
      const project = await pmStore.getProject(supabase, projectId);
      if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

      const conversation = await portalStore.getConversation(supabase, conversationId);
      if (!conversation || conversation.projectId !== projectId) {
        throw notFound('Conversation not found.');
      }
      const messages = await portalStore.listMessages(supabase, conversationId);
      res.json({ conversation, messages });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/portal/projects/:projectId/messages — staff / adjuster reply */
staff.post(
  '/projects/:projectId/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await staffCtx(req);
      const projectId = req.params.projectId!;
      const project = await pmStore.getProject(supabase, projectId);
      if (!project || project.orgId !== org.orgId) throw notFound('Project not found.');

      const body = staffMessageSchema.parse(req.body ?? {});
      const conversation = await portalStore.getConversation(supabase, body.conversationId);
      if (!conversation || conversation.projectId !== projectId) {
        throw notFound('Conversation not found.');
      }

      const asAdjuster = body.as === 'adjuster';
      if (asAdjuster && !conversation.includesAdjuster) {
        throw forbidden('This conversation does not include the adjuster.');
      }
      if (!asAdjuster && !conversation.includesCompany && conversation.kind !== 'assistant') {
        throw forbidden('Company staff cannot post in this conversation.');
      }

      const message = await portalStore.insertMessage(supabase, {
        orgId: org.orgId,
        projectId,
        shareId: conversation.shareId,
        conversationId: conversation.id,
        authorKind: asAdjuster ? 'adjuster' : 'staff',
        authorUserId: userId,
        authorName: asAdjuster
          ? project.adjusterName ?? 'Insurance adjuster'
          : 'Restoration team',
        body: body.body,
        topic: 'general',
      });
      res.status(201).json({ message, conversation });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Guest — tokenized report
 * ------------------------------------------------------------------ */

const guest = Router({ mergeParams: true });
guest.use(guestLimiter);

/** GET /api/portal/report/:token */
guest.get('/report/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { admin, share, visibility, project, report } = await loadGuestReport(req.params.token!);
    const conversations = await portalStore.ensureConversations(admin, {
      orgId: share.orgId,
      projectId: project.id,
      shareId: share.id,
      brandName: report.brand.name,
      adjusterName: project.adjusterName,
      visibility,
    });
    res.json({
      report,
      conversations,
      assistantEnabled: portalAssistantEnabled() && visibility.allowInsuranceQa,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/portal/report/:token/conversations/:conversationId/messages */
guest.get(
  '/report/:token/conversations/:conversationId/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { admin, share, visibility } = await loadGuestReport(req.params.token!);
      const conversationId = req.params.conversationId!;
      const conversation = await portalStore.getConversation(admin, conversationId);
      if (!conversation || conversation.shareId !== share.id) {
        throw notFound('Conversation not found.');
      }
      assertConversationAllowed(conversation.kind, visibility);
      const messages = await portalStore.listMessages(admin, conversationId);
      res.json({ conversation, messages });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/portal/report/:token/messages — homeowner posts to a side conversation */
guest.post('/report/:token/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { admin, share, visibility, project } = await loadGuestReport(req.params.token!);
    const body = guestMessageSchema.parse(req.body ?? {});
    const conversation = await portalStore.getConversation(admin, body.conversationId);
    if (!conversation || conversation.shareId !== share.id) {
      throw notFound('Conversation not found.');
    }
    assertConversationAllowed(conversation.kind, visibility);
    if (conversation.kind === 'assistant') {
      throw forbidden(
        'Use the ask endpoint for the assistant conversation.',
        'portal_use_ask',
      );
    }

    const message = await portalStore.insertMessage(admin, {
      orgId: share.orgId,
      projectId: project.id,
      shareId: share.id,
      conversationId: conversation.id,
      authorKind: 'homeowner',
      authorName: share.customerName ?? 'Homeowner',
      body: body.body,
      topic: body.topic,
    });
    res.status(201).json({ message, conversation });
  } catch (err) {
    next(err);
  }
});

/** GET /api/portal/report/:token/policies */
guest.get('/report/:token/policies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { admin, share, visibility } = await loadGuestReport(req.params.token!);
    if (!visibility.allowPolicyUpload && !visibility.allowInsuranceQa) {
      throw forbidden('Policy tools are not enabled for this report.', 'portal_policy_disabled');
    }
    const policies = await portalStore.listPolicies(admin, share.id);
    res.json({ policies });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/report/:token/policies */
guest.post('/report/:token/policies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { admin, share, visibility, project } = await loadGuestReport(req.params.token!);
    if (!visibility.allowPolicyUpload) {
      throw forbidden('Policy upload is not enabled for this report.', 'portal_policy_disabled');
    }
    const body = policyUploadSchema.parse(req.body ?? {});
    const summary =
      body.contentText.length > 280
        ? `${body.contentText.slice(0, 277).trim()}…`
        : body.contentText.trim();
    const policy = await portalStore.insertPolicy(admin, {
      orgId: share.orgId,
      projectId: project.id,
      shareId: share.id,
      fileName: body.fileName,
      mimeType: body.mimeType,
      contentText: body.contentText,
      byteSize: body.byteSize ?? null,
      summary,
    });
    res.status(201).json({ policy });
  } catch (err) {
    next(err);
  }
});

/** POST /api/portal/report/:token/ask — insurance / job Q&A in the assistant thread */
guest.post(
  '/report/:token/ask',
  askLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { admin, share, visibility, report, project } = await loadGuestReport(req.params.token!);
      if (!visibility.allowInsuranceQa) {
        throw forbidden('Questions are not enabled for this report.', 'portal_ask_disabled');
      }
      const body = askSchema.parse(req.body ?? {});
      const conversations = await portalStore.ensureConversations(admin, {
        orgId: share.orgId,
        projectId: project.id,
        shareId: share.id,
        brandName: report.brand.name,
        adjusterName: project.adjusterName,
        visibility,
      });
      const assistant =
        conversations.find((c) => c.id === body.conversationId && c.kind === 'assistant') ??
        conversations.find((c) => c.kind === 'assistant');
      if (!assistant) {
        throw forbidden('Assistant conversation is not available.', 'portal_ask_disabled');
      }

      const policyText = visibility.allowPolicyUpload
        ? await portalStore.getLatestPolicyText(admin, share.id)
        : null;

      const { reply, model } = await answerHomeownerQuestion(body.question, body.history, {
        orgName: report.brand.name || report.orgName,
        customerName: report.share.customerName,
        jobFacts: jobFactsForAssistant(report),
        regulation: report.regulation,
        policyText,
      });

      await portalStore.insertMessage(admin, {
        orgId: share.orgId,
        projectId: project.id,
        shareId: share.id,
        conversationId: assistant.id,
        authorKind: 'homeowner',
        authorName: share.customerName ?? 'Homeowner',
        body: body.question,
        topic: 'insurance',
      });
      const assistantMessage = await portalStore.insertMessage(admin, {
        orgId: share.orgId,
        projectId: project.id,
        shareId: share.id,
        conversationId: assistant.id,
        authorKind: 'assistant',
        authorName: report.brand.name,
        body: reply,
        topic: 'insurance',
      });

      res.json({ reply, model, conversationId: assistant.id, message: assistantMessage });
    } catch (err) {
      next(err);
    }
  },
);

portalRouter.use(staff);
portalRouter.use(guest);

function assertConversationAllowed(
  kind: 'assistant' | 'company' | 'adjuster' | 'group',
  visibility: {
    allowChat: boolean;
    allowAdjusterChat: boolean;
    allowGroupChat: boolean;
    allowInsuranceQa: boolean;
  },
) {
  if (kind === 'assistant' && !visibility.allowInsuranceQa) {
    throw forbidden('Assistant chat is not enabled.', 'portal_chat_disabled');
  }
  if (kind === 'company' && !visibility.allowChat) {
    throw forbidden('Company chat is not enabled.', 'portal_chat_disabled');
  }
  if (kind === 'adjuster' && !visibility.allowAdjusterChat) {
    throw forbidden('Adjuster chat is not enabled.', 'portal_chat_disabled');
  }
  if (kind === 'group' && !visibility.allowGroupChat) {
    throw forbidden('Group chat is not enabled.', 'portal_chat_disabled');
  }
}

// Express error passthrough for Zod
portalRouter.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
  if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'ZodError') {
    next(new HttpError(400, 'Invalid portal request.', 'portal_validation'));
    return;
  }
  next(err);
});
