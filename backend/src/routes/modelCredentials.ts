import { type Request, type Response, type NextFunction, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { config } from '../config.js';
import {
  clearApiKey,
  getCredentialStatus,
  looksLikeAnthropicKey,
  setApiKey,
} from '../computer/credentials.js';

/**
 * The organisation's model key, as a platform credential.
 *
 * The same store has always existed, but the only door to it was
 * `/api/computer/credentials`, and that whole surface 404s when
 * COMPUTER_USE_ENABLED is off. So a deployment that never wanted to hand a
 * model the mouse and keyboard also had no way to connect a key at all —
 * which, now that clip analysis and dictation read the same store, is the
 * difference between the assistant reading a day's footage and reporting
 * "Model access is not configured on this server."
 *
 * One key per organisation, one store, two doors. This one is not gated on a
 * feature the key has nothing to do with.
 */
export const modelCredentialsRouter = Router();
modelCredentialsRouter.use(requireAuth);

const apiKeySchema = z.object({ apiKey: z.string().trim().min(20).max(400) });

/**
 * Storing a bearer credential under a key derived from an empty secret is not
 * storage, it is a filename. Refuse rather than accept a key we cannot protect.
 */
function assertVaultUsable(): void {
  if (!config.computerUse.credentialKey) {
    throw new HttpError(
      503,
      'This server cannot store a model key yet: AI_CREDENTIALS_KEY is not set, and it is ' +
        'what encrypts the key at rest. Set it and try again.',
      'credential_store_unconfigured',
    );
  }
}

/**
 * GET /api/ai/credentials — is a key connected, and which one.
 *
 * Never the key itself: what comes back is the masked hint the UI shows so a
 * person can recognise which key is installed.
 */
modelCredentialsRouter.get('/credentials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    res.json({
      credential: await getCredentialStatus(orgId),
      // Whether this server could store one at all, so the UI can say why the
      // form is refused instead of failing on submit.
      storeReady: Boolean(config.computerUse.credentialKey),
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/ai/credentials — connect or replace the organisation's key. */
modelCredentialsRouter.put('/credentials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    assertVaultUsable();
    const { apiKey } = apiKeySchema.parse(req.body ?? {});
    if (!looksLikeAnthropicKey(apiKey)) {
      throw new HttpError(
        400,
        'That does not look like an Anthropic API key. Keys start with "sk-ant-".',
        'invalid_api_key',
      );
    }
    res.json({ credential: await setApiKey(orgId, apiKey, req.user!.id) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/ai/credentials — disconnect it. */
modelCredentialsRouter.delete(
  '/credentials',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      res.json({ credential: await clearApiKey(orgId) });
    } catch (err) {
      next(err);
    }
  },
);
