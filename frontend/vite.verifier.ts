import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/**
 * Files that live next to the static app so Railway can build it, but must
 * not be copied into the office image's public /fieldcapture/ tree.
 */
const SKIP_PUBLIC = new Set([
  'dockerfile',
  'railway.toml',
  'railway.json',
  '.dockerignore',
  'readme.md',
]);
const SKIP_PUBLIC_DIRS = new Set(['nginx', 'scripts']);

export function isStaticAppPublicFile(filePath: string, sourceDir?: string): boolean {
  const rel = sourceDir
    ? path.relative(sourceDir, filePath)
    : filePath.replace(/\\/g, '/');
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => SKIP_PUBLIC_DIRS.has(part.toLowerCase()))) return false;
  const base = (parts[parts.length - 1] || '').toLowerCase();
  return !SKIP_PUBLIC.has(base);
}

/**
 * Serve a sibling static app (Verifier, Field Capture) at `/mount` in dev and
 * preview, and copy it into dist on production builds.
 *
 * Without this, Vite's SPA fallback answers those URLs with index.html.
 */
export function staticAppPlugin(mount: string, sourceDir: string, outDir: string): Plugin {
  const prefix = mount.startsWith('/') ? mount : `/${mount}`;

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const raw = req.url ?? '';
    if (!raw.startsWith(prefix)) return next();

    const pathname = raw.split('?')[0] ?? raw;
    let rel = pathname.slice(prefix.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`.replace(/\/+/g, '/');

    const filePath = path.normalize(path.join(sourceDir, rel));
    if (!filePath.startsWith(sourceDir)) {
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
    name: `static-app-${prefix.replace(/\W+/g, '-')}`,
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      const target = path.join(outDir, prefix.replace(/^\//, ''));
      fs.mkdirSync(outDir, { recursive: true });
      fs.cpSync(sourceDir, target, {
        recursive: true,
        filter: (filePath) => isStaticAppPublicFile(filePath, sourceDir),
      });
    },
  };
}

/** @deprecated Use staticAppPlugin('/verifier', …) */
export function verifierStaticPlugin(verifierDir: string, outDir: string): Plugin {
  return staticAppPlugin('/verifier', verifierDir, outDir);
}
