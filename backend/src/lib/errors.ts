/**
 * Small typed HTTP error used across routes so the central error handler can
 * translate thrown errors into clean JSON responses without leaking internals.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Not authenticated', code = 'unauthorized') =>
  new HttpError(401, msg, code);
/** The caller is signed in but not allowed to perform this action. */
export const forbidden = (msg = 'Not allowed', code = 'forbidden') => new HttpError(403, msg, code);
/** Out of credits, or over a configured spend limit — the caller must top up. */
export const paymentRequired = (msg: string, code = 'payment_required') =>
  new HttpError(402, msg, code);
export const notFound = (msg = 'Not found', code = 'not_found') => new HttpError(404, msg, code);
export const tooMany = (msg = 'Too many requests', code = 'rate_limited') =>
  new HttpError(429, msg, code);
export const serviceUnavailable = (msg = 'Auth service temporarily unavailable', code = 'auth_unavailable') =>
  new HttpError(503, msg, code);
