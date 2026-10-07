/** Remembers whether the desktop sidebar is collapsed to its icon rail. */
export const SIDEBAR_STORAGE_KEY = 'atmosphere-analytics.sidebar';

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Private mode or storage disabled: the choice lasts for this visit only.
  }
}
