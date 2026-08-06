import { useEffect, useState } from 'react';
import { AppShell, PageHeader } from '../components/AppShell';

/**
 * The Verifier, inside the platform.
 *
 * The evidence library is the same records screen an adjuster sees through a
 * share link — every clip filed under its job, integrity verdicts, analysis,
 * custody. Surfacing it inside the Work Verification Platform means the
 * office reads the record from the exact screen the outside world will,
 * which is the honest way to know what a share will look like before
 * issuing one.
 *
 * The portal is deliberately a standalone, dependency-free site, so it is
 * embedded rather than re-implemented — one artifact, two doors. In the demo
 * build the page's source ships inline (the same source the demo's Verifier
 * tab uses); against a live deployment the iframe loads /verifier/, where
 * the static site is served.
 */
export function VerifierLibraryPage() {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    // The demo artifact carries the portal's source in an inert script tag;
    // the same un-escaping the demo's own Verifier tab applies.
    const inline = document.getElementById('atm-verify-src');
    if (inline?.textContent) {
      setSrcDoc(inline.textContent.replace(/<\\\/script/gi, '</script'));
    }
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Work Verification Platform"
        title="Verifier"
        description="The evidence library, exactly as a reviewer sees it: every clip filed under its job, with the checks, the analysis, and the chain of custody behind it."
      />
      <div className="mt-5 overflow-hidden rounded-xl glass-card">
        {srcDoc ? (
          <iframe
            title="Verifier evidence library"
            srcDoc={srcDoc}
            className="h-[78vh] w-full border-0"
          />
        ) : (
          <iframe
            title="Verifier evidence library"
            src="/verifier/"
            className="h-[78vh] w-full border-0"
          />
        )}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        This is the same screen a share opens for an adjuster — scoped to their one job, under
        their own account. What you see here is everything; what they see is one job file of it.
      </p>
    </AppShell>
  );
}
