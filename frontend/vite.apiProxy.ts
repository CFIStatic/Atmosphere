import type { ProxyOptions } from 'vite';

/**
 * Dev-server `/api` proxy that never turns a dead backend into an opaque
 * `500 Internal Server Error` with a text/plain body.
 *
 * When the API on :4000 is down, http-proxy's default path is exactly that
 * opaque 500 — which the login page surfaces as "Request failed (500)". Return
 * a JSON 503 with an actionable message instead.
 */
export function atmosphereApiProxy(
  target = process.env.VITE_BACKEND_URL ?? 'http://localhost:4000',
): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    // Computer-use agents connect to /api/computer/agent-socket over WebSocket.
    ws: true,
    configure(proxy) {
      proxy.on('error', (err, _req, res) => {
        const code = (err as NodeJS.ErrnoException)?.code ?? 'proxy_error';
        // eslint-disable-next-line no-console
        console.error(`[vite] /api proxy → ${target} failed (${code}):`, err.message);

        // Websocket upgrades hand us a raw net.Socket, not a ServerResponse.
        if (!res || typeof (res as { writeHead?: unknown }).writeHead !== 'function') {
          return;
        }

        const response = res as import('http').ServerResponse;
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
