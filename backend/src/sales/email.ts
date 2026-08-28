import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import {
  ATMOSPHERE_PRODUCT_BLURB,
  ATMOSPHERE_PRODUCT_NAME,
  DEMO_CTA,
  resolveCampaignMessaging,
} from './atmosphereProduct.js';
import type { DraftEmail, ReplyIntent } from './types.js';

/**
 * Atmosphere GTM email drafting + optional delivery via Resend.
 *
 * Outreach pitches Atmosphere to restoration/construction buyers and CTAs a
 * product demo. Without RESEND_API_KEY, messages are marked simulated so the
 * follow-up / demo-booking loop can still be exercised end-to-end.
 */

export function emailDeliveryEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && (process.env.SALES_FROM_EMAIL || true));
}

export function salesFromAddress(fallback?: string | null): string {
  return (
    process.env.SALES_FROM_EMAIL ||
    fallback ||
    'outreach@atmosphere.local'
  );
}

export async function draftPersonalizedEmail(input: {
  senderName: string;
  senderOrg?: string | null;
  territory: string;
  salesFocus: string;
  valueProp?: string | null;
  businessName: string;
  contactName: string;
  contactTitle?: string | null;
  researchSummary?: string | null;
  hooks: string[];
  sequenceStep: number;
}): Promise<DraftEmail> {
  const {
    senderName,
    senderOrg,
    territory,
    salesFocus,
    valueProp,
    businessName,
    contactName,
    contactTitle,
    researchSummary,
    hooks,
    sequenceStep,
  } = input;

  const messaging = resolveCampaignMessaging({
    salesFocus,
    valueProp,
    senderName,
    senderOrg,
  });

  if (config.anthropic.apiKey) {
    try {
      const client = new Anthropic({ apiKey: config.anthropic.apiKey });
      const message = await client.messages.create({
        model: config.anthropic.defaultModel,
        max_tokens: 700,
        messages: [
          {
            role: 'user',
            content: `Write a short B2B outbound email selling ${ATMOSPHERE_PRODUCT_NAME} (sequence step ${sequenceStep}).

Product context:
${ATMOSPHERE_PRODUCT_BLURB}

Rules:
- 90–140 words max for step 1; shorter for follow-ups
- Specific to the person and restoration/construction business; no hype, no fake claims
- Pitch Atmosphere as the product — work verification, field capture, web access, audit trail
- Soft CTA: suggest ${DEMO_CTA} so a salesperson can walk them through the product and close
- Plain text only
- Return JSON: {"subject":"...","body":"..."}

Sender: ${messaging.senderName} at ${messaging.senderOrg}
Territory: ${territory}
ICP / buyer focus: ${messaging.salesFocus}
Value prop: ${messaging.valueProp}
Company: ${businessName}
Contact: ${contactName}${contactTitle ? `, ${contactTitle}` : ''}
Research: ${researchSummary || 'n/a'}
Hooks: ${hooks.join('; ') || 'n/a'}`,
          },
        ],
      });

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
        if (parsed.subject && parsed.body) {
          return {
            subject: String(parsed.subject).slice(0, 500),
            body: String(parsed.body).slice(0, 20000),
          };
        }
      }
    } catch {
      // fall through to template
    }
  }

  return templateEmail(input);
}

function templateEmail(input: {
  senderName: string;
  senderOrg?: string | null;
  territory: string;
  salesFocus: string;
  valueProp?: string | null;
  businessName: string;
  contactName: string;
  contactTitle?: string | null;
  hooks: string[];
  sequenceStep: number;
}): DraftEmail {
  const messaging = resolveCampaignMessaging({
    salesFocus: input.salesFocus,
    valueProp: input.valueProp,
    senderName: input.senderName,
    senderOrg: input.senderOrg,
  });
  const first = input.contactName.split(/\s+/)[0] || input.contactName;
  const hook = input.hooks[0] ? ` I noticed ${input.hooks[0].toLowerCase()}.` : '';

  if (input.sequenceStep === 1) {
    return {
      subject: `${ATMOSPHERE_PRODUCT_NAME} for ${input.businessName}`,
      body: `Hi ${first},

I'm ${messaging.senderName} at ${messaging.senderOrg}. We build AI for restoration and construction teams in ${input.territory}.${hook}

${messaging.valueProp}

Would you be open to ${DEMO_CTA} next week? Happy to work around your schedule — our reps live in demos and closing conversations all day.

Best,
${messaging.senderName}`,
    };
  }

  if (input.sequenceStep === 2) {
    return {
      subject: `Re: ${ATMOSPHERE_PRODUCT_NAME} for ${input.businessName}`,
      body: `Hi ${first},

Just floating this back up in case it got buried. Still glad to show ${input.businessName} a short Atmosphere product demo — work verification, field capture, and web access in one walkthrough.

If now isn't right, tell me and I'll close the loop.

Thanks,
${messaging.senderName}`,
    };
  }

  return {
    subject: `Re: ${ATMOSPHERE_PRODUCT_NAME} for ${input.businessName}`,
    body: `Hi ${first},

Last note from me — if a quick Atmosphere demo would help ${input.businessName} move faster on ${messaging.salesFocus}, I'm happy to book a time. Otherwise I'll assume the timing isn't right.

Appreciate your time,
${messaging.senderName}`,
  };
}

export async function sendEmail(input: {
  to: string;
  from: string;
  fromName?: string | null;
  subject: string;
  body: string;
  replyTo?: string | null;
}): Promise<{ status: 'sent' | 'simulated' | 'failed'; providerMessageId?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { status: 'simulated', providerMessageId: `sim_${Date.now()}` };
  }

  // Don't actually email example.com / .local addresses — treat as simulated.
  if (/\.example$|example\.com$|\.local$/i.test(input.to)) {
    return { status: 'simulated', providerMessageId: `sim_${Date.now()}` };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.fromName ? `${input.fromName} <${input.from}>` : input.from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
        reply_to: input.replyTo || undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { status: 'failed', error: errText.slice(0, 500) };
    }
    const data = (await res.json()) as { id?: string };
    return { status: 'sent', providerMessageId: data.id };
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'send_failed',
    };
  }
}

export async function classifyReply(body: string): Promise<ReplyIntent> {
  const text = body.toLowerCase();
  if (/\bunsubscribe\b|\bremove me\b|\bstop emailing\b/.test(text)) return 'unsubscribe';
  if (/\bnot interested\b|\bno thanks\b|\bpass\b|\bdon't contact\b/.test(text)) {
    return 'not_interested';
  }
  if (/\bnext (quarter|month|year)\b|\blater\b|\bcircle back\b|\bbusy right now\b/.test(text)) {
    return 'ask_later';
  }
  if (
    /\b(meet|meeting|schedule|book|calendar|available|coffee|come by|visit|in person|demo|walkthrough|sounds good|interested|let'?s talk|show me|product)\b/.test(
      text,
    )
  ) {
    return 'interested';
  }

  if (!config.anthropic.apiKey) return 'unclear';

  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const message = await client.messages.create({
      model: config.anthropic.defaultModel,
      max_tokens: 40,
      messages: [
        {
          role: 'user',
          content: `Classify this sales email reply as one of: interested, not_interested, ask_later, unsubscribe, unclear.
Reply with only the label.

EMAIL:
${body.slice(0, 4000)}`,
        },
      ],
    });
    const label = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toLowerCase();
    if (
      label === 'interested' ||
      label === 'not_interested' ||
      label === 'ask_later' ||
      label === 'unsubscribe' ||
      label === 'unclear'
    ) {
      return label;
    }
  } catch {
    // ignore
  }
  return 'unclear';
}

/** Default follow-up offsets in days for sequence steps 1→2→3. */
export const FOLLOWUP_DAYS = [3, 7, 14] as const;

export function nextFollowupAt(from: Date, sequenceStep: number): Date | null {
  const idx = sequenceStep - 1;
  if (idx < 0 || idx >= FOLLOWUP_DAYS.length - 1) return null;
  const days = FOLLOWUP_DAYS[idx];
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
