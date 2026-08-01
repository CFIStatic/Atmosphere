import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import type { CareersApplication } from './validation.js';

/**
 * Delivery for careers applications: one email per application to the hiring
 * inbox (CAREERS_TO_EMAIL), sent over whatever SMTP account is configured.
 *
 * The transport is a plain SMTP client on purpose — every mail provider a
 * small company might use (Google Workspace, Fastmail, SES, Resend, Postmark)
 * speaks it, so hosting the site never means changing this code, only env.
 */

let transporter: Transporter | null = null;

/** True when the SMTP transport itself is usable, regardless of destination. */
export function smtpConfigured(): boolean {
  const { host, user, pass } = config.careers.smtp;
  return Boolean(host && user && pass);
}

export function careersMailConfigured(): boolean {
  return smtpConfigured() && Boolean(config.careers.toEmail);
}

export function getTransporter(): Transporter {
  if (!transporter) {
    const { host, port, secure, user, pass } = config.careers.smtp;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }
  return transporter;
}

/** Render the application as a plain-text email body. */
export function renderApplicationEmail(app: CareersApplication): string {
  return [
    `Role:  ${app.role}`,
    `Name:  ${app.name}`,
    `Email: ${app.email}`,
    app.links ? `Links: ${app.links}` : null,
    '',
    app.message,
    '',
    '—',
    'Sent from the Atmosphere careers page.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Send one application to the hiring inbox. Throws on transport failure. */
export async function sendApplicationEmail(app: CareersApplication): Promise<void> {
  await getTransporter().sendMail({
    from: `"Atmosphere Careers" <${config.careers.fromEmail}>`,
    to: config.careers.toEmail,
    replyTo: `"${app.name.replaceAll('"', "'")}" <${app.email}>`,
    subject: `Careers application — ${app.role} — ${app.name}`,
    text: renderApplicationEmail(app),
  });
}
