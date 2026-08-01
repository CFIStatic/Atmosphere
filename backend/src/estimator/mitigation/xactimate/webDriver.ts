import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../../config.js';
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
 * ## Production posture
 *
 * Selectors default to Xactimate Online / Xactware sign-in surfaces and are
 * overridable via `XACTIMATE_WEB_SELECTORS` without a redeploy. Every step fails
 * loudly with which selector missed. Screenshots are captured on failure into
 * a local artifacts directory so a broken DOM change is debuggable. The driver
 * will not solve CAPTCHAs, disguise itself, or scrape the price grid.
 */

/** Selectors, overridable without a redeploy when the UI moves. */
export interface WebSelectors {
  loginUrl: string;
  workspaceUrl: string;
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
  /** Claim / job header fields written before line items. */
  claimNumberInput: string;
  insuredNameInput: string;
  lossAddressInput: string;
  priceListPicker: string;
  /** Line-item entry. */
  lineItemCodeInput: string;
  lineItemAutocompleteOption: string;
  lineItemQuantityInput: string;
  lineItemRoomInput: string;
  lineItemAddButton: string;
  lineItemGridRow: string;
}

/**
 * Defaults aimed at Xactimate Online (XO) / Xactware identity.
 *
 * Verisk's DOM is not a public contract — these are starting points. Deployments
 * that hit a real account should set `XACTIMATE_WEB_SELECTORS` to the selectors
 * recorded against their tenant, and keep them versioned with the XO release.
 */
export const DEFAULT_WEB_SELECTORS: WebSelectors = {
  loginUrl: 'https://www.xactware.com/en-us/sign-in/',
  workspaceUrl: 'https://www.xactonline.com/',
  usernameInput: 'input[name="username"], input[name="email"], input#username, input[type="email"]',
  passwordInput: 'input[name="password"], input#password, input[type="password"]',
  submitButton: 'button[type="submit"], button[name="login"], input[type="submit"]',
  mfaInput: 'input[name="mfaCode"], input[name="otp"], input[name="code"], input[autocomplete="one-time-code"]',
  mfaSubmit: 'button[data-action="verify"], button[type="submit"]',
  loginError: '[role="alert"], .error-message, .login-error, .alert-danger',
  profileName: '[data-testid="profile-name"], .user-display-name, .profile-name, [data-qa="user-name"]',
  priceListSelect: '[data-testid="price-list-select"], select[name="priceList"], #price-list-select',
  newEstimateButton:
    '[data-testid="new-estimate"], button:has-text("New Estimate"), button:has-text("Create Estimate"), [aria-label="New estimate"]',
  estimateIdField: '[data-testid="estimate-id"], [data-qa="estimate-id"], .estimate-id',
  claimNumberInput:
    'input[name="claimNumber"], input[name="claim"], [data-testid="claim-number"], input[placeholder*="Claim"]',
  insuredNameInput:
    'input[name="insuredName"], input[name="insured"], [data-testid="insured-name"], input[placeholder*="Insured"]',
  lossAddressInput:
    'input[name="lossAddress"], input[name="address"], [data-testid="loss-address"], input[placeholder*="Address"]',
  priceListPicker:
    '[data-testid="estimate-price-list"], select[name="priceListId"], [aria-label*="Price list"]',
  lineItemCodeInput:
    'input[name="sel"], input[name="code"], [data-testid="line-item-code"], input[placeholder*="Sel"], input[aria-label*="Selector"]',
  lineItemAutocompleteOption:
    '[role="option"], .autocomplete-item, .selector-suggestion, [data-testid="selector-option"]',
  lineItemQuantityInput:
    'input[name="qty"], input[name="quantity"], [data-testid="line-item-quantity"], input[aria-label*="Qty"]',
  lineItemRoomInput:
    'input[name="room"], [data-testid="line-item-room"], input[placeholder*="Room"]',
  lineItemAddButton:
    '[data-testid="line-item-add"], button:has-text("Add"), button[aria-label="Add line"], button:has-text("Enter")',
  lineItemGridRow: '[data-testid="line-item-row"], tr.line-item, .estimate-line-row',
};

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WebHandle {
  browser: any;
  context: any;
  page: any;
  artifactsDir: string;
}

const STEP_TIMEOUT_MS = 45_000;
const LINE_SETTLE_MS = 400;

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
      const artifactsDir = path.join(
        process.cwd(),
        '.xactimate-artifacts',
        new Date().toISOString().replace(/[:.]/g, '-'),
      );
      await mkdir(artifactsDir, { recursive: true });

      const browser = await chromium.launch({
        headless: config.xactimate.headless,
        args: ['--disable-dev-shm-usage'],
      });
      const context = await browser.newContext({
        // A real, current UA. Not to disguise anything — an empty or obviously
        // synthetic UA gets served a degraded page that the selectors miss.
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(STEP_TIMEOUT_MS);

      try {
        await page.goto(this.selectors.loginUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });

        await this.fill(page, this.selectors.usernameInput, input.username, 'username field');
        await this.fill(page, this.selectors.passwordInput, input.password, 'password field');
        await this.clickFirst(page, this.selectors.submitButton, 'sign-in button');
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);

        // Second factor: stop and ask. Never attempt to work around it.
        const needsMfa = await this.countAny(page, this.selectors.mfaInput);
        if (needsMfa > 0) {
          if (!input.mfaCode) {
            await this.capture(page, artifactsDir, 'mfa-required');
            await browser.close();
            return {
              status: 'mfa_required',
              challengeId: randomUUID(),
              message: 'Xactimate asked for a verification code. Enter it to finish connecting.',
            } as const;
          }
          await this.fill(page, this.selectors.mfaInput, input.mfaCode, 'verification code field');
          await this.clickFirst(page, this.selectors.mfaSubmit, 'MFA verify button');
          await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
        }

        const error = await this.firstText(page, this.selectors.loginError, 2_000);
        if (error?.trim()) {
          await this.capture(page, artifactsDir, 'login-error');
          await browser.close();
          return {
            status: 'failed',
            code: 'invalid_credentials',
            message: error.trim().slice(0, 200),
          } as const;
        }

        // Prefer the workspace URL when login lands on an interstitial.
        if (this.selectors.workspaceUrl) {
          const onWorkspace = page.url().includes('xactonline') || page.url().includes('xactimate');
          if (!onWorkspace) {
            await page
              .goto(this.selectors.workspaceUrl, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS })
              .catch(() => undefined);
          }
        }

        const displayName = await this.firstText(page, this.selectors.profileName, 5_000);

        const session: XactimateSession = {
          id: randomUUID(),
          kind: this.kind,
          username: input.username,
          establishedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          handle: { browser, context, page, artifactsDir } satisfies WebHandle,
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
        await this.capture(page, artifactsDir, 'connect-failed').catch(() => undefined);
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
        `Reading the full contents of price list "${priceListId}" is not something browser automation does reliably — the grid is paginated and lazily rendered, and a partially-scraped price list would silently mis-price the estimate. Export the price list from Xactimate Online and upload the file, or use the API driver.`,
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
        const handle = handleOf(session);
        const { page, artifactsDir } = handle;

        try {
          await this.clickFirst(page, this.selectors.newEstimateButton, 'new estimate button');
          await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS }).catch(() => undefined);

          await this.fillHeader(page, estimate);

          const estimateId =
            (await this.firstText(page, this.selectors.estimateIdField, STEP_TIMEOUT_MS))?.trim() ??
            `WEB-${estimate.jobId.slice(0, 8).toUpperCase()}`;

          const result = await this.writeLines(page, estimate.lineItems, artifactsDir);

          return {
            estimateId,
            url: page.url(),
            lineItemsWritten: result.written,
            warnings: result.warnings,
          };
        } catch (err) {
          await this.capture(page, artifactsDir, 'create-estimate-failed');
          throw err;
        }
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
        const handle = handleOf(session);
        const result = await this.writeLines(handle.page, lineItems, handle.artifactsDir);
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

  private async fillHeader(page: any, estimate: MitigationEstimate): Promise<void> {
    const claim = estimate.assessment.claimNumber;
    const insured = estimate.assessment.insuredName;
    const address = estimate.assessment.propertyAddress;

    if (claim) {
      await this.fillOptional(page, this.selectors.claimNumberInput, claim, 'claim number');
    }
    if (insured) {
      await this.fillOptional(page, this.selectors.insuredNameInput, insured, 'insured name');
    }
    if (address) {
      await this.fillOptional(page, this.selectors.lossAddressInput, address, 'loss address');
    }
  }

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
    artifactsDir: string,
  ): Promise<{ written: number; warnings: string[] }> {
    const warnings: string[] = [];
    let written = 0;

    for (const line of lineItems) {
      try {
        await this.fill(page, this.selectors.lineItemCodeInput, line.code, 'line item code field');

        // Wait for autocomplete and pick the matching selector when XO offers one.
        const optionCount = await this.countAny(page, this.selectors.lineItemAutocompleteOption);
        if (optionCount > 0) {
          const matched = page
            .locator(this.selectors.lineItemAutocompleteOption)
            .filter({ hasText: line.code })
            .first();
          if ((await matched.count().catch(() => 0)) > 0) {
            await matched.click({ timeout: STEP_TIMEOUT_MS });
          } else {
            await page.locator(this.selectors.lineItemAutocompleteOption).first().click({
              timeout: STEP_TIMEOUT_MS,
            });
          }
        }

        if (line.roomName) {
          await this.fillOptional(page, this.selectors.lineItemRoomInput, line.roomName, 'room field');
        }

        await this.fill(
          page,
          this.selectors.lineItemQuantityInput,
          String(line.quantity),
          'line item quantity field',
        );
        await this.clickFirst(page, this.selectors.lineItemAddButton, 'add line button');

        // Let the grid settle before the next row; typing into a re-rendering
        // grid is how quantities land on the wrong line.
        await page.waitForTimeout(LINE_SETTLE_MS);

        // Best-effort verification that the row appeared.
        const rows = await this.countAny(page, this.selectors.lineItemGridRow);
        if (rows === 0) {
          warnings.push(
            `Wrote ${line.code} but could not confirm it in the line grid — verify in Xactimate Online.`,
          );
        }

        written += 1;
      } catch (err) {
        await this.capture(page, artifactsDir, `line-fail-${line.code}`).catch(() => undefined);
        warnings.push(
          `Could not write ${line.code} (${line.quantity} ${line.unit}): ${err instanceof Error ? err.message : 'unknown error'}. Add this line by hand.`,
        );
      }
    }

    return { written, warnings };
  }

  private async fill(page: any, selector: string, value: string, label: string): Promise<void> {
    const locator = await this.firstLocator(page, selector, label);
    await locator.click({ timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
    await locator.fill('');
    await locator.fill(value, { timeout: STEP_TIMEOUT_MS });
  }

  private async fillOptional(page: any, selector: string, value: string, _label: string): Promise<void> {
    const count = await this.countAny(page, selector);
    if (count === 0) return;
    const locator = page.locator(selector).first();
    await locator.click({ timeout: 5_000 }).catch(() => undefined);
    await locator.fill(value, { timeout: 5_000 }).catch(() => undefined);
  }

  private async clickFirst(page: any, selector: string, label: string): Promise<void> {
    const locator = await this.firstLocator(page, selector, label);
    await locator.click({ timeout: STEP_TIMEOUT_MS });
  }

  private async firstLocator(page: any, selector: string, label: string): Promise<any> {
    const locator = page.locator(selector).first();
    const found = await locator.count().catch(() => 0);
    if (found === 0) {
      throw new DriverError(
        `Could not find the ${label} on the Xactimate page (selector "${selector}"). The site's layout has probably changed — update XACTIMATE_WEB_SELECTORS.`,
        'selector_not_found',
      );
    }
    return locator;
  }

  private async countAny(page: any, selector: string): Promise<number> {
    return page.locator(selector).count().catch(() => 0);
  }

  private async firstText(page: any, selector: string, timeoutMs: number): Promise<string | null> {
    return page
      .locator(selector)
      .first()
      .textContent({ timeout: timeoutMs })
      .catch(() => null);
  }

  private async capture(page: any, artifactsDir: string, label: string): Promise<void> {
    try {
      await mkdir(artifactsDir, { recursive: true });
      const file = path.join(artifactsDir, `${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const html = path.join(artifactsDir, `${label}.html`);
      await writeFile(html, await page.content(), 'utf8');
    } catch {
      /* best-effort diagnostics */
    }
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
