import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { regulationPromptBlock, type RegulationBrief } from './regulations.js';

/**
 * Homeowner-facing Q&A assistant. Answers about job progress, who to call,
 * and general home-insurance concepts for the property's state and carrier.
 * Never invents coverage decisions or internal crew notes.
 */

const SYSTEM_PROMPT = `You are the Atmosphere HomeOwner Report assistant for a restoration customer.

You help the homeowner understand:
- what is happening on their specific job (using only the job facts provided),
- tentative schedule and next steps,
- who to call,
- general home insurance / property claim concepts for their location and carrier,
- questions about a policy they uploaded (if policy text is provided).

Rules:
- Be clear, calm, and concrete. Prefer short paragraphs over long essays.
- Never invent claim approvals, dollar amounts, or coverage decisions.
- If something is not in the job facts or policy text, say you do not know and suggest asking the restoration office or the adjuster.
- Do not reveal internal crew notes, alerts, unpaid invoices, or anything marked as not shared.
- Remind them that insurance guidance is educational, not legal advice.
- If they ask something unsafe or unrelated, redirect to their job or insurance question.`;

export interface PortalAskContext {
  orgName: string | null;
  customerName: string | null;
  jobFacts: string;
  regulation: RegulationBrief;
  policyText: string | null;
}

export interface PortalAskResult {
  reply: string;
  model: string | null;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.technician.assistant.apiKey) return null;
  client ??= new Anthropic({ apiKey: config.technician.assistant.apiKey });
  return client;
}

export function portalAssistantEnabled(): boolean {
  return Boolean(config.technician.assistant.apiKey);
}

export async function answerHomeownerQuestion(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  ctx: PortalAskContext,
): Promise<PortalAskResult> {
  const anthropic = getClient();
  if (!anthropic) {
    return { reply: fallbackAnswer(question, ctx), model: null };
  }

  const system = [
    SYSTEM_PROMPT,
    '',
    `Restoration company: ${ctx.orgName ?? 'the restoration company'}.`,
    ctx.customerName ? `Homeowner name on file: ${ctx.customerName}.` : null,
    '',
    'Job facts the homeowner is allowed to see:',
    ctx.jobFacts,
    '',
    regulationPromptBlock(ctx.regulation),
    ctx.policyText
      ? `\nUploaded policy text (excerpt for grounding):\n${ctx.policyText.slice(0, 24_000)}`
      : '\nNo policy text uploaded yet.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await anthropic.messages.create({
    model: config.technician.assistant.model,
    max_tokens: Math.max(config.technician.assistant.maxTokens, 700),
    system,
    messages: [
      ...history.slice(-16).map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: 'user' as const, content: question },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return {
      reply:
        'I cannot help with that request. Ask about your job progress, schedule, contacts, or your insurance policy.',
      model: response.model,
    };
  }

  const reply = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return {
    reply: reply || 'Sorry — I could not form an answer. Try rephrasing your question.',
    model: response.model,
  };
}

function fallbackAnswer(question: string, ctx: PortalAskContext): string {
  const q = question.toLowerCase();
  if (q.includes('call') || q.includes('phone') || q.includes('contact')) {
    return (
      'Check the Who to call section on this report for the office and adjuster numbers shared for your job. ' +
      'If a number is missing, reply in chat and the restoration team will follow up.'
    );
  }
  if (q.includes('schedule') || q.includes('when')) {
    return (
      'Your tentative schedule is on the Progress tab when the company has shared it. ' +
      'Dates can move after inspections or carrier approvals — ask in chat if something looks out of date.'
    );
  }
  if (q.includes('policy') || q.includes('deductible') || q.includes('cover')) {
    const tip = ctx.regulation.bullets[0] ?? 'Confirm coverage questions with your adjuster in writing.';
    return (
      `${tip} ` +
      (ctx.policyText
        ? 'I can see your uploaded policy text once the live assistant is configured; for now, use chat to ask the office a specific clause question.'
        : 'Upload your policy (or paste the declarations page) to get more specific answers.') +
      ` ${ctx.regulation.disclaimer}`
    );
  }
  return (
    `Here is what we know about your job:\n${ctx.jobFacts}\n\n` +
    `For ${ctx.regulation.regionLabel} / ${ctx.regulation.carrierLabel ?? 'your carrier'}: ${ctx.regulation.bullets[0]} ` +
    ctx.regulation.disclaimer
  );
}
