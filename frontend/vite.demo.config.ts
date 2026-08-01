import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Demo build (VITE_DEMO=1 vite build --config vite.demo.config.ts): emits one
// self-contained chunk so the whole app can be inlined into a single HTML
// file. Chunk-splitting is disabled because the demo runs where runtime chunk
// fetching is blocked; the dev proxy is irrelevant here, so it is omitted.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 6000,
  },
});
