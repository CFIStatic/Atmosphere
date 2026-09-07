/**
 * Resolve the Stripe secret key from the environment.
 *
 * Canonical name is `STRIPE_SECRET_KEY`. Railway production currently ships
 * the live key as `Stripe_Secret_Key` (mixed case); accept that as a fallback
 * so we do not have to rename the variable. Prefer the canonical name when
 * both are set. Never log or print the resolved value.
 */
export function resolveStripeSecretKey(env: NodeJS.Dict<string> = process.env): string {
  const canonical = env.STRIPE_SECRET_KEY?.trim();
  if (canonical) return canonical;
  return env.Stripe_Secret_Key?.trim() ?? '';
}
