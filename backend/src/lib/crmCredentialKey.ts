/**
 * Key material for Connect CRM password sealing (AES-256-GCM via scrypt).
 *
 * Production reads only CRM_CREDENTIAL_KEY. INTEGRATIONS_CREDENTIAL_KEY and
 * DEVICE_PEPPER are not fallbacks — a missing CRM_CREDENTIAL_KEY fails
 * closed at boot. On Railway, CRM_CREDENTIAL_KEY is a reference to the
 * same material as DEVICE_PEPPER so existing ciphertext still opens.
 *
 * Outside production, an unset key uses DEV_CRM_CREDENTIAL_KEY so local
 * boot does not require the variable. That placeholder will not open
 * ciphertext sealed with another secret. Set CRM_CREDENTIAL_KEY locally
 * to the same material if you need to read existing rows.
 */

export const DEV_CRM_CREDENTIAL_KEY =
  'atmosphere-dev-crm-credential-key-do-not-use-in-production';

export function resolveCrmCredentialKeyMaterial(
  env: NodeJS.ProcessEnv = process.env,
  isProduction = (env.NODE_ENV ?? 'development') === 'production',
): string {
  const dedicated = env.CRM_CREDENTIAL_KEY?.trim() ?? '';
  if (dedicated) return dedicated;
  if (isProduction) {
    throw new Error(
      'Missing required environment variable: CRM_CREDENTIAL_KEY. ' +
        'Connect CRM passwords are sealed only with this key. ' +
        'There is no fallback to INTEGRATIONS_CREDENTIAL_KEY or DEVICE_PEPPER.',
    );
  }
  return DEV_CRM_CREDENTIAL_KEY;
}
