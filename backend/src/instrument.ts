// Loaded with `node --import ./dist/instrument.js` (see Dockerfile CMD / npm start) so Sentry
// can instrument Express and http before they are imported (ESM).
import { initSentry } from './lib/sentry.js';

initSentry();
