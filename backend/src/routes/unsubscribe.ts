import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createAdminClient } from '../lib/supabase.js';

/**
 * Unsubscribing, for somebody who is not signed in and never will be.
 *
 * This router is deliberately outside every auth middleware in the codebase.
 * The person clicking is a facilities director who got an email they did not
 * ask for; requiring them to authenticate to make it stop would be absurd, and
 * an unsubscribe link that does not work is a CAN-SPAM violation rather than a
 * papercut.
 *
 * Three properties that matter more than they look:
 *
 *   It answers success whatever happens. A response that distinguished a valid
 *   token from an invalid one would be an oracle for probing which tokens
 *   exist, and there is nothing to gain from telling anyone.
 *
 *   The token is the only input. It never accepts an email address, so nobody
 *   can unsubscribe somebody else, and a forwarded email cannot be used to
 *   remove the original recipient.
 *
 *   The work happens in a SECURITY DEFINER function. This route has no way to
 *   read the sends table, so a bug here cannot become a way to enumerate who
 *   was mailed.
 */
export const unsubscribeRouter = Router();

// Generous, but bounded: a real person clicks once, and a script guessing
// tokens should not get many attempts.
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: true },
});

async function record(token: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  await admin.rpc('record_unsubscribe', { p_token: token });
}

/**
 * GET — the link in the email.
 *
 * Answers HTML rather than JSON because a mail client opens this in a browser
 * and a person needs to see that it worked. Self-contained, no assets: this
 * page has to render for somebody on a phone in a car park.
 */
unsubscribeRouter.get('/', limiter, async (req: Request, res: Response) => {
  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (token) await record(token);

  res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
    font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:#faf9f7;color:#1c1917;padding:24px}
  main{max-width:26rem;text-align:center}
  h1{font-size:1.375rem;margin:0 0 .5rem;letter-spacing:-.02em}
  p{margin:0;color:#57534e}
  @media(prefers-color-scheme:dark){body{background:#1d1b18;color:#f1efeb}p{color:#a09c93}}
</style></head>
<body><main>
  <h1>You're unsubscribed</h1>
  <p>You won't get any more emails from this sender. No need to do anything else.</p>
</main></body></html>`);
});

/** POST — same thing, for a one-click unsubscribe header or a fetch. */
unsubscribeRouter.post('/', limiter, async (req: Request, res: Response) => {
  const token =
    (typeof req.query.t === 'string' ? req.query.t : '') ||
    (typeof req.body?.token === 'string' ? req.body.token : '');
  if (token) await record(token);
  res.json({ ok: true });
});
