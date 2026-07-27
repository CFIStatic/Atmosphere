import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import {
  BaseXactimateDriver,
  DriverError,
  type ConnectInput,
  type ConnectResult,
  type EstimateSubmission,
  type XactimateProfile,
  type XactimateSession,
} from './driver.js';
import type { PriceList } from '../catalog/priceList.js';
import type { ConsentGrant } from './consent.js';
import type { EstimateLineItem, MitigationEstimate } from '../types.js';

/**
 * Xactimate Online via browser automation.
 *
 * ## When this is the right tool
 *
 * Most restoration contractors do not have a Verisk integration agreement, so
 * the API driver is not available to them. For those orgs this is the only way
 * to get an estimate into Xactimate without retyping it — the user's own
 * account, their own data, their own explicit permission, doing what they would
 * otherwise do by hand.
 *
 * ## What it costs, honestly
 *
 * Automation of a web UI is the least robust of the three options and the user
 * should know that before choosing it:
 *
 *   - **It replays a password.** The API driver never does. Everything in
 *     `credentials.ts` exists to contain this, and session-only mode is strongly
 *     preferred over stored credentials.
 *   - **It breaks when the UI changes.** Xactimate Online's DOM is not a public
 *     interface. Selectors live in configuration (`XACTIMATE_WEB_SELECTORS`) so a
 *     break is a config edit rather than a redeploy, and every step fails loudly
 *     with which selector missed rather than silently doing the wrong thing.
 *   - **Check the account terms.** Verisk's terms of use govern automated access,
 *     and they vary by agreement. Whether automation is permitted for a given
 *     account is the account holder's call to make, not this software's — so the
 *     driver is off unless explicitly enabled, and the connect screen says this
 *     in plain language.
 *
 * ## What it will not do
 *
 * It will not solve a CAPTCHA, disguise itself as a human, or work around a
 * block. If the site asks for a second factor it stops and asks the user for the
 * code. If it is blocked, it reports that and stops.
 */

/** Selectors, overridable without a redeploy when the UI moves. */
export interface WebSelectors {
  loginUrl: string;
  usernameInput: string;
  passwordInput: string;
  submitButton: string;
  mfaInput: string;
  mfaSubmit: string;
  loginError: string;
  profileName: string;
  priceListSelect: string;
  newEstimateButton: string;
  estimateIdField: string;
  lineItemCodeInput: string;
  lineItemQuantityInput: string;
  lineItemAddButton: string;
}

export const DEFAULT_WEB_SELECTORS: WebSelectors = {
  loginUrl: 'https://xactimate.example/login',
  usernameInput: 'input[name="username"]',
  passwordInput: 'input[type="password"]',
  submitButton: 'button[type="submit"]',
  mfaInput: 'input[name="mfaCode"]',
  mfaSubmit: 'button[data-action="verify"]',
  loginError: '[role="alert"]',
  profileName: '[data-testid="profile-name"]',
  priceListSelect: '[data-testid="price-list-select"]',
  newEstimateButton: '[data-testid="new-estimate"]',
  estimateIdField: '[data-testid="estimate-id"]',
  lineItemCodeInput: '[data-testid="line-item-code"]',
  lineItemQuantityInput: '[data-testid="line-item-quantity"]',
  lineItemAddButton: '[data-testid="line-item-add"]',
};

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WebHandle {
  browser: any;
  context: any;
  page: any;
}

const STEP_TIMEOUT_MS = 30_000;

export class XactimateWebDriver extends BaseXactimateDriver {
  readonly kind = 'web' as const;

  private readonly selectors: WebSelectors;

  constructor(selectors: Partial<WebSelectors> = {}) {
    super();
    if (!config.xactimate.webAutomationEnabled) {
      throw new DriverError(
        'Browser automation of Xactimate is disabled on this server. Set XACTIMATE_WEB_AUTOMATION=true to enable it, after confirming it is permitted under your Verisk account terms.',
        'web_driver_disabled',
      );
    }
    this.selectors = { ...DEFAULT_WEB_SELECTORS, ...config.xactimate.webSelectors, ...selectors };
  }

  /**
   * Playwright is loaded on demand so it stays an optional dependency —
   * deployments that never use this driver do not carry a browser.
   */
  private async playwright(): Promise<any> {
    try {
      // Indirected through a variable so TypeScript does not try to resolve the
      // module at build time — this stays an optional dependency, and a
      // deployment that never uses this driver never installs a browser.
      const moduleName = 'playwright';
      return await import(moduleName);
    } catch {
      throw new DriverError(
        'Browser automation needs Playwright, which is not installed. Run `npm install playwright` in backend/ and install a browser, or use the API driver or file export instead.',
        'playwright_missing',
      );
    }
  }

  async connect(input: ConnectInput, grant: ConsentGrant): Promise<ConnectResult> {
    return this.guard(grant, 'read_profile', 'connect', `browser sign-in as ${input.username}`, async () => {
      const { chromium } = await this.playwright();

      const browser = await chromium.launch({ headless: config.xactimate.headless });
      const context = await browser.newContext({
        // A real, current UA. Not to disguise anything — an empty or obviously
        // synthetic UA gets served a degraded page that the selectors miss.
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();

      try {
        await page.goto(this.selectors.loginUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });

        await this.fill(page, this.selectors.usernameInput, input.username, 'username field');
        await this.fill(page, this.selectors.passwordInput, input.password, 'password field');
        await page.click(this.selectors.submitButton, { timeout: STEP_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);

        // Second factor: stop and ask. Never attempt to work around it.
        const needsMfa = await page.locator(this.selectors.mfaInput).count().catch(() => 0);
        if (needsMfa > 0) {
          if (!input.mfaCode) {
            await browser.close();
            return {
              status: 'mfa_required',
              challengeId: randomUUID(),
              message: 'Xactimate asked for a verification code. Enter it to finish connecting.',
            } as const;
          }
          await this.fill(page, this.selectors.mfaInput, input.mfaCode, 'verification code field');
          await page.click(this.selectors.mfaSubmit, { timeout: STEP_TIMEOUT_MS });
          await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
        }

        const error = await page
          .locator(this.selectors.loginError)
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => null);

        if (error?.trim()) {
          await browser.close();
          return {
            status: 'failed',
            code: 'invalid_credentials',
            // Echo the site's own message; do not paraphrase a lockout warning.
            message: error.trim().slice(0, 200),
          } as const;
        }

        const displayName = await page
          .locator(this.selectors.profileName)
          .first()
          .textContent({ timeout: 5_000 })
          .catch(() => null);

        const session: XactimateSession = {
          id: randomUUID(),
          kind: this.kind,
          username: input.username,
          establishedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          handle: { browser, context, page } satisfies WebHandle,
        };

        this.log('browser session established', { username: input.username });

        return {
          status: 'connected',
          session,
          profile: {
            username: input.username,
            displayName: displayName?.trim() || input.username,
            availablePriceLists: await this.readPriceListOptions(page),
          } satisfies XactimateProfile,
        } as const;
      } catch (err) {
        await browser.close().catch(() => undefined);
        throw err;
      }
    });
  }

  async fetchPriceLists(session: XactimateSession, grant: ConsentGrant) {
    return this.guard(grant, 'read_price_list', 'fetch_price_lists', session.username, async () =>
      this.readPriceListOptions(handleOf(session).page),
    );
  }

  /**
   * Reading a full price list out of a UI is slow and lossy — thousands of rows
   * behind a paginated grid. Rather than scrape it badly, this reports what it
   * cannot do and points at the export the UI already offers.
   */
  async fetchPriceList(
    _session: XactimateSession,
    grant: ConsentGrant,
    priceListId: string,
  ): Promise<PriceList> {
    return this.guard(grant, 'read_price_list', 'fetch_price_list', priceListId, async () => {
      throw new DriverError(
        `Reading the full contents of price list "${priceListId}" is not something browser automation does reliably — the grid is paginated and lazily rendered, and a partially-scraped price list would silently mis-price the estimate. Export the price list from Xactimate and upload the file, or use the API driver.`,
        'price_list_unavailable_via_web',
      );
    });
  }

  async createEstimate(
    session: XactimateSession,
    grant: ConsentGrant,
    estimate: MitigationEstimate,
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'create_estimate',
      `job ${estimate.jobId}, ${estimate.lineItems.length} lines`,
      async () => {
        const { page } = handleOf(session);

        await page.click(this.selectors.newEstimateButton, { timeout: STEP_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);

        const estimateId =
          (await page
            .locator(this.selectors.estimateIdField)
            .first()
            .textContent({ timeout: STEP_TIMEOUT_MS })
            .catch(() => null))?.trim() ?? `WEB-${estimate.jobId.slice(0, 8).toUpperCase()}`;

        const result = await this.writeLines(page, estimate.lineItems);

        return {
          estimateId,
          url: page.url(),
          lineItemsWritten: result.written,
          warnings: result.warnings,
        };
      },
    );
  }

  async addLineItems(
    session: XactimateSession,
    grant: ConsentGrant,
    estimateId: string,
    lineItems: EstimateLineItem[],
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'add_line_items',
      `${lineItems.length} lines to ${estimateId}`,
      async () => {
        const result = await this.writeLines(handleOf(session).page, lineItems);
        return { estimateId, lineItemsWritten: result.written, warnings: result.warnings };
      },
    );
  }

  async disconnect(session: XactimateSession): Promise<void> {
    const handle = session.handle as WebHandle | undefined;
    await handle?.context?.close?.().catch(() => undefined);
    await handle?.browser?.close?.().catch(() => undefined);
  }

  /* ---- steps ---- */

  /**
   * Type one line at a time and keep going when a row fails.
   *
   * A partial write is reported precisely — which codes went in, which did not —
   * because "17 of 23 lines written, these 6 failed" is actionable, and "the
   * import failed" after twenty minutes of automation is not.
   */
  private async writeLines(
    page: any,
    lineItems: EstimateLineItem[],
  ): Promise<{ written: number; warnings: string[] }> {
    const warnings: string[] = [];
    let written = 0;

    for (const line of lineItems) {
      try {
        await this.fill(page, this.selectors.lineItemCodeInput, line.code, 'line item code field');
        await this.fill(
          page,
          this.selectors.lineItemQuantityInput,
          String(line.quantity),
          'line item quantity field',
        );
        await page.click(this.selectors.lineItemAddButton, { timeout: STEP_TIMEOUT_MS });
        // Let the grid settle before the next row; typing into a re-rendering
        // grid is how quantities land on the wrong line.
        await page.waitForTimeout(250);
        written += 1;
      } catch (err) {
        warnings.push(
          `Could not write ${line.code} (${line.quantity} ${line.unit}): ${err instanceof Error ? err.message : 'unknown error'}. Add this line by hand.`,
        );
      }
    }

    return { written, warnings };
  }

  private async fill(page: any, selector: string, value: string, label: string): Promise<void> {
    const locator = page.locator(selector).first();
    const found = await locator.count().catch(() => 0);
    if (found === 0) {
      throw new DriverError(
        `Could not find the ${label} on the Xactimate page (selector "${selector}"). The site's layout has probably changed — update XACTIMATE_WEB_SELECTORS.`,
        'selector_not_found',
      );
    }
    await locator.fill(value, { timeout: STEP_TIMEOUT_MS });
  }

  private async readPriceListOptions(page: any): Promise<XactimateProfile['availablePriceLists']> {
    try {
      const options = await page.locator(`${this.selectors.priceListSelect} option`).all();
      const lists = await Promise.all(
        options.map(async (option: any) => ({
          id: (await option.getAttribute('value')) ?? '',
          name: ((await option.textContent()) ?? '').trim(),
        })),
      );
      return lists.filter((list: { id: string }) => list.id);
    } catch {
      return [];
    }
  }
}

function handleOf(session: XactimateSession): WebHandle {
  const handle = session.handle as WebHandle | undefined;
  if (!handle?.page) {
    throw new DriverError('The Xactimate browser session has closed. Reconnect and try again.', 'session_closed');
  }
  return handle;
}
