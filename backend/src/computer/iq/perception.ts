/**
 * DOM-first perception: a compact text outline of what is on the page, sent
 * with each screenshot so the model can target elements by role and name
 * instead of pixels. Field values are never included (only "has a value").
 */
import type { PageOutline } from '../types.js';

export const OUTLINE_PREFIX = '<page_outline>';

export function formatOutline(o: PageOutline, maxElements = 60): string {
  const head = [
    `url: ${o.url.slice(0, 200)}`,
    o.title ? `title: ${o.title.slice(0, 120)}` : null,
    o.headings.length ? `headings: ${o.headings.slice(0, 6).join(' | ').slice(0, 300)}` : null,
    o.dialogs.length ? `open dialogs: ${o.dialogs.join(' | ').slice(0, 200)}` : null,
  ].filter(Boolean);
  const els = o.elements.slice(0, maxElements).map((e) => {
    const flags = [
      e.disabled ? 'disabled' : null,
      e.checked === true ? 'checked' : e.checked === false ? 'unchecked' : null,
      e.isPassword ? 'password' : null,
      e.hasValue ? 'filled' : null,
    ].filter(Boolean);
    const name = (e.name || '').replace(/\s+/g, ' ').slice(0, 80);
    return `[${e.ref}] ${e.role} "${name}" at (${e.x},${e.y})${flags.length ? ` ${flags.join(',')}` : ''}`;
  });
  const more = o.elements.length > maxElements ? [`(${o.elements.length - maxElements} more not listed; scroll to see them)`] : [];
  return `${OUTLINE_PREFIX}\n${[...head, ...els, ...more].join('\n')}\n</page_outline>`;
}
