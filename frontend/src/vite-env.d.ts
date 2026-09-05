/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Atmosphere backend. Leave empty in dev (Vite proxies /api). */
  readonly VITE_API_BASE_URL?: string;
  /** Optional Sentry DSN. Unset = no-op. Public key only — never a secret. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
