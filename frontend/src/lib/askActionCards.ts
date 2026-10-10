/**
 * One-click next steps under a Chat answer. Each card is a prepared request
 * that goes back through Chat, so it uses the same tools and the same
 * approvals as typing it (a text message is still shown for approval before
 * it is sent). "send" asks right away; "prefill" puts the words in the box for
 * the person to finish, for steps that need detail only they know.
 */

export interface AskActionCard {
  id: 'punch' | 'homeowner' | 'computer';
  label: string;
  prompt: string;
  mode: 'send' | 'prefill';
}

const PUNCH = /\b(punch|missing|not (?:yet )?(?:done|finished|complete|installed)|incomplete|outstanding|still needs?|needs? to be (?:fixed|redone|replaced|repaired)|left to do|remaining work|defects?|damaged?)\b/i;
const HOMEOWNER = /\b(homeowners?|insured|customer|client|progress|completed|finished|wrapped up|dry(?:ing)?|moisture readings?)\b/i;
const PORTAL = /\b(portal|carrier|claim (?:form|portal)|supplier|order (?:the |more )?materials|materials? list|purchase order|submit (?:the )?(?:claim|invoice|estimate|form))\b/i;

/** The answer as plain prose: no machine lines, artifacts kept (they count). */
function prose(answer: string): string {
  return String(answer ?? '')
    .replace(/⟦(?:sources|quotes|followups|actions|web)[^⟧]*⟧/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Up to three next steps that fit this answer, most useful first. None for small talk or failures. */
export function askActionCards(input: { question: string; answer: string }): AskActionCard[] {
  const text = prose(input.answer);
  const both = `${input.question} ${text}`;
  if (text.length < 80) return [];
  if (/⟦actions:[^⟧]*start_computer_task/i.test(input.answer)) return [];
  if (/\b(not on (?:the )?file|could not answer|no clips|nothing on file)\b/i.test(text.slice(0, 160))) return [];
  const cards: AskActionCard[] = [];
  if (PUNCH.test(both) && !/punch list/i.test(input.question)) {
    cards.push({ id: 'punch', label: 'Make a punch list', prompt: 'Make a punch list from this.', mode: 'send' });
  }
  if (HOMEOWNER.test(both) && !/homeowner (?:update|summary|email)/i.test(input.question)) {
    cards.push({ id: 'homeowner', label: 'Update the homeowner', prompt: 'Draft a short progress update for the homeowner from this.', mode: 'send' });
  }
  if (PORTAL.test(both)) {
    cards.push({ id: 'computer', label: 'Do it in a browser', prompt: 'Use Computer to ', mode: 'prefill' });
  }
  return cards.slice(0, 3);
}
