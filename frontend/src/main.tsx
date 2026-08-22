import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPreferences } from './lib/preferences';
import { consumeRecoveryRedirect } from './lib/recoveryLink';
import { initPlatform } from './lib/usePlatform';
import './index.css';

// Applied before the first paint so a "reduce motion" user never sees the
// animation they asked us to suppress.
initPreferences();
initPlatform();
// Stock recovery emails land on `/#access_token=…&type=recovery`. Move them
// onto /reset-password before the router sends `/` to the dashboard.
consumeRecoveryRedirect();

async function boot() {
  // Demo builds answer every /api call in-page; the interceptor must be
  // installed before anything renders and fires its first request.
  if (import.meta.env.VITE_DEMO) await import('./demo/mock');

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root not found');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
