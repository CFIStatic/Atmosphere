import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { jobShareTokenFromRoute } from '../lib/jobSharePath';
import { FIELD_CAPTURE_WEB_ORIGIN, fieldCaptureInviteOpenUrl } from '../lib/firstRun';
import { SpinnerIcon } from '../components/icons';

/**
 * Legacy /shared/:token and /guest bookmarks open classic Field Capture.
 * Invite emails still use these paths; the job-share HTML UI is gone.
 */
export function JobSharePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = jobShareTokenFromRoute(params);
  const email = (searchParams.get('email') ?? '').trim();
  const href = token
    ? fieldCaptureInviteOpenUrl(token, email || null)
    : FIELD_CAPTURE_WEB_ORIGIN;

  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <div
      className="grid min-h-screen place-items-center bg-paper-100 px-6 text-center text-brand-600"
      data-testid="invited-job"
    >
      <div className="flex flex-col items-center gap-3">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
        <p className="text-sm font-medium text-ink-700">Opening Field Capture…</p>
        <a href={href} className="text-sm font-semibold text-brand-600 underline underline-offset-2">
          Open in Field Capture
        </a>
      </div>
    </div>
  );
}
