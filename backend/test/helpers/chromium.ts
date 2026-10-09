/**
 * Launch a local Chromium for the real-browser tests, wherever one is
 * installed: Playwright's own download, PLAYWRIGHT_CHROMIUM_PATH /
 * CHROME_PATH, the cloud dev image's /opt/pw-browsers/chromium, or the Google
 * Chrome that GitHub's Ubuntu runners ship. Returns null (tests skip) only
 * when none of them starts.
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

export async function launchTestChromium(): Promise<Browser | null> {
  const attempts: LaunchOptions[] = [{}];
  for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (p && existsSync(p)) attempts.push({ executablePath: p });
  }
  attempts.push({ channel: 'chrome' });
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch {
      // Try the next one.
    }
  }
  return null;
}
