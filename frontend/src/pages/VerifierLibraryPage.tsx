import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SpinnerIcon } from '../components/icons';

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
  const [frameReady, setFrameReady] = useState(false);

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
    setFrameReady(false);
  }, [srcDoc]);

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
  const frameSrc = srcDoc ? undefined : '/verifier/?embed=1';

  return (
    <>
      {!frameReady && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-paper-100 text-brand-600">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      )}
      {srcDoc ? (
        <iframe
          title="Verifier"
          srcDoc={srcDoc}
          className={frameClass}
          onLoad={() => setFrameReady(true)}
        />
      ) : (
        <iframe
          title="Verifier"
          src={frameSrc}
          className={frameClass}
          onLoad={() => setFrameReady(true)}
        />
      )}
    </>
  );
}
