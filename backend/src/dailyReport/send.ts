import { sendSystemMail } from '../lib/systemMail.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { logger } from '../lib/logger.js';
import { dailyJobReportEmail } from './email.js';
import type {
  DailyJobGlanceReport,
  DailyReportChannel,
  DailyReportRecipients,
} from './types.js';

export type SendDailyReportResult = {
  ok: boolean;
  emailed: string[];
  smsSkipped: boolean;
  error?: string;
};

/**
 * Deliver via Resend/SMTP. SMS preference is honored only when a provider
 * exists — none is wired today, so we email and log the skip.
 */
export async function sendDailyJobReport(input: {
  report: DailyJobGlanceReport;
  recipients: DailyReportRecipients;
  channel: DailyReportChannel;
}): Promise<SendDailyReportResult> {
  const wantEmail = true; // always email when SMS provider is absent
  const wantSms = input.channel === 'sms' || input.channel === 'email_and_sms';

  let smsSkipped = false;
  if (wantSms) {
    smsSkipped = true;
    logger.info('daily_report_sms_skipped', {
      jobId: input.report.jobId,
      reason: 'no_sms_provider',
      phones: input.recipients.phones.length,
    });
  }

  if (!wantEmail || input.recipients.emails.length === 0) {
    return {
      ok: false,
      emailed: [],
      smsSkipped,
      error: 'no_recipients',
    };
  }

  const mail = dailyJobReportEmail({
    report: input.report,
    origin: publicAppOrigin(),
  });

  const emailed: string[] = [];
  const errors: string[] = [];
  for (const to of input.recipients.emails) {
    const result = await sendSystemMail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (result.ok) emailed.push(to);
    else errors.push(`${to}:${'why' in result ? result.why : 'send_failed'}`);
  }

  return {
    ok: emailed.length > 0,
    emailed,
    smsSkipped,
    error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
  };
}
