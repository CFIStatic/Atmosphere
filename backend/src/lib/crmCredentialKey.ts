/**
 * Key material for Connect CRM password sealing (AES-256-GCM via scrypt).
 *
 * Production reads only CRM_CREDENTIAL_ENCRYPTION_KEY. Shared secrets
 * (DEVICE_PEPPER, INTEGRATIONS_CREDENTIAL_KEY, INTEGRATION_SECRETS_KEY,
 * and the old CRM_CREDENTIAL_KEY name) are not fallbacks — a missing
 * dedicated key fails closed at boot.
 *
 * Outside production, an unset key uses DEV_CRM_CREDENTIAL_KEY so local
 * boot does not require the variable. That placeholder will not open
 * ciphertext sealed with another secret. Set CRM_CREDENTIAL_ENCRYPTION_KEY
 * locally to the same material if you need to read existing rows.
 */

export const DEV_CRM_CREDENTIAL_KEY =
  'atmosphere-dev-crm-credential-key-do-not-use-in-production';

export function resolveCrmCredentialKeyMaterial(
  env: NodeJS.ProcessEnv = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): string {
  const dedicated = env.CRM_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? '';
  if (dedicated) return dedicated;
  if (isProduction) {
    throw new Error(
      'Missing required environment variable: CRM_CREDENTIAL_ENCRYPTION_KEY. ' +
        'Connect CRM passwords are sealed only with this key. ' +
        'Set it to the material that sealed existing rows ' +
        '(previously whichever of CRM_CREDENTIAL_KEY, INTEGRATIONS_CREDENTIAL_KEY, ' +
        'or DEVICE_PEPPER was actually in effect). There is no fallback.',
    );
  }
  return DEV_CRM_CREDENTIAL_KEY;
}
