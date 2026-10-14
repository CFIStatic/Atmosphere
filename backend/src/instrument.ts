// Imported first by index.ts so Sentry starts before Express and the app load.
import { initSentry } from './lib/sentry.js';

initSentry();
