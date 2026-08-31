import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DashboardSearchBar } from '../components/DashboardSearchBar';
import { HeaderAccountChip } from '../components/HeaderAccountChip';
import { VerifierFrame } from '../components/VerifierFrame';
import { MenuIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { usePhoneShell } from '../lib/usePhoneShell';
import { isJobFilePath } from './jobFilePath';
import { JobFilesSearchContext } from './jobFilesSearch';

/**
 * Operations routes share one persistent Verifier iframe. The library fills
 * the screen; Overview, Start a job, Dashboard, Job Files, and Settings
 * render beside the same anchored rail. The account chip (name, org, avatar)
 * lives in the top-right of these React pages because the verifier top bar is
 * hidden in rail-only mode. Appearance, Settings, and sign-out live in that
 * menu — same as Dashboard. The rail itself only has Settings.
 *
 * Job Files reuses the Dashboard search chrome: same 72px bar, same field,
 * same placeholder. The list itself has no second title or filter row.
 *
 * On a phone — including the Field Capture 480px web frame — the office rail
 * becomes a hamburger drawer. The account chip stays in the top-right of
 * that header so Platform is not missing a profile while Field Capture's own
 * top bar is hidden.
 */
export function OperationsShell() {
  const { pathname } = useLocation();
  const isLibrary = pathname === '/verifier-library';
  const isJobsList = pathname === '/jobs';
  const isJobFile = isJobFilePath(pathname);
  const phone = usePhoneShell();
  const [jobSearch, setJobSearch] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  useFeatureTimer('verifier_library', isLibrary);

  useEffect(() => {
    if (!isJobsList) setJobSearch('');
  }, [isJobsList]);

  useEffect(() => {
    setRailOpen(false);
  }, [pathname]);

  const railClass = isLibrary
    ? 'fixed inset-0 z-0 h-full w-full'
    : phone
      ? `fixed inset-y-0 left-0 z-40 h-full w-[min(280px,86vw)] overflow-hidden bg-panel shadow-xl transition-transform duration-200 ${
          railOpen ? 'translate-x-0' : '-translate-x-full'
        }`
      : 'operations-rail fixed inset-y-0 left-0 z-20 h-full overflow-hidden bg-panel';

  return (
    <div
      className={
        phone
          ? 'operations-chrome relative h-[100dvh] overflow-hidden bg-paper-100'
          : 'operations-chrome relative min-h-screen bg-paper-100'
      }
    >
      <VerifierFrame railOnly={!isLibrary} className={railClass} />
      {phone && !isLibrary && railOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/45"
          onClick={() => setRailOpen(false)}
        />
      )}
      {!isLibrary && (
        <JobFilesSearchContext.Provider value={{ query: jobSearch, setQuery: setJobSearch }}>
          <main
            className={
              isJobFile
                ? phone
                  ? 'flex h-full flex-col overflow-hidden'
                  : 'operations-main flex min-h-screen flex-col lg:h-screen lg:overflow-hidden'
                : phone
                  ? 'flex h-full flex-col overflow-hidden'
                  : 'operations-main min-h-screen'
            }
          >
            <header
              className={
                isJobsList
                  ? phone
                    ? 'sticky top-0 z-30 flex min-h-14 min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-paper-0 px-3 py-2'
                    : 'sticky top-0 z-30 flex h-[72px] shrink-0 items-center gap-[18px] border-b border-line bg-paper-0 px-4'
                  : phone
                    ? 'flex min-h-14 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2'
                    : 'flex shrink-0 items-center justify-end border-b border-line px-4 py-2.5 sm:px-6'
              }
            >
              {phone && (
                <button
                  type="button"
                  onClick={() => setRailOpen(true)}
                  aria-label="Open navigation"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-700 hover:bg-paper-200"
                >
                  <MenuIcon width={22} height={22} />
                </button>
              )}
              {isJobsList && (
                <DashboardSearchBar
                  value={jobSearch}
                  onChange={setJobSearch}
                  aria-label="Search job files"
                  className={phone ? 'order-last basis-full' : undefined}
                />
              )}
              {isJobsList && !phone && <div className="flex-1" />}
              <div className="ml-auto shrink-0">
                <HeaderAccountChip />
              </div>
            </header>
            <div
              className={
              isJobFile
                ? phone
                  ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                  : 'flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden'
                  : phone
                    ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 py-3'
                    : 'px-4 py-6 sm:px-6'
              }
            >
              <Outlet context={{ chrome: 'operations' as const }} />
            </div>
          </main>
        </JobFilesSearchContext.Provider>
      )}
    </div>
  );
}
