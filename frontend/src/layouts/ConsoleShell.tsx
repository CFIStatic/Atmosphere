import { Outlet } from 'react-router-dom';
import { AppShell } from '../components/AppShell';

/**
 * Persistent chrome for Field and shared job pages.
 *
 * Overview, My jobs, and the job record each used to mount their own AppShell.
 * Clicking Overview then tore down the left rail and built it again — a flash
 * the rail should never do. The shell stays mounted here; only the page swaps.
 */
export function ConsoleShell() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
