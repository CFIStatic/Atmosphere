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

type StaticMountOptions = {
  /** Vite plugin name */
  name: string;
  /** URL mount, e.g. `/verifier` or `/fieldcapture` */
  mount: string;
  /** Absolute path to the static folder on disk */
  dir: string;
  /** Vite outDir — files are copied to `${outDir}/${mount basename}` on build */
  outDir: string;
};

/**
 * Serve a standalone static app under a fixed URL prefix in dev/preview,
 * and copy it into dist on production builds.
 *
 * Without this, Vite's SPA fallback answers the mount with index.html and
 * the embedded surface renders blank.
 */
export function staticMountPlugin(opts: StaticMountOptions): Plugin {
  const mount = opts.mount.endsWith('/') ? opts.mount.slice(0, -1) : opts.mount;
  const mountDir = path.basename(mount);
  const rootDir = path.resolve(opts.dir);

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const raw = req.url ?? '';
    if (!raw.startsWith(mount)) return next();
    // Don't steal sibling paths like /verifier-library
    const after = raw.slice(mount.length);
    if (after !== '' && !after.startsWith('/') && !after.startsWith('?')) return next();

    const pathname = raw.split('?')[0] ?? raw;
    let rel = pathname.slice(mount.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`.replace(/\/+/g, '/');

    const filePath = path.normalize(path.join(rootDir, rel));
    if (!filePath.startsWith(rootDir)) {
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
    name: opts.name,
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      const target = path.join(opts.outDir, mountDir);
      fs.mkdirSync(opts.outDir, { recursive: true });
      fs.cpSync(rootDir, target, { recursive: true });
    },
  };
}
