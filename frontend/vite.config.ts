import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atmosphereApiProxy } from './vite.apiProxy';
import { staticAppPlugin } from './vite.verifier';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(frontendDir, 'src');
const verifierDir = path.resolve(frontendDir, '../verifier');
const fieldCaptureDir = path.resolve(frontendDir, '../fieldcapture');
const distDir = path.resolve(frontendDir, 'dist');
// Vitest 4 runs on its own Vite 8 (Rolldown/oxc), while the app builds with
// Vite 6. @vitejs/plugin-react 4 only speaks Vite 6's esbuild options, so
// under Vitest it triggered deprecation warnings on every run. Vite 8 compiles
// TSX with the automatic JSX runtime by itself, and tests need no Fast Refresh,
// so the plugin is left out of test runs.
const isVitest = Boolean(process.env.VITEST);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    staticAppPlugin('/verifier', verifierDir, distDir),
    staticAppPlugin('/fieldcapture', fieldCaptureDir, distDir),
    ...(isVitest ? [] : [react()]),
  ],
  resolve: {
    alias: { '@': srcDir },
  },
  server: {
    // Listen on all interfaces so Cursor port forwarding and both IPv4/IPv6
    // localhost resolve correctly — binding [::1] alone causes ERR_CONNECTION_REFUSED.
    host: true,
    port: 5174,
    strictPort: true,
    // Cloudflare quick tunnels and other reverse proxies send their own Host
    // header; without this Vite 5.4+ blocks the request as a DNS-rebinding guard.
    allowedHosts: true,
    // Proxy API calls to the backend during development so the browser talks to
    // a single origin (cookies "just work", no CORS headaches in dev).
    proxy: {
      '/api': atmosphereApiProxy(),
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
