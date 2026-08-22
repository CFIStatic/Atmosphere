import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SpinnerIcon } from './icons';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/api';
import { displayName, initials, nameFromMetadata } from '../lib/display';
import { usePreferences } from '../lib/preferences';
import { isThemePreference, setThemePreference } from '../lib/theme';

/**
 * The Verifier portal iframe — one persistent instance per operations shell.
 * Layout toggles between full viewport and sidebar-only via postMessage so
 * route changes never reload the frame.
 */
export function VerifierFrame({
  railOnly = false,
  className,
  style,
}: {
  railOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = usePreferences();
  const { user, profile, membership, logout } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    const inline = document.getElementById('atm-verify-src');
    if (inline?.textContent) {
      setSrcDoc(
        inline.textContent
          .replace(/<\\\/script/gi, '</script')
          .replace('<body>', '<body data-atm-embed="1">'),
      );
    }
  }, []);

  const postToFrame = useCallback((payload: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(payload, '*');
  }, []);

  const postSession = useCallback(() => {
    if (!user) return;
    const fullName = profile?.fullName || nameFromMetadata(user.metadata);
    postToFrame({
      atmosphere: 'session',
      user: {
        name: displayName(fullName, user.email),
        email: profile?.email ?? user.email ?? '',
        initials: initials(fullName, user.email),
        orgName: membership?.org?.name ?? null,
        roleLabel: membership ? ROLE_LABELS[membership.role] : null,
        role: membership?.role ?? null,
      },
    });
  }, [membership, postToFrame, profile, user]);

  const syncFrame = useCallback(() => {
    postToFrame({ atmosphere: 'layout', railOnly });
    postToFrame({ atmosphere: 'active-route', path: location.pathname });
    postToFrame({ atmosphere: 'theme', preference: theme });
    postSession();
  }, [location.pathname, postSession, postToFrame, railOnly, theme]);

  useLayoutEffect(() => {
    if (frameReady) syncFrame();
  }, [frameReady, syncFrame]);

  useEffect(() => {
    if (frameReady) postToFrame({ atmosphere: 'theme', preference: theme });
  }, [frameReady, postToFrame, theme]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        atmosphere?: string;
        to?: string;
        preference?: unknown;
      } | null;
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
        return;
      }
      if (data.atmosphere === 'theme' && isThemePreference(data.preference)) {
        setThemePreference(data.preference);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [logout, navigate, postSession]);

  const frameClass = 'h-full w-full border-0';
  // Bust cached /verifier/index.html so Dashboard picks up chrome fixes.
  const frameSrc = srcDoc ? undefined : '/verifier/?embed=1&v=dashboard-chrome-2';

  return (
    <div className={className} style={style}>
      {!frameReady && !railOnly && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-paper-100 text-brand-600">
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
