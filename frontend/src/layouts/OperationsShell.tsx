import { Outlet, useLocation } from 'react-router-dom';
import { VerifierFrame } from '../components/VerifierFrame';

const RAIL_W = 220;

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; intake and job progress render beside the same anchored rail.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';

  return (
    <div className="relative min-h-screen bg-paper-100">
      <VerifierFrame
        railOnly={!isLibrary}
        className={
          isLibrary
            ? 'fixed inset-0 z-0 h-full w-full'
            : 'fixed inset-y-0 left-0 z-20 h-full w-[220px] overflow-hidden border-r border-line bg-panel'
        }
      />
      {!isLibrary && (
        <main className="min-h-screen" style={{ paddingLeft: RAIL_W }}>
          <div className="px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
