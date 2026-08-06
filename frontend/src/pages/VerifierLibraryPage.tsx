import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';

/**
 * The Work Verification Platform's surface IS the Verifier.
 *
 * Not a summary of it, not a re-implementation — the same standalone,
 * dependency-free portal an adjuster opens through a share link, filling the
 * whole workspace. The office reads the record from the exact screen the
 * outside world will, so what a share will look like is never a guess.
 *
 * One page, two data paths: the portal hydrates itself from
 * /api/evidence-portal/library when a signed-in session is present (the
 * org's whole library), and falls back to its built-in record in the demo
 * artifact, where the source ships inline in the same inert script tag the
 * demo's standalone Verifier tab uses.
 */
export function VerifierLibraryPage() {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    const inline = document.getElementById('atm-verify-src');
    if (inline?.textContent) {
      setSrcDoc(inline.textContent.replace(/<\\\/script/gi, '</script'));
    }
  }, []);

  // Full-bleed: undo the shell's content padding so the portal's own chrome
  // (its topbar, sidebar, table) is the page, edge to edge.
  const frameClass = 'block h-[calc(100vh-1px)] w-full border-0';
  return (
    <AppShell>
      <div className="-mx-4 -my-6 sm:-mx-6">
        {srcDoc ? (
          <iframe title="Verifier" srcDoc={srcDoc} className={frameClass} />
        ) : (
          <iframe title="Verifier" src="/verifier/" className={frameClass} />
        )}
      </div>
    </AppShell>
  );
}
