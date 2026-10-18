/**
 * POST /api/legal/inbound — machine-to-machine intake for legal@atmosphereteam.com.
 *
 * Called only by the Cloudflare Email Worker bound to that address. It is
 * authenticated by the `x-legal-inbound-secret` header matching
 * LEGAL_INBOUND_SECRET; with no secret configured every call is rejected.
 * Mounted before the staff legalRouter so its session auth does not apply.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { badRequest } from '../lib/errors.js';
import { inboundLegalEmailSchema, inboundSecretMatches, recordInboundLegalEmail } from '../legal/inbound.js';

export const legalInboundRouter = Router();

legalInboundRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!inboundSecretMatches(req.get('x-legal-inbound-secret'))) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const parsed = inboundLegalEmailSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid inbound legal email payload');
    const { request, duplicate } = await recordInboundLegalEmail(parsed.data);
    res.status(duplicate ? 200 : 201).json({ id: request.id, duplicate });
  } catch (err) {
    next(err);
  }
});
