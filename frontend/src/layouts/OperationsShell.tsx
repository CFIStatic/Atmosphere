import { Outlet, useLocation } from 'react-router-dom';
import { VerifierFrame } from '../components/VerifierFrame';
import { ThemeToggle } from '../components/ThemeToggle';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { isJobFilePath } from './jobFilePath';

const RAIL_W = 248;

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; Overview, Start a job, Dashboard, and My jobs render beside
 * the same anchored rail. A theme toggle stays on these React pages because
 * the verifier top bar (and its moon/sun control) is hidden in rail-only mode.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';
  const isJobFile = isJobFilePath(pathname);
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
        <main className="flex min-h-screen flex-col" style={{ paddingLeft: RAIL_W }}>
          <div className="flex shrink-0 items-center justify-end border-b border-line px-4 py-2.5 sm:px-6">
            <ThemeToggle />
          </div>
          <div className={isJobFile ? 'flex min-h-0 flex-1 flex-col' : 'px-4 py-6 sm:px-6'}>
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
