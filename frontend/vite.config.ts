import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifierStaticPlugin } from './vite.verifier';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(frontendDir, 'src');
const verifierDir = path.resolve(frontendDir, '../verifier');

// https://vite.dev/config/
export default defineConfig({
  plugins: [verifierStaticPlugin(verifierDir, path.resolve(frontendDir, 'dist')), react()],
  resolve: {
    alias: { '@': srcDir },
  },
  server: {
    // Listen on all interfaces so Cursor port forwarding and both IPv4/IPv6
    // localhost resolve correctly — binding [::1] alone causes ERR_CONNECTION_REFUSED.
    host: true,
    port: 5174,
    strictPort: true,
    // Allow Cloudflare quick-tunnel Host headers during local/cloud previews.
    allowedHosts: true,
    // Proxy API calls to the backend during development so the browser talks to
    // a single origin (cookies "just work", no CORS headaches in dev).
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL ?? 'http://localhost:4000',
        changeOrigin: true,
        // Computer-use agents connect to /api/computer/agent-socket over
        // WebSocket. The console tells operators to point the agent at the
        // origin they are looking at, which in development is this dev server.
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Coverage targets the layers that carry real logic; presentational
      // components are covered by behaviour tests, not line counting.
      include: ['src/domain/**', 'src/data/**'],
    },
  },
});
