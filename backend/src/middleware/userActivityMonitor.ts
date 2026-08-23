/**
 * After each signed-in request finishes, write one user-activity row — and,
 * when the row is one preservation cares about, nudge the automatic hold
 * rules to look at that job.
 *
 * Never throws into the response. A gap in the trail is recoverable; a
 * failed login because the monitor fell over is not. The auto-hold nudge is
 * debounced and fire-and-forget for the same reason: a clip deleted is a
 * signal, not a request the customer is waiting on.
 */
import type { NextFunction, Request, Response } from 'express';
import { noteAutoHoldSignal } from '../legal/autoHold.js';
import { classifyRequest } from '../legal/classify.js';
import { actorFromRequest, recordUserAction } from '../legal/monitor.js';

const ORG_CACHE = Symbol.for('atmosphere.orgContext');

function orgIdFrom(req: Request): string | null {
  const cached = (req as Request & { [ORG_CACHE]?: { orgId?: string } })[ORG_CACHE];
  return cached?.orgId ?? null;
}

export function userActivityMonitor(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (!req.user) return;
    const classified = classifyRequest(req);
    if (classified.skip) return;

    const actor = actorFromRequest(req);
    void recordUserAction({
      ...actor,
      orgId: orgIdFrom(req),
      action: classified.action,
      resourceType: classified.resourceType,
      resourceId: classified.resourceId,
      requestId: req.requestId ?? null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }).catch(() => undefined);

    // Only a request that actually did something counts as a signal. A 403
    // delete attempt is worth reading in the trail, not worth freezing a job.
    if (res.statusCode < 400) {
      noteAutoHoldSignal({
        action: classified.action,
        resourceType: classified.resourceType,
        resourceId: classified.resourceId,
        path: req.path,
      });
    }
  });
  next();
}
