/**
 * The join link: the org's join code, in URL form.
 *
 * The invite section hands the code out three ways — read aloud, emailed, and
 * now as a QR code on the screen. All three land in the same place: signup,
 * join mode, code filled in. The link deliberately carries nothing personal.
 * It is the same code every member can already read in settings, so a
 * forwarded link or a photographed QR poster leaks exactly what a whiteboard
 * with the code written on it would.
 *
 * Payment never rides in this link. Billing belongs to the organization —
 * whoever joins through this code lands under the company's existing
 * subscription, which is why the joiner is never asked for a card.
 */

/** Mirrors the signup form's validation and the server's format gate. */
export const JOIN_CODE_RE = /^[A-Za-z0-9]{6,12}$/;

/**
 * The canonical form of a join code, or null when the input could never be
 * one. Codes are minted uppercase; links and typed input are forgiven case
 * and stray whitespace.
 */
export function normalizeJoinCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return JOIN_CODE_RE.test(code) ? code : null;
}

/** The in-app path a scanned QR code or emailed link opens. */
export function joinSignupPath(code: string): string {
  return `/signup?join=${encodeURIComponent(code)}`;
}

/**
 * The absolute URL that goes inside the QR code. `origin` is the frontend's
 * own origin (`window.location.origin`) — the QR is rendered by the same app
 * the phone will open, so there is no configured base URL to drift from.
 */
export function joinSignupUrl(origin: string, code: string): string {
  return origin.replace(/\/+$/, '') + joinSignupPath(code);
}
