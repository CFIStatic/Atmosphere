import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { VerifierFrame } from '../components/VerifierFrame';

const RAIL_COLLAPSED_KEY = 'atmosphere.sidebarCollapsed';
const RAIL_EXPANDED_W = 220;
const RAIL_COLLAPSED_W = 72;

function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; intake and job progress render beside the same rail.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);

  const onRailCollapsedChange = useCallback((collapsed: boolean) => {
    setRailCollapsed(collapsed);
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage denied — preference still applies for this session */
    }
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { atmosphere?: string; collapsed?: boolean } | null;
      if (data?.atmosphere === 'rail-collapsed' && typeof data.collapsed === 'boolean') {
        onRailCollapsedChange(data.collapsed);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onRailCollapsedChange]);

  const railWidth = railCollapsed ? RAIL_COLLAPSED_W : RAIL_EXPANDED_W;

  return (
    <div className="relative min-h-screen bg-paper-100">
      <VerifierFrame
        railOnly={!isLibrary}
        railCollapsed={railCollapsed}
        className={
          isLibrary
            ? 'fixed inset-0 z-0 h-full w-full'
            : 'fixed inset-y-0 left-0 z-20 h-full overflow-hidden border-r border-line bg-panel transition-[width] duration-200'
        }
        style={isLibrary ? undefined : { width: railWidth }}
      />
      {!isLibrary && (
        <main
          className="min-h-screen transition-[padding] duration-200"
          style={{ paddingLeft: railWidth }}
        >
          <div className="px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
