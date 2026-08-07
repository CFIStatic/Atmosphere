import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The Work Verification Platform's surface IS the Verifier.
 *
 * No shell, no second sidebar — the portal fills the viewport and its own
 * sidebar is the platform's only rail, with Settings at the bottom of it.
 * The portal stays a standalone page that knows nothing about the app: when
 * embedded it posts a navigation message upward, and this page is the only
 * thing listening.
 *
 * Two data paths, one page: in the demo artifact the portal's source ships
 * inline (marked with data-atm-embed so the sidebar shows Settings); against
 * a live deployment the iframe loads /verifier/?embed=1 and the portal
 * hydrates itself from /api/evidence-portal/library.
 */
export function VerifierLibraryPage() {
  const navigate = useNavigate();
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    const inline = document.getElementById('atm-verify-src');
    if (inline?.textContent) {
      setSrcDoc(
        inline.textContent
          .replace(/<\\\/script/gi, '</script')
          // The embed marker: the standalone Verifier tab uses this same
          // source without it, and must not grow a Settings item.
          .replace('<body>', '<body data-atm-embed="1">'),
      );
    }
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { atmosphere?: string; to?: string } | null;
      if (data && data.atmosphere === 'navigate' && typeof data.to === 'string') {
        navigate(data.to);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  const frameClass = 'fixed inset-0 h-full w-full border-0';
  return srcDoc ? (
    <iframe title="Verifier" srcDoc={srcDoc} className={frameClass} />
  ) : (
    <iframe title="Verifier" src="/verifier/?embed=1" className={frameClass} />
  );
}
