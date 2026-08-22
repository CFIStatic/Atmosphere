import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atmosphereApiProxy } from './vite.apiProxy.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(dir, 'src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': srcDir },
  },
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': atmosphereApiProxy(),
    },
  },
  preview: {
    host: true,
    port: 4175,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
