import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';

/**
 * The single outbound HTTP path every vendor connector uses.
 *
 * Vendor APIs fail in ways that a bare `fetch` handles badly: they rate-limit,
 * they hang, and they put credentials in the URL that then land in a log line.
 * Centralising the call means retry policy, timeouts, and redaction are
 * properties of the system rather than of whichever connector was written last.
 */

export interface VendorRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Override the shared per-request timeout for a known-slow endpoint. */
  timeoutMs?: number;
  /** Skip retries for calls that are not safe to repeat. */
  idempotent?: boolean;
}

/** Failure from a vendor, carrying enough context to debug without the secret. */
export class VendorError extends Error {
  readonly vendor: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(vendor: string, status: number, message: string, retryable: boolean) {
    super(message);
    this.name = 'VendorError';
    this.vendor = vendor;
    this.status = status;
    this.retryable = retryable;
  }

  /**
   * Surface a vendor failure to the caller without leaking internals.
   *
   * Always 502, deliberately: a vendor's 401 means *their* stored credentials
   * are wrong, not that the caller's Atmosphere session expired. Passing the
   * 401 through would sign the user out of an app they are correctly logged
   * into, and a 404 from a vendor would claim our own route does not exist.
   */
  toHttpError(): HttpError {
    return new HttpError(502, `${this.vendor}: ${this.message}`, 'vendor_error');
  }
}

/**
 * A retry is only correct when the failure is transient. A 400 will fail
 * identically every time; a 429 or a 503 will not. 408 and 425 are included
 * because both mean "we did not process this", which makes a repeat safe.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  // Honour Retry-After when the vendor sends one — guessing shorter than they
  // asked is how a rate limit turns into a ban.
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  }
  const base = 500 * 2 ** attempt;
  return Math.min(base, 8_000) + Math.floor(Math.random() * 250); // jitter
}

export interface VendorClientOptions {
  vendor: string;
  baseUrl: string;
  /** Applied to every request; built fresh per call so tokens can refresh. */
  authHeaders: () => Promise<Record<string, string>> | Record<string, string>;
}

export class VendorHttpClient {
  private readonly vendor: string;
  private readonly baseUrl: string;
  private readonly authHeaders: VendorClientOptions['authHeaders'];

  constructor(options: VendorClientOptions) {
    this.vendor = options.vendor;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authHeaders = options.authHeaders;
  }

  private url(path: string, query?: VendorRequest['query']): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(req: VendorRequest): Promise<T> {
    const response = await this.raw(req);
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VendorError(
        this.vendor,
        response.status,
        `expected JSON from ${req.path} but got ${response.headers.get('content-type') ?? 'no content type'}`,
        false,
      );
    }
  }

  /** Binary fetch — photos and estimate exports are not JSON. */
  async fetchBinary(req: VendorRequest): Promise<{ bytes: Buffer; contentType: string }> {
    const response = await this.raw(req);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async raw(req: VendorRequest): Promise<Response> {
    const maxAttempts = req.idempotent === false ? 1 : config.estimator.maxRetries;
    let lastError: VendorError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        req.timeoutMs ?? config.estimator.requestTimeoutMs,
      );

      try {
        const response = await fetch(this.url(req.path, req.query), {
          method: req.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(await this.authHeaders()),
            ...(req.headers ?? {}),
          },
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: controller.signal,
        });

        if (response.ok) return response;

        // Read a bounded slice of the error body: vendors sometimes return an
        // HTML error page, and we do not want it all in a log line.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        lastError = new VendorError(
          this.vendor,
          response.status,
          `${response.status} on ${req.path}${detail ? ` — ${detail}` : ''}`,
          isRetryableStatus(response.status),
        );

        if (!lastError.retryable || attempt === maxAttempts - 1) throw lastError;
        await sleep(backoffMs(attempt, response.headers.get('retry-after')));
      } catch (err) {
        if (err instanceof VendorError) {
          if (!err.retryable || attempt === maxAttempts - 1) throw err;
          lastError = err;
          continue;
        }
        // Abort or network failure. Both mean the request did not complete, so
        // repeating it is safe.
        const aborted = err instanceof Error && err.name === 'AbortError';
        lastError = new VendorError(
          this.vendor,
          0,
          aborted ? `timed out on ${req.path}` : `network error on ${req.path}`,
          true,
        );
        if (attempt === maxAttempts - 1) throw lastError;
        await sleep(backoffMs(attempt, null));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new VendorError(this.vendor, 0, 'request failed', false);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
