import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../../config.js';
import { createAdminClient } from '../supabase.js';

/**
 * Encrypted storage for OAuth grants against a customer's own CRM.
 *
 * The mirror's rule is that credentials come from the environment and the
 * database stores only the *name* of a secret. That rule is right for vendors
 * we hold one account with, and it cannot work here: an OAuth refresh token
 * belongs to one customer's Salesforce org, and there are as many of them as
 * there are customers. They have to be stored.
 *
 * So this is the deliberate exception, and it earns it the same way the device
 * PIN pepper and the estimator vault do:
 *
 *   - Sealed with AES-256-GCM before it reaches Postgres. The row holds
 *     ciphertext, IV and auth tag; never a usable token.
 *   - The key lives only in INTEGRATIONS_OAUTH_KEY, an environment variable
 *     deliberately absent from the database. A database leak on its own yields
 *     nothing.
 *   - Nothing travels back to the browser. The API returns which CRM is
 *     connected, who connected it and when — never the grant itself.
 *
 * A refresh token is the strongest credential in this system: it is
 * long-lived, and it grants whatever the connected user could do. That is
 * precisely why the alternative — asking a customer for their Salesforce
 * password so a browser can type it in — is so much worse, and why this exists.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = 'atmosphere/integrations-oauth/v1';

let derived: Buffer | null = null;
function key(): Buffer {
  if (!config.integrations.oauthKey) {
    throw new Error(
      'Connecting a CRM needs INTEGRATIONS_OAUTH_KEY. Without it a refresh token could only be ' +
        'stored in the clear, which is worse than not storing it at all.',
    );
  }
  if (!derived) derived = scryptSync(config.integrations.oauthKey, KEY_SALT, KEY_BYTES);
  return derived;
}

export interface SealedGrant {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function seal(plaintext: string): SealedGrant {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function open(sealed: SealedGrant): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  // GCM authenticates, so a tampered row throws here rather than handing back
  // attacker-chosen bytes that we would then send to Salesforce as a token.
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export interface StoredGrant {
  /** 'salesforce' — which CRM this grant is for. */
  system: string;
  refreshToken: string;
  /** Salesforce hands back the org's own API host; it is not always the login host. */
  instanceUrl: string;
  /** Shown in the UI so somebody can tell which account is connected. */
  accountLabel: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Grants are written with the service role, never a user session.
 *
 * A member must not be able to read the table their own org's token lives in:
 * the connect flow puts one there and the sync path takes it out, and no
 * request in between ever needs to see it.
 */
function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error('Connecting a CRM needs SUPABASE_SERVICE_ROLE_KEY.');
  }
  return admin;
}

export async function saveGrant(
  orgId: string,
  userId: string,
  grant: StoredGrant,
): Promise<void> {
  const sealed = seal(
    JSON.stringify({ refreshToken: grant.refreshToken, instanceUrl: grant.instanceUrl }),
  );
  const admin = adminOrThrow();
  const { error } = await admin.from('crm_oauth_grants').upsert(
    {
      org_id: orgId,
      system: grant.system,
      iv: sealed.iv,
      tag: sealed.tag,
      ciphertext: sealed.ciphertext,
      account_label: grant.accountLabel,
      connected_by: userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,system' },
  );
  if (error) throw new Error(error.message);
}

export async function loadGrant(
  orgId: string,
  system: string,
): Promise<{ refreshToken: string; instanceUrl: string } | null> {
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('crm_oauth_grants')
    .select('iv, tag, ciphertext')
    .eq('org_id', orgId)
    .eq('system', system)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return JSON.parse(open(data as any));
  } catch {
    // A grant we cannot decrypt is a grant we do not have. Failing loudly here
    // would be worse than reporting the CRM as disconnected, which is true.
    return null;
  }
}

/** What the UI may know: which CRM, whose account, when — never the token. */
export async function listGrants(orgId: string): Promise<
  Array<{ system: string; accountLabel: string | null; connectedAt: string }>
> {
  const admin = adminOrThrow();
  const { data } = await admin
    .from('crm_oauth_grants')
    .select('system, account_label, connected_at')
    .eq('org_id', orgId);
  return (data ?? []).map((row: any) => ({
    system: row.system,
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
  }));
}

/**
 * Disconnect.
 *
 * Deleting our copy is the part we control; revoking at the vendor is the part
 * that actually ends the access, and the caller does that first. If revocation
 * fails we still delete, because a token we cannot use is better than one we
 * keep on the theory that we might revoke it later.
 */
export async function deleteGrant(orgId: string, system: string): Promise<void> {
  const admin = adminOrThrow();
  await admin.from('crm_oauth_grants').delete().eq('org_id', orgId).eq('system', system);
}
