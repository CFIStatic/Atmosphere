import type { Plugin } from 'vite';

/**
 * Stamps every production build with an id the running app compares against
 * /version.json. When they differ, a newer deploy is live and the app does a
 * full-page load on the next route change (see src/lib/versionWatch.ts).
 */
export function buildVersionPlugin(): Plugin {
  const buildId =
    process.env.APP_BUILD_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'atmosphere-build-version',
    config(_, { command }) {
      return { define: { __APP_BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev') } };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
      });
    },
  };
}
