import { config } from '../../config.js';
import { MockXactimateDriver } from './mockDriver.js';
import { XactimateApiDriver } from './apiDriver.js';
import { XactimateWebDriver } from './webDriver.js';
import { DriverError, type DriverKind, type XactimateDriver, type XactimateSession } from './driver.js';
import { ConsentError, isLive, type ConsentGrant } from './consent.js';
import { sessionCredentials } from './credentials.js';

export * from './consent.js';
export * from './driver.js';
export {
  isVaultConfigured,
  sealCredential,
  openCredential,
  sessionCredentials,
  redact,
  type SealedCredential,
} from './credentials.js';

/**
 * Driver selection and live-session custody.
 *
 * Which driver runs is a deployment decision (`XACTIMATE_DRIVER`), not a
 * per-request one — a caller must not be able to talk the server into launching
 * a browser by passing a parameter.
 */
export function createDriver(kind: DriverKind = config.xactimate.driver): XactimateDriver {
  switch (kind) {
    case 'api':
      return new XactimateApiDriver();
    case 'web':
      return new XactimateWebDriver();
    case 'mock':
      return new MockXactimateDriver();
    default:
      throw new DriverError(`Unknown Xactimate driver "${kind}".`, 'unknown_driver');
  }
}

/**
 * Holds open Xactimate sessions, in memory, per user.
 *
 * In memory and never persisted, for the same reason `credentials.ts` prefers
 * session-only storage: a session that survives a process restart is a session
 * somebody wrote down. A browser session also owns an actual OS process, so it
 * is closed on expiry rather than left to leak.
 */
class ConnectionManager {
  readonly #sessions = new Map<
    string,
    { session: XactimateSession; driver: XactimateDriver; timer: NodeJS.Timeout }
  >();

  put(userId: string, session: XactimateSession, driver: XactimateDriver): void {
    this.close(userId);

    const ttl = Math.max(60_000, Date.parse(session.expiresAt) - Date.now());
    const timer = setTimeout(() => void this.close(userId), ttl);
    timer.unref?.();

    this.#sessions.set(userId, { session, driver, timer });
  }

  get(userId: string): { session: XactimateSession; driver: XactimateDriver } | null {
    const entry = this.#sessions.get(userId);
    if (!entry) return null;
    if (Date.parse(entry.session.expiresAt) <= Date.now()) {
      void this.close(userId);
      return null;
    }
    return { session: entry.session, driver: entry.driver };
  }

  async close(userId: string): Promise<void> {
    const entry = this.#sessions.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.#sessions.delete(userId);
    await entry.driver.disconnect(entry.session).catch(() => undefined);
  }

  /** Revocation must take effect now, not at the next expiry. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((userId) => this.close(userId)));
    sessionCredentials.clear();
  }
}

export const connections = new ConnectionManager();

/**
 * Resolve the live session for a user, or explain what is missing.
 *
 * Called at the top of every route that touches the account, so an expired grant
 * and an expired session produce distinct, actionable messages rather than a
 * generic 401.
 */
export function requireConnection(
  userId: string,
  grant: ConsentGrant | null,
): { session: XactimateSession; driver: XactimateDriver } {
  if (!isLive(grant)) {
    throw new ConsentError(
      'Xactimate is not connected, or your authorisation has expired. Connect the account to continue.',
      'not_connected',
    );
  }

  const connection = connections.get(userId);
  if (!connection) {
    throw new ConsentError(
      'Your Xactimate session has ended. Sign in again to continue — this is expected, sessions are deliberately short-lived.',
      'session_expired',
    );
  }

  return connection;
}
