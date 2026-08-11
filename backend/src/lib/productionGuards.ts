import { config } from '../config.js';
import { logger } from './logger.js';

const PERSONAL_INBOX_RE = /@(yahoo|gmail|googlemail|hotmail|outlook|live|icloud)\./i;

/**
 * Fail-loud checks that must pass before a production process serves traffic.
 * Called once at boot from `index.ts` after config has loaded.
 *
 * Soft warnings (mock drivers the verification path does not need) go to logs
 * but do not abort — set `ALLOW_MOCK_DRIVERS=true` to silence those warnings
 * when a non-verification surface is intentionally mocked.
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

  const allowMock = process.env.ALLOW_MOCK_DRIVERS === 'true';
  if (!allowMock) {
    if (config.xactimate.driver === 'mock') {
      warnings.push(
        'XACTIMATE_DRIVER=mock — estimator writes will not reach Xactimate. Set a real driver or ALLOW_MOCK_DRIVERS=true.',
      );
    }
    if (config.crmSync.driver === 'mock') {
      warnings.push(
        'CRM_SYNC_DRIVER=mock — job-file sync will not call a vendor CRM. Set CRM_SYNC_DRIVER=api or ALLOW_MOCK_DRIVERS=true.',
      );
    }
    if (config.emailMarketing.provider === 'log') {
      warnings.push(
        'EMAIL_MARKETING_PROVIDER=log — marketing sends are logged only. Set resend (or ALLOW_MOCK_DRIVERS=true).',
      );
    }
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
