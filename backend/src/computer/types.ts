/**
 * Computer: Chat's browser agent.
 *
 * A provider hands out hosted browsers (Browserbase in production, an
 * in-memory page in tests). A driver is the handle the agent loop uses to
 * look at and act on one live page. The approval gate sits between the model
 * and the driver, so every action the model asks for is classified in code
 * before it touches the page.
 */

export type ComputerProviderId = 'browserbase' | 'mock';

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
  liveViewUrl(providerSessionId: string, opts: { expiresInSec: number }): Promise<LiveViewLink>;
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
  pageSignals(): Promise<PageSignals>;
  cursorPosition(): Promise<[number, number]>;
  close(): Promise<void>;
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

export type NeedsYouReason = 'login' | 'two_factor' | 'captcha' | 'other';

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
