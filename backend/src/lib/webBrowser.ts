import { config } from '../config.js';
import { HttpError } from './errors.js';
import { assertNavigable, parseHttpUrl } from './webUrlGuard.js';
import { collectPageState, type PageSnapshot } from './webPageScript.js';

export type { PageElement, PageSnapshot } from './webPageScript.js';

/**
 * The browser Atmosphere drives on a member's behalf.
 *
 * Playwright is imported dynamically so the server still boots — and every
 * other feature still works — on a host where the browser was never installed.
 * The Web Access routes report the feature as unavailable instead.
 *
 * Two things this module deliberately keeps away from the model:
 *
 * - **The password.** Sign-in is performed here, mechanically, before the agent
 *   loop starts. The credential is typed into the page by this code and never
 *   appears in a prompt, a tool result, or a stored step.
 * - **The URL.** Every navigation — whether the agent asked for it or a link
 *   caused it — is checked against the connection's site first.
 *
 * Page state is described to the model as a numbered list of interactive
 * elements rather than raw HTML: it is a fraction of the tokens, and it means
 * the model addresses elements by a reference we minted rather than by a
 * selector it invented.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** How much page text one observation may carry. Enough for a table, bounded. */
const MAX_TEXT_CHARS = 6000;
const MAX_ELEMENTS = 120;

/** Renders a snapshot as the compact text block the model actually reads. */
export function renderSnapshot(snapshot: PageSnapshot): string {
  const elements = snapshot.elements
    .map((el) => {
      const kind = el.type ? `${el.tag}:${el.type}` : el.tag;
      const value = el.value ? ` [current value: ${el.value}]` : '';
      return `  ${el.ref}  <${kind}> ${el.label || '(no label)'}${value}`;
    })
    .join('\n');

  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    '',
    'Interactive elements:',
    elements || '  (none found)',
    '',
    'Page text:',
    snapshot.text || '(empty)',
  ].join('\n');
}

export class WebBrowserSession {
  private constructor(
    private readonly browser: any,
    private readonly context: any,
    private readonly page: any,
    private readonly siteOrigin: URL,
  ) {}

  /**
   * Launches Chromium and opens the connection's site.
   *
   * Nothing is persisted between runs — no cookie jar, no storage state. Each
   * run signs in fresh, so a stolen disk yields no live sessions and a
   * credential revoked at the far end takes effect immediately.
   */
  static async open(siteUrl: URL): Promise<WebBrowserSession> {
    let chromium: any;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new HttpError(
        503,
        'The browser runtime is not installed on this server.',
        'web_access_browser_missing',
      );
    }

    const browser = await chromium.launch({
      headless: config.webAccess.headless,
      executablePath: config.webAccess.browserExecutablePath,
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        // Downloads would write attacker-influenced files to the server's disk
        // for no benefit — everything we want comes back as text.
        acceptDownloads: false,
      });
      context.setDefaultTimeout(config.webAccess.navigationTimeoutMs);
      context.setDefaultNavigationTimeout(config.webAccess.navigationTimeoutMs);

      const page = await context.newPage();
      const session = new WebBrowserSession(browser, context, page, siteUrl);
      await session.goto(siteUrl.toString());
      return session;
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  get currentUrl(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }

  /** Every navigation passes the scope + private-address check first. */
  async goto(rawUrl: string): Promise<void> {
    const url = parseHttpUrl(rawUrl);
    if (!url) {
      throw new HttpError(400, `${rawUrl} is not a usable web address.`, 'web_access_bad_url');
    }
    await assertNavigable(url, this.siteOrigin);
    await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await this.settle();
  }

  /**
   * Waits for the page to stop moving. Network-idle is best-effort: single-page
   * apps with polling or open sockets never reach it, and waiting out the full
   * timeout on every action would dominate a run's wall clock.
   */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  }

  async snapshot(): Promise<PageSnapshot> {
    // A click may have started a navigation that is still in flight.
    await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
    return (await this.page.evaluate(collectPageState, {
      maxElements: MAX_ELEMENTS,
      maxTextChars: MAX_TEXT_CHARS,
    })) as PageSnapshot;
  }

  private locate(ref: string) {
    if (!/^e\d+$/.test(ref)) {
      throw new HttpError(400, `${ref} is not an element reference.`, 'web_access_bad_ref');
    }
    return this.page.locator(`[data-atm-ref="${ref}"]`).first();
  }

  async click(ref: string): Promise<void> {
    const target = this.locate(ref);
    // A click can open a new tab; follow it so the run does not silently
    // continue against the page the user was navigated away from.
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup', { timeout: 3000 }).catch(() => null),
      target.click({ timeout: config.webAccess.navigationTimeoutMs }),
    ]);
    if (popup) {
      const popupUrl = parseHttpUrl(popup.url());
      if (popupUrl) await assertNavigable(popupUrl, this.siteOrigin);
      await popup.close().catch(() => undefined);
      if (popupUrl) await this.goto(popupUrl.toString());
      return;
    }
    await this.settle();
    await this.assertStillInScope();
  }

  async fill(ref: string, value: string): Promise<void> {
    const target = this.locate(ref);
    const type = ((await target.getAttribute('type').catch(() => null)) ?? '').toLowerCase();
    // The model never types credentials — sign-in is handled by signIn() below,
    // and this keeps a confused or prompt-injected agent from re-entering one
    // into an arbitrary field.
    if (type === 'password') {
      throw new HttpError(
        400,
        'Password fields are filled during sign-in only.',
        'web_access_password_field',
      );
    }
    await target.fill(value, { timeout: config.webAccess.navigationTimeoutMs });
  }

  async selectOption(ref: string, value: string): Promise<void> {
    const target = this.locate(ref);
    // Sites label options inconsistently; try the value, then the visible text.
    try {
      await target.selectOption({ value });
    } catch {
      await target.selectOption({ label: value });
    }
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.settle();
    await this.assertStillInScope();
  }

  /**
   * A page can move itself — a redirect, a meta refresh, a script. Checked
   * after every interaction so a run that leaves the authorised site stops
   * rather than continuing somewhere it was never allowed.
   */
  private async assertStillInScope(): Promise<void> {
    const url = parseHttpUrl(this.page.url());
    if (!url) return;
    await assertNavigable(url, this.siteOrigin);
  }

  /**
   * Signs in with the connection's credential.
   *
   * Login forms are not standardised, so this works the way a person does:
   * find the field that looks like a username, the one that is a password, put
   * the values in, and submit. It returns whether a session was established,
   * judged by the password field being gone afterwards — the one signal that
   * holds across sites that redirect, sites that swap the form out in place,
   * and sites that do neither.
   */
  async signIn(credentials: { loginUrl?: string; username: string; password: string }): Promise<
    { ok: true } | { ok: false; reason: string }
  > {
    if (credentials.loginUrl) {
      await this.goto(credentials.loginUrl);
    }

    const passwordField = this.page.locator('input[type="password"]:visible').first();
    if ((await passwordField.count()) === 0) {
      // Some portals put the username on its own page and reveal the password
      // field only after it is submitted.
      const advanced = await this.fillUsername(credentials.username);
      if (advanced) {
        await this.page.keyboard.press('Enter');
        await this.settle();
      }
      if ((await this.page.locator('input[type="password"]:visible').count()) === 0) {
        return { ok: false, reason: 'No sign-in form was found on this page.' };
      }
    } else {
      await this.fillUsername(credentials.username);
    }

    const password = this.page.locator('input[type="password"]:visible').first();
    await password.fill(credentials.password);

    const submit = this.page
      .locator(
        'button[type="submit"]:visible, input[type="submit"]:visible, button:has-text("Sign in"):visible, button:has-text("Log in"):visible, button:has-text("Login"):visible',
      )
      .first();
    if ((await submit.count()) > 0) {
      await submit.click().catch(() => undefined);
    } else {
      await password.press('Enter');
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await this.settle();
    await this.assertStillInScope();

    const stillAsking = await this.page.locator('input[type="password"]:visible').count();
    if (stillAsking > 0) {
      return {
        ok: false,
        reason: 'The site returned to the sign-in form — the username or password was not accepted.',
      };
    }
    return { ok: true };
  }

  /** Fills the field most likely to be the username. */
  private async fillUsername(username: string): Promise<boolean> {
    const candidates = [
      'input[type="email"]:visible',
      'input[name*="user" i]:visible',
      'input[name*="email" i]:visible',
      'input[id*="user" i]:visible',
      'input[id*="email" i]:visible',
      'input[autocomplete="username"]:visible',
      'input[type="text"]:visible',
    ];
    for (const selector of candidates) {
      const field = this.page.locator(selector).first();
      if ((await field.count()) > 0) {
        await field.fill(username).catch(() => undefined);
        return true;
      }
    }
    return false;
  }
}
