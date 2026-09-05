import { config } from '../config.js';
import { logger } from './logger.js';
import { resolveLeftoverSurfaces, type LeftoverSurfaceFlags } from './platformSurfaces.js';

const PERSONAL_INBOX_RE = /@(yahoo|gmail|googlemail|hotmail|outlook|live|icloud)\./i;

export type MockDriverInputs = {
  allowMockDrivers: boolean;
  xactimateDriver: string;
  crmSyncDriver: string;
  emailMarketingProvider: string;
  surfaces: LeftoverSurfaceFlags;
};

/**
 * Production must not silently serve mock leftover drivers.
 *
 * `ALLOW_MOCK_DRIVERS=true` is refused in production (it used to be synced
 * onto Railway by deploy-production.yml). Mock Xactimate / CRM / email
 * marketing are fine only while those leftover surfaces stay gated off.
 * Re-enabling a surface without a real driver fails boot.
 */
export function mockDriverViolations(input: MockDriverInputs): string[] {
  const errors: string[] = [];
  if (input.allowMockDrivers) {
    errors.push(
      'ALLOW_MOCK_DRIVERS=true is not permitted in production. Unset it. Leftover surfaces stay gated off; do not mock a surface that is enabled.',
    );
  }
  if (input.surfaces.estimator && input.xactimateDriver === 'mock') {
    errors.push(
      'ENABLE_ESTIMATOR is on but XACTIMATE_DRIVER=mock. Set a real driver or leave the estimator surface gated off.',
    );
  }
  if (input.surfaces.crmSync && input.crmSyncDriver === 'mock') {
    errors.push(
      'ENABLE_CRM_SYNC is on but CRM_SYNC_DRIVER=mock. Set CRM_SYNC_DRIVER=api or leave crm-sync gated off.',
    );
  }
  if (input.surfaces.emailMarketing && input.emailMarketingProvider === 'log') {
    errors.push(
      'ENABLE_EMAIL_MARKETING is on but EMAIL_MARKETING_PROVIDER=log. Set resend or leave email marketing gated off.',
    );
  }
  return errors;
}

/**
 * Fail-loud checks that must pass before a production process serves traffic.
 * Called once at boot from `index.ts` after config has loaded.
 *
 * Leftover mock drivers (Xactimate / CRM / email marketing) are allowed only
 * while those APIs stay unmounted. `ALLOW_MOCK_DRIVERS` cannot silence this
 * in production.
 */
export function assertProductionReady(): void {
  if (!config.isProduction) return;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.supabase.serviceRoleKey) {
    errors.push(
      'SUPABASE_SERVICE_ROLE_KEY is required in production (PIN unlock, proof storage, media catalog, schedulers).',
    );
  }

  if (config.media.backend === 'memory') {
    errors.push(
      'MEDIA_BACKEND=memory cannot be used in production — evidence would never leave the process.',
    );
  }

  if (config.media.backend === 's3') {
    errors.push(
      'MEDIA_BACKEND=s3 selects the S3 stub (s3.example.invalid). Use MEDIA_BACKEND=supabase until a real S3 driver ships, or set ALLOW_S3_STUB=true only for contract integration tests.',
    );
    if (process.env.ALLOW_S3_STUB === 'true') {
      // Explicit escape hatch for client contract work against the stub.
      errors.pop();
      warnings.push(
        'MEDIA_BACKEND=s3 is the stub driver (ALLOW_S3_STUB=true). Uploads will not reach real object storage.',
      );
    }
  }

  for (const [label, email] of [
    ['CONTACT_TO_EMAIL', config.contact.toEmail],
    ['CAREERS_TO_EMAIL', config.careers.toEmail],
  ] as const) {
    if (!email) {
      errors.push(`${label} must be set in production.`);
      continue;
    }
    if (PERSONAL_INBOX_RE.test(email)) {
      errors.push(
        `${label}=${email} looks like a personal inbox. Set a company mailbox before serving the public site forms.`,
      );
    }
  }

  if (!config.careers.fromEmail) {
    warnings.push(
      'CAREERS_FROM_EMAIL (or SMTP_USER) is unset — Atmosphere cannot send invites or OTPs until a from-address is configured.',
    );
  }
  const smtpReady = Boolean(
    config.careers.smtp.host && config.careers.smtp.user && config.careers.smtp.pass,
  );
  const resendReady = Boolean(process.env.RESEND_API_KEY?.trim());
  if (!smtpReady && !resendReady) {
    warnings.push(
      'Neither SMTP nor RESEND_API_KEY is configured — invite and OTP email will fall back to copy-link behaviour.',
    );
  }

  const surfaces = resolveLeftoverSurfaces(process.env, true);
  errors.push(
    ...mockDriverViolations({
      allowMockDrivers: process.env.ALLOW_MOCK_DRIVERS === 'true',
      xactimateDriver: config.xactimate.driver,
      crmSyncDriver: config.crmSync.driver,
      emailMarketingProvider: config.emailMarketing.provider,
      surfaces,
    }),
  );

  if (!surfaces.estimator && config.xactimate.driver === 'mock') {
    warnings.push('XACTIMATE_DRIVER=mock — unused because the estimator surface is gated off.');
  }
  if (!surfaces.crmSync && config.crmSync.driver === 'mock') {
    warnings.push('CRM_SYNC_DRIVER=mock — unused because crm-sync is gated off.');
  }
  if (!surfaces.emailMarketing && config.emailMarketing.provider === 'log') {
    warnings.push('EMAIL_MARKETING_PROVIDER=log — unused because email marketing is gated off.');
  }

  for (const warning of warnings) {
    logger.warn('production_guard', { detail: warning });
  }

  if (errors.length > 0) {
    for (const detail of errors) {
      logger.error('production_guard', { detail });
    }
    throw new Error(
      `Production configuration is not safe to start:\n- ${errors.join('\n- ')}\n` +
        'See docs/production.md and backend/.env.example.',
    );
  }
}
