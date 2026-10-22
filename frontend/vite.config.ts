import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atmosphereApiProxy } from './vite.apiProxy';
import { staticAppPlugin } from './vite.verifier';
import { buildVersionPlugin } from './vite.buildVersion';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(frontendDir, 'src');
const verifierDir = path.resolve(frontendDir, '../verifier');
const fieldCaptureDir = path.resolve(frontendDir, '../fieldcapture');
const distDir = path.resolve(frontendDir, 'dist');
// Vitest shares the app's Vite 6, whose esbuild compiles TSX with the classic
// JSX runtime unless @vitejs/plugin-react switches it to the automatic one, so
// the plugin runs under Vitest too.

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    staticAppPlugin('/verifier', verifierDir, distDir),
    staticAppPlugin('/fieldcapture', fieldCaptureDir, distDir),
    react(),
    buildVersionPlugin(),
  ],
  resolve: {
    alias: { '@': srcDir },
  },
  build: {
    rollupOptions: {
      output: {
        // React and the router change only when their versions do, so they
        // ship as their own file and stay cached in the browser across our
        // deploys; only the app's own code downloads again after a merge.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
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
