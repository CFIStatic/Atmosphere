-- Make job-share invite tokens survive a path, not just a query string.
--
-- access_token defaulted to standard base64, whose alphabet includes '+' and
-- '/'. Invite emails stamp the token into /shared/<token>. A slash splits that
-- path, so the SPA catch-all sent a signed-in office user to /dashboard — their
-- jobs list — instead of the invited job they were asked to film.
--
-- Hex: no ambiguous characters, one path segment, 24 bytes is still 192 bits.
-- Existing tokens are left in place so already-sent emails keep working; the
-- app now accepts a slash inside the token.

alter table public.job_parties
  alter column access_token set default encode(gen_random_bytes(24), 'hex');
