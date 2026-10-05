import { computerSettings } from '../config.js';
import type { ComputerProvider } from '../types.js';
import { BrowserbaseProvider } from './browserbase.js';

let override: ComputerProvider | null = null;
let browserbase: BrowserbaseProvider | null = null;

/**
 * The provider Computer uses. Browserbase in every real environment; tests
 * swap in the mock with setComputerProviderForTests. The mock is never
 * picked from an environment variable, so production cannot fall onto it.
 */
export function computerProvider(): ComputerProvider {
  if (override) return override;
  if (!browserbase) browserbase = new BrowserbaseProvider(computerSettings().viewport);
  return browserbase;
}

export function computerConfigured(): boolean {
  return computerProvider().configured();
}

export function setComputerProviderForTests(provider: ComputerProvider | null): void {
  override = provider;
}
