import path from 'path';
import { defineConfig } from 'vite';

/**
 * Dev server for the corporate marketing site.
 *
 * Serves website/ on port 5173 (the default preview port) and proxies /api to
 * the backend so careers and contact forms work same-origin in development.
 * The React app runs separately on 5174 — sign-in links redirect there.
 */
export default defineConfig({
  root: path.resolve(__dirname, '../website'),
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
