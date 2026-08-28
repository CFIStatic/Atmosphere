import { Outlet, useLocation } from 'react-router-dom';
import { VerifierFrame } from '../components/VerifierFrame';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const RAIL_W = 248;

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; Overview, Start a job, Dashboard, and My jobs render beside
 * the same anchored rail. My jobs is full-bleed so it reads as a job file
 * you can ask, not a padded dashboard.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';
  useFeatureTimer('verifier_library', isLibrary);

  return (
    <div className="relative min-h-screen bg-paper-100">
      <VerifierFrame
        railOnly={!isLibrary}
        className={
          isLibrary
            ? 'fixed inset-0 z-0 h-full w-full'
            : 'fixed inset-y-0 left-0 z-20 h-full w-[248px] overflow-hidden border-r border-line bg-panel'
        }
      />
      {!isLibrary && (
        <main className="min-h-screen" style={{ paddingLeft: RAIL_W }}>
          {pathname === '/jobs' ? (
            <Outlet />
          ) : (
            <div className="px-4 py-6 sm:px-6">
              <Outlet />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
