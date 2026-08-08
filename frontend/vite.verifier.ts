import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/**
 * Serve the standalone Verifier static app at /verifier in dev and preview,
 * and copy it into dist/verifier on production builds.
 *
 * Without this, Vite's SPA fallback answers /verifier/* with index.html and
 * the Evidence Platform iframe on /verifier-library renders blank.
 */
export function verifierStaticPlugin(verifierDir: string, outDir: string): Plugin {
  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const raw = req.url ?? '';
    if (!raw.startsWith('/verifier')) return next();

    const pathname = raw.split('?')[0] ?? raw;
    let rel = pathname.slice('/verifier'.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`.replace(/\/+/g, '/');

    const filePath = path.normalize(path.join(verifierDir, rel));
    if (!filePath.startsWith(verifierDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return next();
    }

    res.setHeader('Content-Type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

  return {
    name: 'verifier-static',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      const target = path.join(outDir, 'verifier');
      fs.mkdirSync(outDir, { recursive: true });
      fs.cpSync(verifierDir, target, { recursive: true });
    },
  };
}
