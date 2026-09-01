/**
 * Job Files, Dashboard, and Overview all paint the same inventory.
 * A delete in one place has to land in the others without a full reload.
 */
export const LIBRARY_CHANGED_EVENT = 'atmosphere:library-changed';

export function notifyLibraryChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}

export function subscribeLibraryChanged(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(LIBRARY_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChange);
}
