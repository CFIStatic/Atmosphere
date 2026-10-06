/**
 * "What websites can you log in to?" and other questions about what Chat can
 * do in a browser. Answered directly from what Computer actually does, so the
 * question never falls onto an uploaded file or the job record.
 */
import { looksLikeComputerTask } from './askTools.js';

const SELF = /\b(?:you|u|ya|your)\b/i;
const LOGIN = /\b(?:log\s*-?\s*(?:in|on)(?:to)?|logins?|logged\s+in|sign\s*-?\s*(?:in|on)(?:to)?|signed\s+in|signin|passwords?|accounts?)\b/i;
const BROWSER = /\b(?:computer|browser|browse)\b/i;
const SITES = /\b(?:websites?|web\s*sites?|sites|portals?)\b/i;
const ASKING = /\b(?:can|could|are|able|which|what|do|does|will|would|how)\b|\?\s*$/i;
const LOOKUP = /\b(?:search|look\s*up|find|price|prices|news|weather|score)\b/i;

export function looksLikeComputerCapabilityAsk(question: string): boolean {
  const q = String(question ?? '').trim();
  if (!q || !SELF.test(q) || !ASKING.test(q)) return false;
  if (looksLikeComputerTask(q)) return false;
  if (LOGIN.test(q) || BROWSER.test(q)) return true;
  return SITES.test(q) && /\b(?:able|can|could|which|what)\b/i.test(q) && !LOOKUP.test(q);
}

export function computerCapabilityAnswer(input: { access: 'org' | 'viewer'; configured: boolean }): string {
  if (input.access !== 'org') {
    return "I can answer questions about this job and look things up on the public web, but I can't sign in to or work on websites from here.";
  }
  if (!input.configured) {
    return "Computer isn't set up for this account yet, so I can't sign in to or work on websites for you right now. I can still answer from this job file and search the public web.";
  }
  return [
    "There's no fixed list. With Computer I can open a browser and work on almost any website for this job — claim portals, permit sites, Outlook, Gmail, AccuLynx, JobNimbus, Salesforce — and I stop and check with you before anything is submitted, sent, paid, signed or deleted.",
    "Sign in once from Logins in the sidebar (a Global Admin can save the username and password encrypted). I use that saved login to sign back in on my own; Atmosphere's AI never sees the password. If the site asks for a code or to approve a number on your phone, I tell you what to do in Chat and wait.",
    "Ask me to email someone a status update, fill a form, check what's outstanding in your CRM for this job, build the estimate inside Xactimate Online (sketch first), message the adjuster in XactAnalysis or by email, or list materials from this job file and order them from Home Depot (Lowe's, ABC Supply, and SRS use the same Approve-gated design next). I pull people, claim details, rooms, measurements, and materials from the job file first, work in the live site, report back in plain professional English, and flag anything that needs attention. Nothing is purchased until you press Approve.",
    "If I get stuck on an unfamiliar screen I look up how to do that step on the public web, try again, and ask you a clear question if I still need help.",
  ].join('\n\n');
}
