/**
 * Grant (or revoke) access to the growth dashboards.
 *
 *   npm run analytics:grant -- someone@atmosphere.app internal
 *   npm run analytics:grant -- investor@fund.com investor
 *   npm run analytics:grant -- someone@atmosphere.app revoke
 *
 * Access is not self-service: `analytics_staff` has no INSERT policy. Internal
 * admins approve employees from the staff Access page (service role on the BFF),
 * or this script grants a row directly. Keep the service-role key out of the
 * browser.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';

type Scope = 'investor' | 'internal';

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage: npm run analytics:grant -- <email> <internal|investor|revoke>');
  console.error('  internal  full dashboard: per-customer detail and unit economics');
  console.error('  investor  aggregate dashboard: no customer names, no margins');
  console.error('  revoke    remove all analytics access\n');
  process.exit(1);
}

async function main(): Promise<void> {
  const [emailArg, scopeArg] = process.argv.slice(2);

  if (!emailArg) usage('An email address is required.');
  const email = emailArg.trim().toLowerCase();

  const action = (scopeArg ?? 'internal').trim().toLowerCase();
  if (!['internal', 'investor', 'revoke'].includes(action)) {
    usage(`Unknown access level: ${scopeArg}`);
  }

  const admin = createAdminClient();
  if (!admin) {
    usage('SUPABASE_SERVICE_ROLE_KEY is not set — this script cannot run without it.');
  }

  // The Admin API has no "get user by email", so page through until we find it.
  let user: { id: string; email?: string } | undefined;
  for (let page = 1; page <= 20 && !user; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    if (data.users.length === 0) break;
    user = data.users.find((u) => u.email?.toLowerCase() === email);
  }

  if (!user) {
    usage(`No Atmosphere account found for ${email}. They must sign up first.`);
  }

  if (action === 'revoke') {
    const { error } = await admin.from('analytics_staff').delete().eq('user_id', user.id);
    if (error) throw new Error(`Could not revoke access: ${error.message}`);
    console.log(`✓ Analytics access removed for ${email}`);
    return;
  }

  const scope = action as Scope;
  const { error } = await admin
    .from('analytics_staff')
    .upsert({ user_id: user.id, scope, display_name: user.email }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not grant access: ${error.message}`);

  console.log(`✓ ${email} now has ${scope} access to Atmosphere growth analytics`);
  console.log(
    scope === 'internal'
      ? '  → /analytics (full) and /analytics/investor'
      : '  → /analytics/investor only (aggregate figures, no customer names)',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
