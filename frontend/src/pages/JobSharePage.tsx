import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { jobShareTokenFromRoute } from '../lib/jobSharePath';
import { crewInvitePath } from '../lib/crewInvite';
import { FIELD_CAPTURE_WEB_ORIGIN } from '../lib/firstRun';
import { useEffect } from 'react';
import { SpinnerIcon } from '../components/icons';

/**
 * Legacy /shared/:token links (older sub invite emails) open the same
 * invite page as new ones: sign in or create an account, then the job.
 * /guest with no token still opens Field Capture.
 */
export function JobSharePage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = jobShareTokenFromRoute(params);
  const email = (searchParams.get('email') ?? '').trim();
  if (token) return <Navigate to={crewInvitePath(token, email || null)} replace />;
  return <OpenFieldCapture />;
}

function OpenFieldCapture() {
  useEffect(() => {
    window.location.replace(FIELD_CAPTURE_WEB_ORIGIN);
  }, []);
  return (
    <div
      className="grid min-h-screen place-items-center bg-paper-100 px-6 text-center text-brand-600"
      data-testid="invited-job"
    >
      <div className="flex flex-col items-center gap-3">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
        <p className="text-sm font-medium text-ink-700">Opening Field Capture…</p>
      </div>
    </div>
  );
}
