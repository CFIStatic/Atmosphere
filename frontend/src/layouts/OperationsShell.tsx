import { Outlet, useLocation } from 'react-router-dom';
import { VerifierFrame } from '../components/VerifierFrame';

/**
 * Operations routes share one Verifier sidebar. The library fills the screen;
 * intake and job files render beside the same rail instead of AppShell.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';

  if (isLibrary) {
    return <VerifierFrame mode="full" />;
  }

  return (
    <div className="flex h-screen min-h-0 bg-paper-100">
      <VerifierFrame mode="rail" className="h-full w-[236px] shrink-0 border-r border-line" />
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
