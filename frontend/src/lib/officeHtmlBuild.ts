/**
 * Bump this after a chrome-only office fix so Vite emits a new hashed JS
 * file and index.html points at it. Phones that still show a removed
 * control are almost always on a cached HTML document that names the old
 * `/assets/index-….js`.
 */
export const OFFICE_HTML_BUILD = 'no-overview-back-2';
