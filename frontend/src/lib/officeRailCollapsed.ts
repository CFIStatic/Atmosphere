/**
 * Device-local preference for the office left rail: expanded labels vs icon rail.
 * Shared by the verifier iframe and the OperationsShell host so padding tracks
 * the iframe width on rail-only tabs (Start a job, Settings, job file).
 */
export const OFFICE_RAIL_COLLAPSED_KEY = 'atmosphere.officeRailCollapsed';

/** Narrow icon rail — icons stay one click away. */
export const OFFICE_RAIL_COLLAPSED_W_PX = 56;

export function readOfficeRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(OFFICE_RAIL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOfficeRailCollapsed(collapsed: boolean): boolean {
  try {
    window.localStorage.setItem(OFFICE_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode */
  }
  return collapsed;
}
