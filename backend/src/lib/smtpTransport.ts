import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

/**
 * Shared SMTP client. Careers, contact, and system mail all use the same
 * account — hosting never means changing this, only env.
 */

let transporter: Transporter | null = null;

/** True when the SMTP transport itself is usable, regardless of destination. */
export function smtpConfigured(): boolean {
  const { host, user, pass } = config.careers.smtp;
  return Boolean(host && user && pass);
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
