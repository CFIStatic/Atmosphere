import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SpinnerIcon } from './icons';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/api';
import { displayName, initials } from '../lib/display';

/**
 * The Verifier portal iframe — full viewport on the library route, or a
 * fixed-width rail beside React pages (intake, job files) so the sidebar
 * never swaps out for AppShell.
 */
export function VerifierFrame({
  mode = 'full',
  className,
  style,
}: {
  mode?: 'full' | 'rail';
  className?: string;
  style?: CSSProperties;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, membership, logout } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const railOnly = mode === 'rail';

  useEffect(() => {
    const inline = document.getElementById('atm-verify-src');
    if (inline?.textContent) {
      let html = inline.textContent.replace(/<\\\/script/gi, '</script');
      html = html.replace('<body>', '<body data-atm-embed="1">');
      if (railOnly) html = html.replace('<body data-atm-embed="1">', '<body data-atm-embed="1" data-atm-rail-only="1">');
      setSrcDoc(html);
    }
  }, [railOnly]);

  useEffect(() => {
    setFrameReady(false);
  }, [srcDoc, mode]);

  const postSession = useCallback(() => {
    if (!user) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    win.postMessage(
      {
        atmosphere: 'session',
        user: {
          name: displayName(profile?.fullName, user.email),
          email: profile?.email ?? user.email ?? '',
          initials: initials(profile?.fullName, user.email),
          orgName: membership?.org?.name ?? null,
          roleLabel: membership ? ROLE_LABELS[membership.role] : null,
          role: membership?.role ?? null,
        },
      },
      '*',
    );
  }, [membership, profile, user]);

  const postActiveRoute = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ atmosphere: 'active-route', path: location.pathname }, '*');
  }, [location.pathname]);

  useEffect(() => {
    if (frameReady) postSession();
  }, [frameReady, postSession]);

  useEffect(() => {
    if (frameReady) postActiveRoute();
  }, [frameReady, postActiveRoute]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { atmosphere?: string; to?: string } | null;
      if (!data?.atmosphere) return;

      if (data.atmosphere === 'navigate' && typeof data.to === 'string') {
        navigate(data.to);
        return;
      }
      if (data.atmosphere === 'request-session') {
        postSession();
        return;
      }
      if (data.atmosphere === 'sign-out') {
        void logout().then(() => navigate('/login', { replace: true }));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [logout, navigate, postSession]);

  const frameClass =
    mode === 'full'
      ? 'fixed inset-0 h-full w-full border-0'
      : 'h-full w-full border-0';
  const frameSrc = srcDoc ? undefined : `/verifier/?embed=1${railOnly ? '&rail=1' : ''}`;

  return (
    <div className={className} style={style}>
      {!frameReady && mode === 'full' && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-paper-100 text-brand-600">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      )}
      {srcDoc ? (
        <iframe
          ref={iframeRef}
          title="Verifier"
          srcDoc={srcDoc}
          className={frameClass}
          onLoad={() => setFrameReady(true)}
        />
      ) : (
        <iframe
          ref={iframeRef}
          title="Verifier"
          src={frameSrc}
          className={frameClass}
          onLoad={() => setFrameReady(true)}
        />
      )}
    </div>
  );
}
