/**
 * The approval gate. Every action the model asks for is classified here, in
 * code, before it reaches the browser. The model's own judgement is never
 * the last line: a click that would submit, send, pay, delete, sign, accept
 * terms or upload is blocked unless the worker holds an approved,
 * unconsumed approval token for this task, this site and this button.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ApprovedOrderSelection } from './supplyOrder.js';
import type { ConsequentialKind, NeedsYouReason, TargetDescriptor } from './types.js';

export type GateDecision =
  | { type: 'allow' }
  | { type: 'consequential'; kind: ConsequentialKind; label: string }
  | { type: 'needs_you'; reason: NeedsYouReason; message: string }
  | { type: 'block'; message: string };

const PAY = /\b(pay|payment|purchase|buy|checkout|check out|place (?:your )?order|donate|subscribe|add funds|top up)\b/i;
const DELETE =
  /\b(delete|remove|discard|erase|destroy|deactivate|close (?:my |the )?account|cancel (?:my |the |this )?(?:claim|policy|account|order|subscription|appointment|request|membership))\b/i;
// "Sign in / up / out" is navigation; "Sign", "Sign document", "E-sign" are signatures.
const SIGN = /\b(e-?sign|signature|adopt and sign|sign (?:and|&) (?:submit|send|finish)|sign (?:the |this )?(?:document|form|contract|agreement|here|now))\b|^\s*sign\s*$/i;
const ACCEPT = /\b(i agree|agree|accept|consent|acknowledge|i understand and agree|certify|attest)\b/i;
const SEND = /\b(send|share|invite|reply|post|publish|forward|transmit|notify)\b/i;
const UPLOAD = /\b(upload|attach|choose files?|browse files?|add files?|add photos?|select files?)\b/i;
const SUBMIT =
  /\b(submit|confirm|finish|complete|file (?:a |the |my )?claim|apply|book|schedule|register|sign up|create (?:an |my )?account|authori[sz]e|approve|transfer|enroll|activate|save and (?:submit|send|finish)|request (?:a |an )?(?:quote|inspection|payment|service))\b/i;

/** Buttons that move around a form without committing anything. */
const SAFE_NAV =
  /^(next|continue|back|previous|prev|search|go|find|filter|apply filters?|clear|reset filters?|sign in|log ?in|login|save draft|save as draft|save for later|view|open|close|ok|show more|more|edit|expand|collapse|add (?:another|row|line)|skip)$/i;

const CHECKBOX_TERMS = /\b(agree|accept|consent|terms|conditions|authori[sz]e|certify|attest|acknowledge)\b/i;

function clean(label: string | null | undefined): string {
  return String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function isButtonish(t: TargetDescriptor): boolean {
  const type = (t.type ?? '').toLowerCase();
  if (t.tag === 'button' || t.tag === 'summary') return true;
  if (t.tag === 'input' && ['submit', 'button', 'image', 'reset'].includes(type)) return true;
  if (t.tag === 'a') return true;
  return ['button', 'link', 'menuitem', 'tab', 'option'].includes((t.role ?? '').toLowerCase());
}

function isSubmitControl(t: TargetDescriptor): boolean {
  const type = (t.type ?? '').toLowerCase();
  if (t.tag === 'input' && (type === 'submit' || type === 'image')) return true;
  // A <button> inside a form with no type attribute submits it.
  if (t.tag === 'button' && t.inForm && (type === 'submit' || type === '')) return true;
  return false;
}

/** Which consequential kind a label names, if any. Order matters: pay before submit, etc. */
export function kindFromLabel(label: string): ConsequentialKind | null {
  const text = clean(label);
  if (!text) return null;
  // Signing in or out moves through a login; the person types the password.
  if (/^(sign|log) ?(in|out)\b/i.test(text)) return null;
  if (PAY.test(text)) return 'pay';
  if (DELETE.test(text)) return 'delete';
  if (SIGN.test(text)) return 'sign';
  if (UPLOAD.test(text)) return 'upload';
  if (SEND.test(text)) return 'send';
  if (ACCEPT.test(text)) return 'accept_terms';
  if (SUBMIT.test(text)) return 'submit';
  return null;
}

/** Classify a click on whatever is under the point. */
export function classifyClick(target: TargetDescriptor | null): GateDecision {
  if (!target) return { type: 'allow' };
  if (target.inCaptcha) {
    return {
      type: 'needs_you',
      reason: 'captcha',
      message: 'This page has a captcha. Computer never solves captchas. Please complete it in the live view, then press Resume.',
    };
  }
  const label = clean(target.label);
  if (target.isFileInput) return { type: 'consequential', kind: 'upload', label: label || 'Choose file' };
  if (target.isCheckbox) {
    if (CHECKBOX_TERMS.test(label)) return { type: 'consequential', kind: 'accept_terms', label };
    return { type: 'allow' };
  }
  if (target.isTextEntry || target.tag === 'select' || target.tag === 'option') return { type: 'allow' };
  if (target.tag === 'label' && !isButtonish(target)) {
    const kind = kindFromLabel(label);
    return kind ? { type: 'consequential', kind, label } : { type: 'allow' };
  }
  if (!isButtonish(target) && target.tag !== 'label') {
    // Plain text, images, divs. Still check the label: sites put click
    // handlers on anything.
    const kind = kindFromLabel(label);
    return kind ? { type: 'consequential', kind, label } : { type: 'allow' };
  }
  const kind = kindFromLabel(label);
  if (kind) return { type: 'consequential', kind, label };
  if (isSubmitControl(target) && !SAFE_NAV.test(label)) {
    return { type: 'consequential', kind: 'submit', label: label || 'Submit (unlabeled button)' };
  }
  return { type: 'allow' };
}

function hasModifier(parts: string[], ...names: string[]) {
  return parts.some((p) => names.includes(p));
}

/** Classify a key press against whatever has focus. */
export function classifyKey(combo: string, focused: TargetDescriptor | null): GateDecision {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts[parts.length - 1] ?? '';
  const enter = ['return', 'enter', 'kp_enter'].includes(key);
  const space = key === 'space' || key === ' ';
  if (!enter && !space) return { type: 'allow' };
  if (!focused) return { type: 'allow' };
  if (focused.isTextarea) {
    // Enter is a newline in a textarea; Ctrl/Cmd+Enter usually sends.
    if (enter && hasModifier(parts, 'ctrl', 'control', 'cmd', 'meta', 'super')) {
      return { type: 'consequential', kind: 'send', label: clean(focused.label) || 'Send (Ctrl+Enter)' };
    }
    return { type: 'allow' };
  }
  if (focused.isTextEntry) {
    if (space) return { type: 'allow' };
    if (focused.inForm) {
      return { type: 'consequential', kind: 'submit', label: `Enter in “${clean(focused.label) || 'a form field'}”` };
    }
    return { type: 'allow' };
  }
  // Enter / Space on a focused button or checkbox activates it.
  return classifyClick(focused);
}

/** Typing: never into a password or one-time-code field; a newline is an Enter. */
export function classifyType(text: string, focused: TargetDescriptor | null): GateDecision {
  if (focused?.isPassword) {
    return {
      type: 'needs_you',
      reason: 'login',
      message: 'This site needs you to sign in. Please sign in yourself in the live view (Computer never types passwords), then press Resume.',
    };
  }
  if (focused?.isOneTimeCode) {
    return {
      type: 'needs_you',
      reason: 'two_factor',
      message: 'The site is asking for a verification code. Please enter it in the live view, then press Resume.',
    };
  }
  if (/[\r\n]/.test(text)) return classifyKey('Return', focused);
  return { type: 'allow' };
}

export function normalizeLabel(label: string): string {
  return clean(label)
    .toLowerCase()
    .replace(/[“”"'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function originOf(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? ''));
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

/** A single-use approval the worker holds. Only its sha256 is stored. */
export interface ApprovalTicket {
  approvalId: string;
  token: string;
  tokenHash: string;
  kind: ConsequentialKind;
  buttonLabel: string;
  origin: string | null;
  expiresAt: number;
  /** Supply carts: the lines the person checked; removed ones must be gone before the click. */
  order?: ApprovedOrderSelection | null;
}

export function hashApprovalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashApprovalToken(token) };
}

/**
 * Does an approved ticket cover this click? Same site, not expired, and the
 * approved button label matches what is actually under the pointer. An
 * Enter-key submit is covered by a submit approval on the same site.
 */
export function ticketCovers(
  ticket: ApprovalTicket | null,
  decision: Extract<GateDecision, { type: 'consequential' }>,
  currentUrl: string,
  now: number,
): boolean {
  if (!ticket) return false;
  if (now > ticket.expiresAt) return false;
  if (ticket.origin && originOf(currentUrl) !== ticket.origin) return false;
  const want = normalizeLabel(ticket.buttonLabel);
  const got = normalizeLabel(decision.label);
  if (decision.label.startsWith('Enter in ')) return ticket.kind === 'submit' && decision.kind === 'submit';
  if (!want || !got) return ticket.kind === decision.kind;
  return got === want || got.includes(want) || want.includes(got);
}

/** Infer the kind for an approval request from the button label the model names. */
export function kindForApproval(buttonLabel: string, fallback: ConsequentialKind = 'submit'): ConsequentialKind {
  return kindFromLabel(buttonLabel) ?? fallback;
}
