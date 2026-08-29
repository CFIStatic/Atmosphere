import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DashboardSearchBar } from '../components/DashboardSearchBar';
import { VerifierFrame } from '../components/VerifierFrame';
import { ThemeToggle } from '../components/ThemeToggle';
import { SpinnerIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { isJobFilePath } from './jobFilePath';
import { JobFilesSearchContext } from './jobFilesSearch';

const RAIL_W = 248;

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; Overview, Start a job, Dashboard, and Job Files render beside
 * the same anchored rail. The one light/dark control lives in the top-right
 * of these React pages because the verifier top bar is hidden in rail-only
 * mode. The rail itself only has Settings — no second moon/sun button.
 *
 * Job Files reuses the Dashboard search chrome: same 72px bar, same field,
 * same placeholder. The list itself has no second title or filter row.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';
  const isJobsList = pathname === '/jobs';
  const isJobFile = isJobFilePath(pathname);
  const [jobSearch, setJobSearch] = useState('');
  useFeatureTimer('verifier_library', isLibrary);

  useEffect(() => {
    if (!isJobsList) setJobSearch('');
  }, [isJobsList]);

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
        <JobFilesSearchContext.Provider value={{ query: jobSearch, setQuery: setJobSearch }}>
          <main
            className={
              isJobFile
                ? 'flex min-h-screen flex-col lg:h-screen lg:overflow-hidden'
                : 'min-h-screen'
            }
            style={{ paddingLeft: RAIL_W }}
          >
            <header
              className={
                isJobsList
                  ? 'sticky top-0 z-30 flex h-[72px] shrink-0 items-center gap-[18px] border-b border-line bg-paper-0 px-4'
                  : 'flex shrink-0 items-center justify-end border-b border-line px-4 py-2.5 sm:px-6'
              }
            >
              {isJobsList && (
                <DashboardSearchBar
                  value={jobSearch}
                  onChange={setJobSearch}
                  aria-label="Search job files"
                />
              )}
              {isJobsList && <div className="flex-1" />}
              <ThemeToggle />
            </header>
            <div
              className={
                isJobFile ? 'flex min-h-0 flex-1 flex-col lg:overflow-hidden' : 'px-4 py-6 sm:px-6'
              }
            >
              <Suspense
                fallback={
                  <div
                    role="status"
                    aria-live="polite"
                    className="grid min-h-[40vh] place-items-center text-brand-600"
                  >
                    <SpinnerIcon className="animate-spin" width={28} height={28} />
                    <span className="sr-only">Loading…</span>
                  </div>
                }
              >
                <Outlet context={{ chrome: 'operations' as const }} />
              </Suspense>
            </div>
          </main>
        </JobFilesSearchContext.Provider>
      )}
    </div>
  );
}
