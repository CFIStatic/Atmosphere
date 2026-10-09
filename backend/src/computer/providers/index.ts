import { computerSettings } from '../config.js';
import { desktopAppEnabledFor, desktopAppForUrl, isDesktopUrl } from '../desktop/config.js';
import type { ComputerProvider } from '../types.js';
import { BrowserbaseProvider } from './browserbase.js';
import { WindowsDesktopProvider } from './windowsDesktop.js';

let override: ComputerProvider | null = null;
let browserbase: BrowserbaseProvider | null = null;
let windows: WindowsDesktopProvider | null = null;

/**
 * The browser provider Computer uses. Browserbase in every real environment;
 * tests swap in the mock with setComputerProviderForTests. The mock is never
 * picked from an environment variable, so production cannot fall onto it.
 */
export function computerProvider(): ComputerProvider {
  if (override) return override;
  if (!browserbase) browserbase = new BrowserbaseProvider(computerSettings().viewport);
  return browserbase;
}

/** The Windows desktop provider (one Windows computer per org). */
export function windowsDesktopProvider(): WindowsDesktopProvider {
  if (!windows) windows = new WindowsDesktopProvider(computerSettings().viewport);
  return windows;
}

/**
 * The provider for one task. A task that opens a desktop app (app://…) runs
 * on the org's Windows computer, but only when that app is switched on for
 * the org (COMPUTER_DESKTOP_APPS) and the org has a computer. Everything else
 * runs in the cloud browser. Tests that inject a provider keep it: their
 * tasks never target a desktop app.
 */
export function providerForTask(input: { orgId: string; startUrl: string | null }, browserProvider: ComputerProvider): ComputerProvider {
  if (override) return override;
  if (isDesktopUrl(input.startUrl)) {
    const app = desktopAppForUrl(input.startUrl);
    if (app && desktopAppEnabledFor(input.orgId, app.id)) return windowsDesktopProvider();
  }
  return browserProvider;
}

/** Computer is usable when either the cloud browser or at least one desktop is set up. */
export function computerConfigured(): boolean {
  return computerProvider().configured() || windowsDesktopProvider().configured();
}

export function setComputerProviderForTests(provider: ComputerProvider | null): void {
  override = provider;
}
