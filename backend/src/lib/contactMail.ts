import { config } from '../config.js';
import { sendSystemMail, systemMailConfigured } from './systemMail.js';
import type { ContactMessage } from './validation.js';

/**
 * Delivery for contact-form messages: one email per message to the sales
 * inbox (CONTACT_TO_EMAIL, falling back to the careers inbox). Uses the
 * same authenticated Atmosphere mail path as invites (Resend first).
 */

export function contactMailConfigured(): boolean {
  return systemMailConfigured() && Boolean(config.contact.toEmail);
}

/** Render the message as a plain-text email body. */
export function renderContactEmail(msg: ContactMessage): string {
  return [
    `Name:     ${msg.name}`,
    `Email:    ${msg.email}`,
    msg.company ? `Company:  ${msg.company}` : null,
    msg.teamSize ? `Team:     ${msg.teamSize}` : null,
    msg.workType ? `Work:     ${msg.workType}` : null,
    '',
    msg.message,
    '',
    '—',
    'Sent from the Atmosphere contact page.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Send one contact message to the sales inbox. Throws on transport failure. */
export async function sendContactEmail(msg: ContactMessage): Promise<void> {
  const result = await sendSystemMail({
    to: config.contact.toEmail,
    subject: `Contact — ${msg.company || msg.name}`,
    text: renderContactEmail(msg),
    replyTo: `"${msg.name.replaceAll('"', "'")}" <${msg.email}>`,
    keepReplyTo: true,
  });
  if (!result.ok) {
    throw new Error(result.why);
  }
}
