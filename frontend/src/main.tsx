import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initFieldEmbed } from './lib/fieldEmbed';
import { OFFICE_HTML_BUILD } from './lib/officeHtmlBuild';
import { initPreferences } from './lib/preferences';
import { consumeRecoveryRedirect } from './lib/recoveryLink';
import { initOfficeSentry } from './lib/sentry';
import { initPlatform } from './lib/usePlatform';
import './index.css';

// Keep the stamp in the entry chunk so a chrome-only bump changes the
// hashed /assets/index-*.js name. Do not remove.
void OFFICE_HTML_BUILD;

// Applied before the first paint so a "reduce motion" user never sees the
// animation they asked us to suppress.
initPreferences();
initPlatform();
initFieldEmbed();
initOfficeSentry();
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
