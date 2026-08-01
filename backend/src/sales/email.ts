import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { DraftEmail, ReplyIntent } from './types.js';

/**
 * Personalised email drafting + optional delivery via Resend.
 *
 * Without RESEND_API_KEY (or SALES_FROM_EMAIL), messages are marked simulated
 * so the follow-up / scheduling loop can still be exercised end-to-end.
 */

export function emailDeliveryEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && (process.env.SALES_FROM_EMAIL || true));
}

export function salesFromAddress(fallback?: string | null): string {
  return (
    process.env.SALES_FROM_EMAIL ||
    fallback ||
    'sales-agent@atmosphere.local'
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

  if (config.anthropic.apiKey) {
    try {
      const client = new Anthropic({ apiKey: config.anthropic.apiKey });
      const message = await client.messages.create({
        model: config.anthropic.defaultModel,
        max_tokens: 700,
        messages: [
          {
            role: 'user',
            content: `Write a short B2B outreach email (sequence step ${sequenceStep}).

Rules:
- 90–140 words max for step 1; shorter for follow-ups
- Specific to the person and business; no hype, no fake claims
- Soft CTA: suggest a brief in-person meeting
- Plain text only
- Return JSON: {"subject":"...","body":"..."}

Sender: ${senderName}${senderOrg ? ` at ${senderOrg}` : ''}
Territory: ${territory}
What we sell / focus: ${salesFocus}
Value prop: ${valueProp || '(not provided)'}
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
  const first = input.contactName.split(/\s+/)[0] || input.contactName;
  const hook = input.hooks[0] ? ` I noticed ${input.hooks[0].toLowerCase()}.` : '';
  const orgBit = input.senderOrg ? ` with ${input.senderOrg}` : '';

  if (input.sequenceStep === 1) {
    return {
      subject: `Quick idea for ${input.businessName}`,
      body: `Hi ${first},

I'm ${input.senderName}${orgBit}. We help teams in ${input.territory} with ${input.salesFocus}.${hook}
${input.valueProp ? `\n${input.valueProp}\n` : ''}
Would you be open to a short in-person meeting next week to see if there's a fit? Happy to work around your schedule.

Best,
${input.senderName}`,
    };
  }

  if (input.sequenceStep === 2) {
    return {
      subject: `Re: Quick idea for ${input.businessName}`,
      body: `Hi ${first},

Just floating this back to the top in case it got buried. Still glad to meet briefly about ${input.salesFocus} for ${input.businessName}.

If now isn't right, tell me and I'll close the loop.

Thanks,
${input.senderName}`,
    };
  }

  return {
    subject: `Re: Quick idea for ${input.businessName}`,
    body: `Hi ${first},

Last note from me — if a quick in-person chat on ${input.salesFocus} would be useful, I'm happy to book a time that works for you. Otherwise I'll assume the timing isn't right.

Appreciate your time,
${input.senderName}`,
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
    /\b(meet|meeting|schedule|book|calendar|available|coffee|come by|visit|in person|sounds good|interested|let'?s talk)\b/.test(
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
