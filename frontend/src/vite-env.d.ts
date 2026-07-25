/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Atmosphere backend. Leave empty in dev (Vite proxies /api). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
