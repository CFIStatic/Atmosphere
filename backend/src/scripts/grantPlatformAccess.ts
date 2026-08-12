/**
 * Grant (or revoke) access to the internal /admin support portal.
 *
 *   npm run admin:grant -- someone@atmosphere.app ops
 *   npm run admin:grant -- support@atmosphere.app support
 *   npm run admin:grant -- someone@atmosphere.app revoke
 *
 * Access is deliberately not self-service: `platform_staff` has no INSERT
 * policy, so the only way in is this script (or the env allow-list auto-grant),
 * holding the service-role key.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';

type Scope = 'support' | 'admin' | 'ops';

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error('Usage: npm run admin:grant -- <email> <support|admin|ops|revoke>');
  console.error('  support  accounts, users, password reset, audit');
  console.error('  admin    support + ban/unban');
  console.error('  ops      admin + infrastructure + database browser');
  console.error('  revoke   remove all platform admin access\n');
  process.exit(1);
}

async function main(): Promise<void> {
  const [emailArg, scopeArg] = process.argv.slice(2);

  if (!emailArg) usage('An email address is required.');
  const email = emailArg.trim().toLowerCase();

  const action = (scopeArg ?? 'ops').trim().toLowerCase();
  if (!['support', 'admin', 'ops', 'revoke'].includes(action)) {
    usage(`Unknown access level: ${scopeArg}`);
  }

  const admin = createAdminClient();
  if (!admin) {
    usage('SUPABASE_SERVICE_ROLE_KEY is not set — this script cannot run without it.');
  }

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
    const { error } = await admin.from('platform_staff').delete().eq('user_id', user.id);
    if (error) throw new Error(`Could not revoke access: ${error.message}`);
    console.log(`✓ Platform admin access removed for ${email}`);
    return;
  }

  const scope = action as Scope;
  const { error } = await admin
    .from('platform_staff')
    .upsert({ user_id: user.id, scope, display_name: user.email }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not grant access: ${error.message}`);

  console.log(`✓ ${email} now has ${scope} access to the Atmosphere internal portal`);
  console.log('  → /admin');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
