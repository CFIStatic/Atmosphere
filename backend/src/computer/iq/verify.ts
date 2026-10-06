/**
 * Action verification: after every click, key or typed text, check that the
 * page actually changed (URL, text, focus, field values, dialogs) and, when a
 * step says what should happen, that it did. An action that changed nothing
 * is reported as a failure instead of being assumed to have worked.
 */
import type { ComputerDriver } from '../types.js';
import type { StepExpect } from './playbookSteps.js';

export async function fingerprint(driver: ComputerDriver): Promise<string | null> {
  if (!driver.pageFingerprint) return null;
  return driver.pageFingerprint().catch(() => null);
}

/** Poll until the fingerprint differs from `before` (or the timeout passes). */
export async function waitForChange(
  driver: ComputerDriver,
  before: string | null,
  sleep: (ms: number) => Promise<void>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ changed: boolean; after: string | null }> {
  if (before == null) return { changed: true, after: null };
  const interval = opts.intervalMs ?? 250;
  const tries = Math.max(1, Math.ceil((opts.timeoutMs ?? 2_000) / interval));
  let after: string | null = await fingerprint(driver);
  for (let i = 0; i < tries && after === before; i += 1) {
    await sleep(interval);
    after = await fingerprint(driver);
  }
  return { changed: after == null || after !== before, after };
}

/** Did the expected change happen? Returns the unmet part, or null when it is met. */
export async function unmetExpectation(driver: ComputerDriver, expect: StepExpect | undefined): Promise<string | null> {
  if (!expect) return null;
  if (expect.urlIncludes) {
    const url = await driver.currentUrl().catch(() => '');
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      /* keep raw */
    }
    if (!path.includes(expect.urlIncludes) && !url.includes(expect.urlIncludes)) return `expected the address to include ${expect.urlIncludes}`;
  }
  if (expect.textIncludes) {
    const text = driver.visibleText ? await driver.visibleText().catch(() => '') : '';
    if (!text.toLowerCase().includes(expect.textIncludes.toLowerCase())) return `expected to see “${expect.textIncludes}”`;
  }
  return null;
}

/** Wait for an expectation, polling briefly (pages load asynchronously). */
export async function waitForExpectation(
  driver: ComputerDriver,
  expect: StepExpect | undefined,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = 6_000,
): Promise<string | null> {
  let unmet = await unmetExpectation(driver, expect);
  for (let waited = 0; unmet && waited < timeoutMs; waited += 500) {
    await sleep(500);
    unmet = await unmetExpectation(driver, expect);
  }
  return unmet;
}
