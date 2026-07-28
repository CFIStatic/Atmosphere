import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
});
