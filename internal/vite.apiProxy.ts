import type { ServerResponse } from 'node:http';

/** Dev-server `/api` proxy. A down backend becomes a JSON 503, not an opaque 500. */
export function atmosphereApiProxy(
  target = process.env.VITE_BACKEND_URL ?? 'http://localhost:4000',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    target,
    changeOrigin: true,
    configure(proxy: { on: (event: string, fn: (...args: unknown[]) => void) => void }) {
      proxy.on('error', (err: unknown, _req: unknown, res: unknown) => {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code ?? 'proxy_error')
            : 'proxy_error';
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
