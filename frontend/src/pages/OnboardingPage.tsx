import { Navigate, useSearchParams } from 'react-router-dom';

/** Legacy onboarding route — the setup wizard now lives at /signup. */
export function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams({ step: '2' });
  const next = searchParams.get('next');
  if (next) params.set('next', next);
  return <Navigate to={`/signup?${params.toString()}`} replace />;
}
