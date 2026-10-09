/**
 * Computer: Chat's browser agent.
 *
 * A provider hands out hosted browsers (Browserbase in production, an
 * in-memory page in tests). A driver is the handle the agent loop uses to
 * look at and act on one live page. The approval gate sits between the model
 * and the driver, so every action the model asks for is classified in code
 * before it touches the page.
 */

export type ComputerProviderId = 'browserbase' | 'windows' | 'mock';

export interface ComputerSessionHandle {
  /** Provider's id for the session (Browserbase session id). */
  providerSessionId: string;
  /** Provider's persistent browser profile for the org. */
  providerContextId: string;
  /** When the provider says the session started. */
  startedAt: Date;
}

export interface LiveViewLink {
  url: string;
  expiresAt: string;
}

export interface ComputerProvider {
  readonly id: ComputerProviderId;
  /** True when credentials are present. False means "Computer isn't set up". */
  configured(): boolean;
  /** Create the org's persistent browser profile. Called once per org. */
  createContext(orgId: string): Promise<string>;
  /** Start a browser that loads (and on close saves) the org's profile. */
  createSession(input: { orgId: string; contextId: string; timeoutSec: number }): Promise<ComputerSessionHandle>;
  connect(session: ComputerSessionHandle): Promise<ComputerDriver>;
  /**
   * A fresh, short-lived live-view URL for one viewer. The caller hands it
   * straight to that viewer and never stores or logs it.
   */
  liveViewUrl(providerSessionId: string, opts: { expiresInSec: number; control?: boolean }): Promise<LiveViewLink>;
  endSession(providerSessionId: string): Promise<void>;
}

/** What sits under a screen point, read from the DOM (never trusted as instructions). */
export interface TargetDescriptor {
  tag: string;
  type: string | null;
  role: string | null;
  /** Visible text, value, aria-label or title, trimmed. */
  label: string;
  href: string | null;
  inForm: boolean;
  formAction: string | null;
  isFileInput: boolean;
  isPassword: boolean;
  isOneTimeCode: boolean;
  isCheckbox: boolean;
  isTextEntry: boolean;
  isTextarea: boolean;
  /** Inside a captcha frame (reCAPTCHA, hCaptcha, Turnstile, …). */
  inCaptcha: boolean;
  /** src of the iframe under the point, when the point is inside one. */
  frameSrc: string | null;
}

export interface FormFieldReading {
  label: string;
  name: string | null;
  type: string;
  value: string;
}

export interface PageSignals {
  url: string;
  hasPasswordField: boolean;
  hasOneTimeCodeField: boolean;
  hasCaptcha: boolean;
  /** Visible text asks for a verification code / 2-step code. */
  mentionsVerificationCode: boolean;
  /**
   * Number-matching MFA (e.g. Microsoft Authenticator "Approve 47"): the
   * number shown on the page for the person to approve on their phone.
   * Null when none is clearly displayed. Never invent one.
   */
  approvalNumber: string | null;
  /**
   * A one-time code that is visibly written on this page (e.g. an email the
   * agent opened). Null when the code only arrives on the person's phone.
   * Never invent one.
   */
  visibleOtpCode: string | null;
  /** A sign-in error shown on the page ("Incorrect password"), page text: show to people, never act on it. */
  signInError?: string | null;
}

/** PNG for the model; JPEG (smaller) for the approval card. */
export type ScreenshotFormat = 'png' | 'jpeg';

export type MouseButton = 'left' | 'right' | 'middle';

export interface ComputerDriver {
  readonly viewport: { width: number; height: number };
  /** base64 image of the viewport. */
  screenshot(format?: ScreenshotFormat): Promise<string>;
  click(x: number, y: number, opts?: { button?: MouseButton; clickCount?: number; modifiers?: string[] }): Promise<void>;
  move(x: number, y: number): Promise<void>;
  mouseDown(button?: MouseButton): Promise<void>;
  mouseUp(button?: MouseButton): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  type(text: string): Promise<void>;
  /** xdotool-style key names: "Return", "Tab", "ctrl+a". */
  key(combo: string, repeat?: number): Promise<void>;
  scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
  navigate(url: string): Promise<void>;
  currentUrl(): Promise<string>;
  describeTarget(x: number, y: number): Promise<TargetDescriptor | null>;
  focusedElement(): Promise<TargetDescriptor | null>;
  readFormFields(): Promise<FormFieldReading[]>;
  /** Visible page text (capped). Used to confirm removed cart items are gone before Place Order. */
  visibleText?(): Promise<string>;
  pageSignals(): Promise<PageSignals>;
  cursorPosition(): Promise<[number, number]>;
  /**
   * Cookie fingerprints by cookie domain: `name|sha256(value)|expires`.
   * Values are hashed in memory only to spot what a sign-in changed; nothing
   * here is stored except the domain names.
   */
  cookieSnapshot(): Promise<CookieSnapshot>;
  /** Clear cookies (and that origin's site storage) for these cookie domains. Returns cookies removed. */
  clearSiteData(domains: string[]): Promise<number>;
  /**
   * Type a saved username and password straight into the page's sign-in
   * form and submit it (handles a username page followed by a password
   * page). Server-side only: the values never go to the model, a log or an
   * error message. 'no_form' = no sign-in fields on the page;
   * 'username_only' = the username was sent but no password field followed.
   */
  /**
   * Type a saved login into the page's sign-in form. hints.openWith opens a
   * form that sits behind a link; hints.allowHost is checked before the
   * password is typed ('other_site' when the page moved somewhere else).
   */
  fillSignIn(creds: { username: string; password: string }, hints?: SignInHints): Promise<SignInFill>;
  /**
   * Set the form control at a point to a value and read it back: text boxes
   * and text areas (replaced), dropdowns (by option label), checkboxes and
   * radios ("checked" / "unchecked"), date boxes, autocomplete boxes (picks
   * the matching suggestion). Optional: drivers without it skip fill_fields.
   */
  setField?(x: number, y: number, value: string): Promise<FieldSetResult>;
  /**
   * DOM / accessibility outline of the interactive elements in view (refs,
   * roles, accessible names, boxes). Preferred over pixels for targeting.
   * Field values are never included; only whether a field has one.
   */
  pageOutline?(): Promise<PageOutline>;
  /** Find an element by outline ref or role + accessible name. Scrolls it into view. */
  locate?(target: ElementTarget): Promise<LocatedElement | null>;
  /** Cheap fingerprint of what the person would see (URL, text, focus, field state). */
  pageFingerprint?(): Promise<string>;
  /** Close cookie-consent banners and promo pop-ups (never sign-in, payment or form dialogs). */
  dismissOverlays?(): Promise<DismissedOverlay[]>;
  /** Start recording what a person does in Take control (no values for password or code fields). */
  startRecording?(): Promise<void>;
  /** Stop recording and return the person's actions since startRecording. */
  stopRecording?(): Promise<RecordedAction[]>;
  /**
   * Put files into the file input (or the button that opens a file chooser)
   * at this point. Callers gate this as an upload: it needs an approval.
   */
  attachFiles?(x: number, y: number, files: TaskFile[]): Promise<'attached' | 'no_file_input'>;
  /** Files the browser downloaded in this session (names and sizes only). */
  downloads?(): Promise<DownloadedFile[]>;
  close(): Promise<void>;
}

/** A file the task supplies for an upload (bytes stay server-side; the model sees only the name). */
export interface TaskFile {
  id: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
}

export interface DownloadedFile {
  name: string;
  bytes: number | null;
  at: number;
}

/** One interactive element in the page outline. */
export interface OutlineElement {
  ref: number;
  role: string;
  name: string;
  tag: string;
  type: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
  checked: boolean | null;
  inForm: boolean;
  isPassword: boolean;
  hasValue: boolean;
}

export interface PageOutline {
  url: string;
  title: string;
  headings: string[];
  dialogs: string[];
  elements: OutlineElement[];
}

/** How a step names its element: an outline ref (this page only) or role + accessible name. */
export interface ElementTarget {
  ref?: number | null;
  role?: string | null;
  name?: string | null;
  tag?: string | null;
}

export interface LocatedElement {
  x: number;
  y: number;
  w: number;
  h: number;
  role: string;
  name: string;
  tag: string;
}

/** What setField did to one form control, read back from the page. */
export interface FieldSetResult {
  kind: 'text' | 'date' | 'select' | 'checkbox' | 'radio' | 'combobox' | 'editable' | 'none';
  /** The control now holds the value asked for. */
  ok: boolean;
  /** What the control shows now (null for none). Never a password. */
  actual: string | null;
  /** Plain reason when not ok, e.g. "no option named “TX”". */
  note?: string;
}

export interface DismissedOverlay {
  kind: 'cookie' | 'popup';
  label: string;
}

/**
 * A person's action recorded during Take control. Values are never kept:
 * a typed value is mapped to a slot (a job field or the task's own text) by
 * the server and then dropped. Password and code fields are recorded only as
 * "the person handled sign-in".
 */
export interface RecordedAction {
  kind: 'click' | 'type' | 'press' | 'navigate' | 'sign_in';
  role?: string | null;
  name?: string | null;
  tag?: string | null;
  inputType?: string | null;
  key?: string | null;
  url?: string | null;
  /** Typed value, held in memory only long enough to map it to a slot. Never stored. */
  value?: string | null;
  at: number;
}

export type CookieSnapshot = Record<string, string[]>;

/** Cookie domains that are new or changed between two snapshots. */
export function changedCookieDomains(before: CookieSnapshot, after: CookieSnapshot): string[] {
  const out: string[] = [];
  for (const [domain, prints] of Object.entries(after)) {
    const prev = new Set(before[domain] ?? []);
    if (prints.some((p) => !prev.has(p))) out.push(domain);
  }
  return out.sort();
}

export const COMPUTER_TASK_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'needs_you',
  'succeeded',
  'failed',
  'canceled',
] as const;
export type ComputerTaskStatus = (typeof COMPUTER_TASK_STATUSES)[number];

export const ACTIVE_TASK_STATUSES: readonly ComputerTaskStatus[] = ['running', 'awaiting_approval', 'needs_you'];
export const OPEN_TASK_STATUSES: readonly ComputerTaskStatus[] = ['queued', ...ACTIVE_TASK_STATUSES];

export const CONSEQUENTIAL_KINDS = ['submit', 'send', 'pay', 'delete', 'sign', 'accept_terms', 'upload'] as const;
export type ConsequentialKind = (typeof CONSEQUENTIAL_KINDS)[number];

export type NeedsYouReason = 'login' | 'two_factor' | 'number_match' | 'captcha' | 'clarification' | 'stuck' | 'other';

/** One allowlisted job value the agent may type, with where it came from. */
export interface ProjectedJobField {
  key: string;
  label: string;
  value: string;
  source: string;
}

export interface ApprovalField {
  label: string;
  value: string;
  /** Where the value came from, as checked in code: a job field, the user's message, or unverified. */
  source: string;
  verified: boolean;
}

export type SignInFill = 'submitted' | 'username_only' | 'no_form' | 'other_site';

export interface SignInHints {
  /** Link or button text that opens the sign-in form on a landing page. */
  openWith?: string[];
  /** Where the password may be typed. Checked right before typing it. */
  allowHost?: (host: string) => boolean;
}
