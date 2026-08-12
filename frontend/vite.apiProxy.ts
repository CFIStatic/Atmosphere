import type { ServerResponse } from 'node:http';

/**
 * Dev-server `/api` proxy that never turns a dead backend into an opaque
 * `500 Internal Server Error` with a text/plain body.
 *
 * When the API on :4000 is down, http-proxy's default path is exactly that
 * opaque 500 — which the login page surfaces as "Request failed (500)". Return
 * a JSON 503 with an actionable message instead.
 *
 * Return typed as `any`: this repo's `vitest/config` nests a different Vite
 * whose `ProxyOptions` conflict with the top-level `vite` package during
 * `tsc -b`, so we cannot name the Vite type here without breaking the build.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function atmosphereApiProxy(
  target = process.env.VITE_BACKEND_URL ?? 'http://localhost:4000',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    target,
    changeOrigin: true,
    // Computer-use agents connect to /api/computer/agent-socket over WebSocket.
    ws: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configure(proxy: any) {
      proxy.on('error', (err: NodeJS.ErrnoException, _req: unknown, res: unknown) => {
        const code = err?.code ?? 'proxy_error';
        // eslint-disable-next-line no-console
        console.error(`[vite] /api proxy → ${target} failed (${code}):`, err.message);

        // Websocket upgrades hand us a raw net.Socket, not a ServerResponse.
        const response = res as ServerResponse | undefined;
        if (!response || typeof response.writeHead !== 'function') return;
        if (response.writableEnded || response.headersSent) return;

        response.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(
          JSON.stringify({
            error:
              'Atmosphere API is not running. Start it with `cd backend && npm run dev` (port 4000), then try again.',
            code: 'backend_unreachable',
            detail: code,
          }),
        );
      });
    },
  };
}
