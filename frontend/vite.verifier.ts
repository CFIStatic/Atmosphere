import path from 'node:path';
import type { Plugin } from 'vite';
import { staticMountPlugin } from './vite.staticMount';

/**
 * Serve the standalone Verifier static app at /verifier in dev and preview,
 * and copy it into dist/verifier on production builds.
 *
 * Without this, Vite's SPA fallback answers /verifier/* with index.html and
 * the Evidence Platform iframe on /verifier-library renders blank.
 */
export function verifierStaticPlugin(verifierDir: string, outDir: string): Plugin {
  return staticMountPlugin({
    name: 'verifier-static',
    mount: '/verifier',
    dir: path.resolve(verifierDir),
    outDir,
  });
}
