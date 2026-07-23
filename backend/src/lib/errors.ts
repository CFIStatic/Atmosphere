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
export const tooMany = (msg = 'Too many requests', code = 'rate_limited') =>
  new HttpError(429, msg, code);
