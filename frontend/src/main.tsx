import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPreferences } from './lib/preferences';
import './index.css';

// Applied before the first paint so a "reduce motion" user never sees the
// animation they asked us to suppress.
initPreferences();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
