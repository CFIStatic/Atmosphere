import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SpinnerIcon } from './icons';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import { isThemePreference, setThemePreference } from '../lib/theme';
import { usePhoneShell } from '../lib/usePhoneShell';
import { verifierSessionUser } from '../lib/verifierSession';

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
  const phone = usePhoneShell();
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
    postToFrame({
      atmosphere: 'session',
      user: verifierSessionUser({
        email: profile?.email ?? user.email,
        fullName: profile?.fullName,
        metadata: user.metadata,
        avatarUrl: profile?.avatarUrl,
        orgName: membership?.org?.name ?? null,
        roleLabel: membership ? ROLE_LABELS[membership.role] : null,
        role: membership?.role ?? null,
      }),
    });
  }, [membership, postToFrame, profile, user]);

  const syncFrame = useCallback(() => {
    postToFrame({ atmosphere: 'layout', railOnly, phoneDrawer: phone && railOnly });
    postToFrame({ atmosphere: 'active-route', path: location.pathname });
    postToFrame({ atmosphere: 'theme', preference: theme });
    postSession();
  }, [location.pathname, phone, postSession, postToFrame, railOnly, theme]);

  useLayoutEffect(() => {
    if (frameReady) syncFrame();
  }, [frameReady, syncFrame]);

  // Settings calls setProfile as soon as the upload lands — post that photo
  // even if layout/theme did not change.
  useEffect(() => {
    if (frameReady) postSession();
  }, [frameReady, postSession, profile?.avatarUrl]);

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
  const frameSrc = srcDoc ? undefined : '/verifier/?embed=1&v=profile-3';

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
