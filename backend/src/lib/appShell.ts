import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors.js';

/**
 * The iPhone / Android app (apps/mobile, Capacitor) appends
 * "AtmosphereFieldCapture" to its web view user agent, and that user agent
 * also covers the office console inside Field Capture's Dashboard frame.
 * App Store rule 3.1.1: nothing bought or charged from inside the app.
 */
export const APP_SHELL_UA = /AtmosphereFieldCapture/;

export function isAppShellRequest(req: Pick<Request, 'get'>): boolean {
  return APP_SHELL_UA.test(req.get('user-agent') ?? '');
}

/** Shown in the app instead of a seat checkout. No link and no price. */
export const APP_SHELL_SEAT_MESSAGE =
  'Every Field Capture seat on this team is in use. Manage seats on atmosphereteam.com.';

/** Shown in the app instead of plan, credit, or payment screens. */
export const APP_SHELL_BILLING_MESSAGE = 'Plans and billing are managed on atmosphereteam.com.';

/**
 * Route guard for anything that starts a purchase (Checkout, the billing
 * portal, auto-recharge). The app hides these screens; this keeps an old
 * build or a deep link from reaching them either.
 */
export function rejectPurchasesInAppShell(req: Request, _res: Response, next: NextFunction): void {
  if (isAppShellRequest(req)) {
    next(new HttpError(403, APP_SHELL_BILLING_MESSAGE, 'not_available_in_app'));
    return;
  }
  next();
}
