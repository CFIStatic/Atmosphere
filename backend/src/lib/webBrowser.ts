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

/**
 * Labels a read-only session refuses to click.
 *
 * The verifier browses a site it must not change, and "the prompt told it not
 * to" is not a guarantee. Two layers enforce that instead, and this is the
 * second: even where a write slips past the request filter — a form that
 * navigates by GET, a link that mutates on click — a control that announces
 * itself as committing or destructive is not pressed.
 *
 * Deliberately broad. A false positive costs one refused click, which surfaces
 * as "could not determine" and asks a human; a false negative writes to
 * somebody's carrier portal. Those are not comparable, so this errs heavily
 * toward refusing.
 */
const DESTRUCTIVE_LABEL =
  /\b(delete|remove|destroy|discard|purge|void|revoke|archive|restore|reset|clear|cancel|reject|decline|deactivate|disable|unlink|assign|unassign|merge|overwrite|replace|submit|save|create|add|new|update|edit|confirm|approve|accept|acknowledge|sign|finali[sz]e|post|publish|send|pay|charge|refund|issue|import|upload|apply|trash|bin|danger)\b/i;

/**
 * The same idea applied to a URL rather than a caption.
 *
 * Deliberately shorter than the label list: a path carries far more incidental
 * words than a button does, and blanket-refusing every address containing
 * "new" or "add" would leave the verifier unable to reach the pages it has to
 * read. What stays are the verbs that only ever appear on an address because
 * opening it does something.
 */
const DESTRUCTIVE_PATH =
  /\b(delete|destroy|purge|void|revoke|deactivate|unlink|unassign|overwrite|approve|reject|confirm|submit|publish|refund|charge|payout|archive|reset)\b/i;

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

export interface OpenOptions {
  /**
   * Refuse to change anything on the far side. Used by the verifier, which has
   * to look at a site it must not disturb: an observation that alters what it
   * is observing is not evidence, and a check that can write is a second way
   * to damage the customer's system rather than a safeguard against the first.
   */
  readOnly?: boolean;
}

export class WebBrowserSession {
  private constructor(
    private readonly browser: any,
    private readonly context: any,
    private readonly page: any,
    private readonly siteOrigin: URL,
    public readonly readOnly: boolean,
  ) {}

  /**
   * Launches Chromium and opens the connection's site.
   *
   * Nothing is persisted between runs — no cookie jar, no storage state. Each
   * run signs in fresh, so a stolen disk yields no live sessions and a
   * credential revoked at the far end takes effect immediately.
   */
  static async open(siteUrl: URL, options: OpenOptions = {}): Promise<WebBrowserSession> {
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

    const readOnly = options.readOnly === true;

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
        // A service worker re-issues the page's requests from its own scope,
        // where context.route never sees them — Playwright documents this and
        // recommends exactly this option alongside interception. Left at the
        // default, a PWA portal would route every write around the filter
        // below and the read-only guarantee would quietly not apply.
        ...(readOnly ? { serviceWorkers: 'block' as const } : {}),
      });
      context.setDefaultTimeout(config.webAccess.navigationTimeoutMs);
      context.setDefaultNavigationTimeout(config.webAccess.navigationTimeoutMs);

      // The first and stronger read-only layer, installed before anything
      // loads. A browser cannot change a website without sending an unsafe
      // method, so refusing those makes "look but do not touch" a property of
      // the transport rather than a promise the model is asked to keep.
      //
      // Sign-in is exempt: it is a POST, it happens before the agent gets
      // control, and without it there is nothing to look at. The exemption is
      // lifted the moment the credential has been submitted.
      if (readOnly) {
        await context.route('**/*', async (route: any) => {
          const method = String(route.request().method() ?? 'GET').toUpperCase();
          if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
            await route.continue();
            return;
          }
          const owner = context.__atmSession as WebBrowserSession | undefined;
          if (owner?.signInInFlight) {
            await route.continue();
            return;
          }
          // Counted, not just refused. A page whose reads go out over POST is
          // one this filter may have blinded, and a verdict of "the record is
          // missing" reached on a page we broke ourselves must never be acted
          // on — the runner reads this to decide whether it may repair.
          if (owner) owner.blockedWrites += 1;
          await route.abort('blockedbyclient');
        });

        // Sockets carry mutations too, and context.route never sees a frame on
        // an established connection — only the opening handshake, which is a
        // GET the filter above would wave through. Server frames are forwarded
        // so the page still renders; frames the page tries to send are
        // dropped. A socket-driven site may therefore render incompletely,
        // which surfaces as "could not tell" and asks a person — the intended
        // direction to fail in.
        if (typeof context.routeWebSocket === 'function') {
          await context.routeWebSocket('**/*', (ws: any) => {
            const server = ws.connectToServer();
            server.onMessage((message: any) => ws.send(message));
            ws.onMessage(() => {
              const owner = context.__atmSession as WebBrowserSession | undefined;
              if (owner) owner.blockedWrites += 1;
            });
          });
        }
      }

      const page = await context.newPage();
      const session = new WebBrowserSession(browser, context, page, siteUrl, readOnly);
      context.__atmSession = session;
      await session.goto(siteUrl.toString());
      return session;
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  /**
   * True only while signIn() is submitting the credential. The read-only
   * request filter consults it so a verification session can authenticate
   * without being able to write anything afterwards.
   */
  private signInInFlight = false;

  /**
   * How many outbound writes the read-only guard refused.
   *
   * Above zero, this session may have been shown less than the page really
   * holds — a search that posts, a table that loads over a socket. That makes
   * any "it is not there" conclusion unsafe to act on, so the runner treats a
   * violation found on such a session as unsettled and asks a person rather
   * than writing to the customer's system on the strength of a page we broke.
   */
  public blockedWrites = 0;

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
    this.assertNavigationAllowed(url);
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
    // A click or a keypress may have started a navigation that is still in
    // flight. Waiting for domcontentloaded is not enough on its own: the
    // document can be swapped between that wait and the evaluate, which tears
    // down the execution context mid-call. Retrying once settles it, and is
    // much better than the alternative — the agent loses the step, is told
    // "that action failed", and re-reads a page that was never actually
    // broken.
    for (let attempt = 0; ; attempt += 1) {
      await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
      try {
        return (await this.page.evaluate(collectPageState, {
          maxElements: MAX_ELEMENTS,
          maxTextChars: MAX_TEXT_CHARS,
        })) as PageSnapshot;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt >= 2 || !/execution context was destroyed|navigation/i.test(message)) throw err;
        await this.settle();
      }
    }
  }

  private locate(ref: string) {
    if (!/^e\d+$/.test(ref)) {
      throw new HttpError(400, `${ref} is not an element reference.`, 'web_access_bad_ref');
    }
    return this.page.locator(`[data-atm-ref="${ref}"]`).first();
  }

  /**
   * Reads whatever a person would use to identify a control, so a read-only
   * session can judge what it is about to press.
   */
  private async describeElement(target: any): Promise<string> {
    // Must read at least everything the page-side snapshot reads, or the model
    // is shown "Delete invoice INV-1001" for a control this method sees as an
    // empty string and therefore allows. Icon-only buttons and controls named
    // through aria-labelledby are the common shapes of that gap, and they are
    // exactly the ones that delete things.
    const attributes = await target
      .evaluate((el: any) => {
        const attr = (name: string) => (el.getAttribute(name) ?? '').trim();
        const labelledBy = attr('aria-labelledby');
        const labelled = labelledBy
          ? (el.ownerDocument.getElementById(labelledBy)?.textContent ?? '').trim()
          : '';
        // Matched by comparing attributes rather than by building a selector,
        // so an id containing quotes or brackets cannot break the query.
        const associated = el.id
          ? (
              Array.prototype.find.call(
                el.ownerDocument.querySelectorAll('label[for]'),
                (label: any) => label.getAttribute('for') === el.id,
              )?.textContent ?? ''
            ).trim()
          : '';
        return [
          (el.innerText ?? '').trim(),
          el.textContent ? String(el.textContent).trim() : '',
          attr('aria-label'),
          labelled,
          associated,
          attr('placeholder'),
          attr('title'),
          attr('name'),
          attr('value'),
          attr('alt'),
          // The href of a link is part of how it announces itself, and
          // /invoices/1001/delete announces plenty.
          attr('href'),
          // Icon fonts and utility classes are often the only clue a bare
          // button carries: class="btn-danger", <i class="icon-trash">.
          attr('class'),
          Array.prototype.map
            .call(el.querySelectorAll('[class],[aria-label],[title]'), (child: any) =>
              [
                child.getAttribute('class') ?? '',
                child.getAttribute('aria-label') ?? '',
                child.getAttribute('title') ?? '',
              ].join(' '),
            )
            .join(' '),
        ]
          .filter(Boolean)
          .join(' ');
      })
      .catch(() => '');

    return String(attributes).replace(/\s+/g, ' ').trim().slice(0, 600);
  }

  /**
   * The second read-only layer. The request filter stops the write itself;
   * this stops the verifier from ever pressing the button, so a control that
   * mutates through a route the filter cannot classify is still left alone.
   */
  private async assertClickAllowed(target: any): Promise<void> {
    if (!this.readOnly) return;
    const label = await this.describeElement(target);
    if (DESTRUCTIVE_LABEL.test(label)) {
      throw new HttpError(
        400,
        `Refused to click "${label.trim().slice(0, 80)}" — this check may not change anything on the site.`,
        'verifier_read_only',
      );
    }
  }

  /**
   * Plenty of older systems still change data on a plain GET —
   * `/invoices/1001/void?confirm=1` is a link, not a form. The request filter
   * waves those through by construction, and the URL is attacker-supplyable:
   * it can arrive in page text the model was asked to read. So a read-only
   * session reads the address itself before opening it.
   *
   * Narrower than the label list, because a path is a much noisier signal than
   * a button caption and refusing `/invoices/new` outright would stop the
   * verifier reaching most of what it needs to see.
   */
  private assertNavigationAllowed(url: URL): void {
    if (!this.readOnly) return;
    let words: string;
    try {
      words = decodeURIComponent(`${url.pathname} ${url.search}`);
    } catch {
      words = `${url.pathname} ${url.search}`;
    }
    words = words.replace(/[/_+.=&?%:,-]+/g, ' ');
    if (DESTRUCTIVE_PATH.test(words)) {
      throw new HttpError(
        400,
        `Refused to open ${url.pathname} — this check may not change anything on the site.`,
        'verifier_read_only',
      );
    }
  }

  async click(ref: string): Promise<void> {
    const target = this.locate(ref);
    await this.assertClickAllowed(target);
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
    // A <select> can be the control that performs the action ("Bulk action:
    // Delete"), so it goes through the same gate a button does — including the
    // option being chosen, which is where the verb usually lives.
    await this.assertClickAllowed(target);
    if (this.readOnly && DESTRUCTIVE_LABEL.test(value)) {
      throw new HttpError(
        400,
        `Refused to choose "${value.slice(0, 80)}" — this check may not change anything on the site.`,
        'verifier_read_only',
      );
    }
    // Sites label options inconsistently; try the value, then the visible text.
    try {
      await target.selectOption({ value });
    } catch {
      await target.selectOption({ label: value });
    }
  }

  /**
   * Keys that only move around or open things. A read-only session is held to
   * this list because `press` is otherwise a way to activate the very control
   * `click` just refused — focus the "Save" button, press Enter, and the label
   * guard was never consulted. Single-letter shortcuts (Gmail-style `e` to
   * archive, `#` to delete) are refused for the same reason.
   */
  private static readonly READ_ONLY_KEYS = new Set([
    'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'NumpadEnter',
  ]);

  async press(key: string): Promise<void> {
    if (this.readOnly) {
      if (!WebBrowserSession.READ_ONLY_KEYS.has(key)) {
        throw new HttpError(
          400,
          `Refused to press "${key}" — this check may only navigate and read.`,
          'verifier_read_only',
        );
      }
      // Enter activates whatever has focus, so it is a click by another name.
      if (key === 'Enter' || key === 'NumpadEnter') await this.assertFocusedActivationAllowed();
    }
    await this.page.keyboard.press(key);
    await this.settle();
    await this.assertStillInScope();
  }

  /**
   * Runs the click guard over the element Enter would activate — the focused
   * control, and the default submit button of any form it sits in.
   */
  private async assertFocusedActivationAllowed(): Promise<void> {
    const focused = this.page.locator(':focus');
    if ((await focused.count().catch(() => 0)) === 0) return;
    const element = focused.first();
    await this.assertClickAllowed(element);

    const submit = element
      .locator('xpath=ancestor::form[1]')
      .locator('button[type="submit"], input[type="submit"], button:not([type])')
      .first();
    if ((await submit.count().catch(() => 0)) > 0) {
      await this.assertClickAllowed(submit);
    }
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
    // A read-only session still has to authenticate, and authentication is a
    // write as far as the request filter is concerned. Open exactly that hole,
    // for exactly this call, and close it again in every exit path.
    this.signInInFlight = true;
    try {
      return await this.performSignIn(credentials);
    } finally {
      this.signInInFlight = false;
    }
  }

  private async performSignIn(credentials: {
    loginUrl?: string;
    username: string;
    password: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
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
