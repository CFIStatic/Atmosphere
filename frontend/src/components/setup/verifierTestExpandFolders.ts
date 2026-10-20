import type { DOMWindow } from 'jsdom';

/**
 * All videos job folders land collapsed. Tests that exercise clip rows open
 * every folder the way a person would: by clicking its row once it renders.
 */
export function expandJobFoldersOnRender(window: DOMWindow) {
  window.addEventListener('DOMContentLoaded', () => {
    const open = () =>
      window.document
        .querySelectorAll<HTMLElement>('tr.jobrow[aria-expanded="false"]')
        .forEach((row) => row.click());
    new window.MutationObserver(open).observe(window.document.body, { childList: true, subtree: true });
    open();
  });
}
