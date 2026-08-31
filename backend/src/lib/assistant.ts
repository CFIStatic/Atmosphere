import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { ROLE_LABELS, WORK_TYPE_LABELS } from './labels.js';
import type { AssistantTurn, AssistantContext } from './validation.js';
import { tryExtractUsage, type MeasuredUsage } from './anthropic.js';

/**
 * The voice assistant behind the technician app.
 *
 * Replies are spoken aloud by the browser, so the whole design optimises for
 * *short* and *fast*: low effort, a small token cap, and a system prompt that
 * asks for a couple of sentences. Long paragraphs are unusable when a
 * technician is holding a phone in one hand on a jobsite.
 *
 * The Anthropic key is optional. Without it `generateReply` falls back to a
 * deterministic rule-based responder, so the mic, the recorder, and the
 * speech output all still work end-to-end on a fresh checkout.
 */

const SYSTEM_PROMPT = `You are the Atmosphere field assistant — a voice companion for a technician working a mitigation or construction job site.

You are being LISTENED TO, not read. Every word you write is spoken aloud through a phone speaker, often in a noisy environment.

- Answer in one to three short sentences. Never more.
- Use plain spoken language. No markdown, no bullet points, no headings, no code blocks, no emoji — none of it survives text-to-speech.
- Write numbers, units, and measurements the way a person says them ("about twelve inches", "two by four", "sixty percent relative humidity").
- Lead with the answer. If you need to add a caveat, put it in the last sentence.
- If the technician is dictating a note rather than asking a question, confirm you captured it in a few words instead of commenting on it.
- If you genuinely do not know something job-specific — a reading, a customer's name, what is behind a wall — say so plainly and ask the one question that would resolve it.
- Safety comes first. If what you hear describes a hazard (standing water near power, structural damage, suspected asbestos or lead, gas), say so immediately and directly.`;

/** What the assistant knows about who it is talking to, rendered for the model. */
function describeContext(context: AssistantContext | undefined): string | null {
  if (!context) return null;

  const parts: string[] = [];
  if (context.role) parts.push(`They are a ${ROLE_LABELS[context.role]}.`);
  if (context.workType) parts.push(`Their line of work is ${WORK_TYPE_LABELS[context.workType]}.`);
  if (context.orgName) parts.push(`They work for ${context.orgName}.`);

  // The live camera feed is a first-class input: the technician can ask "what
  // am I looking at" and the detector's labels are what makes that answerable.
  if (context.detectedObjects?.length) {
    parts.push(
      `Their phone camera is pointed at something and on-device object detection currently sees: ${context.detectedObjects.join(', ')}. Only mention this if it is relevant to what they asked.`,
    );
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

/** Trim history so a long shift does not grow the request without bound. */
const MAX_HISTORY_TURNS = 20;

export interface AssistantReply {
  reply: string;
  /** False when the rule-based fallback answered, so the UI can say so. */
  model: string | null;
  usage: MeasuredUsage | null;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.technician.assistant.apiKey) return null;
  client ??= new Anthropic({ apiKey: config.technician.assistant.apiKey });
  return client;
}

/** Whether a real model is wired up, for the capabilities endpoint. */
export function assistantEnabled(): boolean {
  return Boolean(config.technician.assistant.apiKey);
}

export async function generateReply(
  message: string,
  history: AssistantTurn[],
  context?: AssistantContext,
): Promise<AssistantReply> {
  const anthropic = getClient();
  if (!anthropic) {
    return { reply: fallbackReply(message, context), model: null, usage: null };
  }

  const contextLine = describeContext(context);
  const system = contextLine ? `${SYSTEM_PROMPT}\n\nAbout this technician: ${contextLine}` : SYSTEM_PROMPT;

  const response = await anthropic.messages.create({
    model: config.technician.assistant.model,
    max_tokens: config.technician.assistant.maxTokens,
    system,
    // Low effort keeps the round trip short enough to feel like a conversation.
    // Thinking stays on (the model's default) — disabling it buys little here
    // and risks reasoning leaking into text that gets spoken aloud.
    output_config: { effort: 'low' },
    messages: [
      ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: 'user' as const, content: message },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return {
      reply: "I can't help with that one. Ask me something else about the job and I'll pick it back up.",
      model: response.model,
      usage: tryExtractUsage(response.usage),
    };
  }

  const reply = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();

  return {
    reply: reply || "Sorry — I didn't catch that. Say it again?",
    model: response.model,
    usage: tryExtractUsage(response.usage),
  };
}

/**
 * The no-API-key path. It is deliberately dumb but never silent: a technician
 * pressing the mic button should always hear something back, and a note they
 * dictate is still captured in the transcript above the reply.
 */
function fallbackReply(message: string, context?: AssistantContext): string {
  const text = message.trim().toLowerCase();

  if (!text) return "I didn't hear anything. Try holding the mic button a little longer.";

  if (/^(hi|hey|hello|good (morning|afternoon|evening))\b/.test(text)) {
    return 'Hey. I can record audio and video, and call out what the camera sees. What do you need?';
  }

  if (/\b(what|which).*(see|looking at|camera)\b/.test(text)) {
    const seen = context?.detectedObjects;
    return seen?.length
      ? `The camera is picking up ${seen.join(', ')}.`
      : "The camera isn't picking anything out right now. Start detection on the video tab and point it at the area.";
  }

  if (/\b(record|recording|start|stop)\b/.test(text)) {
    return 'Use the record button on the audio or video tab. Everything you capture stays on this device until you download it.';
  }

  if (text.endsWith('?')) {
    return "I've got that written down, but I can't answer questions until an assistant key is set up on the server.";
  }

  return `Noted: ${message.trim()}`;
}
