/**
 * Code that runs inside the controlled browser page, not on the server.
 *
 * Playwright serialises `collectPageState` and evaluates it in the page, so it
 * must be entirely self-contained: no imports, no closures over module scope.
 * It lives in its own file because it is the only place in the backend that
 * touches DOM globals — the server tsconfig has no DOM lib, and adding one
 * would put `document` and `window` in scope for genuinely server-side code
 * where their presence is a bug rather than a capability.
 *
 * The declarations below are types only and erase at build time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const document: any;
declare const window: any;
declare const CSS: any;
type DomElement = any;

export interface PageElement {
  ref: string;
  tag: string;
  type?: string;
  label: string;
  value?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: PageElement[];
  text: string;
}

export interface CollectOptions {
  maxElements: number;
  maxTextChars: number;
}

/**
 * Tags every visible interactive element with a stable reference attribute and
 * returns a compact description of the page.
 *
 * The model sees this instead of HTML: it costs a fraction of the tokens, and
 * it means every element the model can act on is addressed by a reference we
 * minted rather than by a selector it invented.
 */
export function collectPageState(options: CollectOptions): PageSnapshot {
  const { maxElements, maxTextChars } = options;

  const SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[contenteditable="true"]',
  ].join(',');

  const isVisible = (el: DomElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  // Preference order mirrors how a person identifies a control: the words on
  // it first, then its accessible name, then anything at all.
  const describe = (el: DomElement): string => {
    const attr = (name: string): string => (el.getAttribute(name) ?? '').trim();

    const labelledBy = attr('aria-labelledby');
    const labelled = labelledBy ? (document.getElementById(labelledBy)?.textContent ?? '').trim() : '';
    const associated = el.id
      ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '').trim()
      : '';

    const candidate =
      (el.innerText ?? '').trim() ||
      attr('aria-label') ||
      labelled ||
      associated ||
      attr('placeholder') ||
      attr('title') ||
      attr('name') ||
      attr('value') ||
      attr('alt') ||
      '';

    return candidate.replace(/\s+/g, ' ').slice(0, 120);
  };

  const elements: PageElement[] = [];
  const nodes: DomElement[] = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  let counter = 0;

  for (const node of nodes) {
    if (elements.length >= maxElements) break;
    if (node.type === 'hidden') continue;
    if (!isVisible(node)) continue;

    counter += 1;
    const ref = `e${counter}`;
    node.setAttribute('data-atm-ref', ref);

    const tag = String(node.tagName).toLowerCase();
    const type = node.getAttribute('type') ?? undefined;
    const raw =
      tag === 'input' || tag === 'textarea' || tag === 'select' ? String(node.value ?? '') : '';
    // A password field's contents are never reported, in any form.
    const value = type === 'password' ? (raw ? '••••••' : '') : raw.slice(0, 120);

    elements.push({ ref, tag, type, label: describe(node), value: value || undefined });
  }

  const text = String(document.body?.innerText ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, maxTextChars);

  return { url: String(window.location.href), title: String(document.title), elements, text };
}
