/**
 * In-memory provider for tests and local demos. It fakes one website with a
 * claim form (and optional sign-in, 2FA and captcha pages) laid out at fixed
 * coordinates, so a scripted model can click and type exactly like it would
 * on a real page and the approval gate sees real-looking targets.
 */
import { randomBytes } from 'node:crypto';
import type {
  ComputerDriver,
  ComputerProvider,
  ComputerSessionHandle,
  DismissedOverlay,
  DownloadedFile,
  ElementTarget,
  FormFieldReading,
  LocatedElement,
  LiveViewLink,
  MouseButton,
  PageOutline,
  PageSignals,
  RecordedAction,
  ScreenshotFormat,
  TargetDescriptor,
  TaskFile,
  SignInFill,
  SignInHints,
} from '../types.js';

// 1×1 PNG / JPEG. The model in tests never looks at pixels.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

export type MockPageId = 'login' | 'two_factor' | 'number_match' | 'form' | 'done';

interface MockElement {
  id: string;
  rect: [number, number, number, number]; // x, y, w, h
  tag: string;
  type: string | null;
  label: string;
  field?: boolean;
  textarea?: boolean;
  checkbox?: boolean;
  file?: boolean;
  password?: boolean;
  otp?: boolean;
  captcha?: boolean;
  /** What a click does. */
  action?: 'submit' | 'save_draft' | 'sign_in' | 'verify' | 'upload' | 'dismiss_banner';
}

const PAGES: Record<MockPageId, { url: string; elements: MockElement[]; text: string }> = {
  login: {
    url: 'https://portal.example-carrier.test/login',
    text: 'Sign in to the carrier portal',
    elements: [
      { id: 'email', rect: [300, 200, 400, 40], tag: 'input', type: 'email', label: 'Email', field: true },
      { id: 'password', rect: [300, 260, 400, 40], tag: 'input', type: 'password', label: 'Password', field: true, password: true },
      { id: 'signin', rect: [300, 320, 200, 44], tag: 'button', type: 'submit', label: 'Sign in', action: 'sign_in' },
    ],
  },
  two_factor: {
    url: 'https://portal.example-carrier.test/verify',
    text: 'Enter the verification code we sent to your phone',
    elements: [
      { id: 'code', rect: [300, 220, 300, 40], tag: 'input', type: 'text', label: 'Verification code', field: true, otp: true },
      { id: 'verify', rect: [300, 280, 160, 44], tag: 'button', type: 'submit', label: 'Verify', action: 'verify' },
    ],
  },
  number_match: {
    url: 'https://portal.example-carrier.test/approve',
    text: 'Approve sign in. Open your authenticator app and approve 47 when asked. Are you trying to sign in?',
    elements: [
      { id: 'num', rect: [300, 220, 120, 80], tag: 'h1', type: null, label: '47' },
    ],
  },
  form: {
    url: 'https://portal.example-carrier.test/claims/new',
    text: 'New claim. Fill out every field, then submit.',
    elements: [
      { id: 'insured', rect: [300, 180, 500, 40], tag: 'input', type: 'text', label: 'Insured name', field: true },
      { id: 'claim', rect: [300, 240, 500, 40], tag: 'input', type: 'text', label: 'Claim number', field: true },
      { id: 'address', rect: [300, 300, 500, 40], tag: 'input', type: 'text', label: 'Property address', field: true },
      { id: 'notes', rect: [300, 360, 500, 80], tag: 'textarea', type: null, label: 'Notes', field: true, textarea: true },
      { id: 'photos', rect: [300, 460, 240, 40], tag: 'input', type: 'file', label: 'Attach photos', file: true, action: 'upload' },
      { id: 'terms', rect: [300, 520, 24, 24], tag: 'input', type: 'checkbox', label: 'I agree to the terms of service', checkbox: true },
      { id: 'draft', rect: [300, 580, 160, 44], tag: 'button', type: 'button', label: 'Save draft', action: 'save_draft' },
      { id: 'submit', rect: [500, 580, 200, 44], tag: 'button', type: 'submit', label: 'Submit claim', action: 'submit' },
    ],
  },
  done: {
    url: 'https://portal.example-carrier.test/claims/123/confirmation',
    text: 'Claim submitted. Confirmation #123.',
    elements: [],
  },
};

/** Shared state for one fake website, so a test can inspect what happened. */
export class MockSite {
  page: MockPageId;
  values: Record<string, string> = {};
  checked: Record<string, boolean> = {};
  focused: string | null = null;
  submitted = false;
  draftSaved = 0;
  uploads = 0;
  /** Names of files attached through attachFiles (bytes are not kept). */
  attached: string[] = [];
  /** Files the scripted page "downloaded". */
  downloaded: DownloadedFile[] = [];
  captcha: boolean;
  readonly actions: string[] = [];
  /** The org profile's cookies: domain → fingerprints. Survives sessions, like a persistent context. */
  cookies: Record<string, string[]> = {};
  /**
   * The site's real account, when a test wants Sign in to check it: a wrong
   * password stays on the sign-in page; twoFactor sends a right one to the
   * code page. Without it, Sign in always goes to the code page.
   */
  account: { username: string; password: string; twoFactor?: boolean; numberMatch?: boolean } | null;
  /** Sign-ins the site saw (password redacted to its length). */
  readonly signInAttempts: Array<{ username: string; passwordLength: number; ok: boolean }> = [];
  /** Shown after a rejected sign-in, as real sites do. */
  signInError: string | null = null;

  /** A cookie-consent banner covering the page until dismissed. */
  cookieBanner: boolean;
  /**
   * The sign-in form sits behind a link on a landing page (open it with
   * fillSignIn hints.openWith). leadsTo is the host the link opens.
   */
  signInBehind: { link: string; leadsTo?: string; opened: boolean } | null;
  /** The host of the last navigate() (the scripted pages keep their own URLs). */
  navigatedHost: string | null = null;
  /** Set while a Take control session is being recorded. */
  recording: RecordedAction[] | null = null;

  constructor(
    opts: { start?: MockPageId; captcha?: boolean; account?: MockSite['account']; cookieBanner?: boolean; signInBehind?: { link: string; leadsTo?: string } } = {},
  ) {
    this.page = opts.start ?? 'form';
    this.signInBehind = opts.signInBehind ? { ...opts.signInBehind, opened: false } : null;
    this.captcha = Boolean(opts.captcha);
    this.account = opts.account ?? null;
    this.cookieBanner = Boolean(opts.cookieBanner);
  }

  /** What a person would notice changing. */
  fingerprint(): string {
    return JSON.stringify([this.page, this.values, this.checked, this.focused, this.submitted, this.draftSaved, this.uploads, this.cookieBanner, this.attached.length, this.downloaded.length]);
  }

  /**
   * A person acting in the live view (Take control). Applies the action to the
   * page and, when recording, reports it the way the in-page recorder would.
   */
  personDoes(action: { click?: string; type?: { id: string; value: string }; press?: 'Enter' }) {
    const els = this.elements();
    if (action.click) {
      const el = els.find((e) => e.id === action.click);
      if (!el) throw new Error(`no element ${action.click} on ${this.page}`);
      if (this.recording && !el.field) this.recording.push({ kind: 'click', role: el.tag === 'button' ? 'button' : el.checkbox ? 'checkbox' : 'generic', name: el.label, tag: el.tag, at: Date.now() });
      this.activate(el);
    }
    if (action.type) {
      const el = els.find((e) => e.id === action.type!.id);
      if (!el) throw new Error(`no field ${action.type.id}`);
      this.focused = el.id;
      this.values[el.id] = action.type.value;
      if (this.recording) {
        if (el.password || el.otp) this.recording.push({ kind: 'sign_in', at: Date.now() });
        else this.recording.push({ kind: 'type', role: 'textbox', name: el.label, tag: el.tag, inputType: el.type, value: action.type.value, at: Date.now() });
      }
    }
    if (action.press) {
      if (this.recording) this.recording.push({ kind: 'press', key: 'Enter', at: Date.now() });
      this.pressEnter();
    }
  }

  get url() {
    return PAGES[this.page].url;
  }

  /** A person finished 2FA / sign-in in the live view. */
  completeHumanStep() {
    this.page = 'form';
    this.captcha = false;
    this.focused = null;
  }

  elements(): MockElement[] {
    const els = [...PAGES[this.page].elements];
    if (this.captcha) {
      els.push({ id: 'captcha', rect: [300, 640, 300, 78], tag: 'iframe', type: null, label: 'reCAPTCHA', captcha: true });
    }
    if (this.cookieBanner) {
      // The banner sits on top: the first element hit-testing finds.
      els.unshift({ id: 'cookie_reject', rect: [0, 700, 1280, 100], tag: 'button', type: 'button', label: 'Reject all', action: 'dismiss_banner' });
    }
    return els;
  }

  at(x: number, y: number): MockElement | null {
    return (
      this.elements().find(
        (e) => x >= e.rect[0] && x <= e.rect[0] + e.rect[2] && y >= e.rect[1] && y <= e.rect[1] + e.rect[3],
      ) ?? null
    );
  }

  descriptor(el: MockElement): TargetDescriptor {
    return {
      tag: el.tag,
      type: el.type,
      role: null,
      label: el.label,
      href: null,
      inForm: this.page !== 'done' && el.tag !== 'iframe',
      formAction: this.page === 'form' ? `${this.url}/submit` : null,
      isFileInput: Boolean(el.file),
      isPassword: Boolean(el.password),
      isOneTimeCode: Boolean(el.otp),
      isCheckbox: Boolean(el.checkbox),
      isTextEntry: Boolean(el.field),
      isTextarea: Boolean(el.textarea),
      inCaptcha: Boolean(el.captcha),
      frameSrc: el.captcha ? 'https://www.google.com/recaptcha/api2/anchor' : null,
    };
  }

  activate(el: MockElement) {
    if (el.field) {
      this.focused = el.id;
      return;
    }
    if (el.checkbox) {
      this.checked[el.id] = !this.checked[el.id];
      return;
    }
    switch (el.action) {
      case 'submit':
        this.submitted = true;
        this.page = 'done';
        this.focused = null;
        break;
      case 'save_draft':
        this.draftSaved += 1;
        break;
      case 'upload':
        this.uploads += 1;
        break;
      case 'dismiss_banner':
        this.cookieBanner = false;
        break;
      case 'sign_in': {
        this.focused = null;
        if (!this.account) {
          this.page = 'two_factor';
          break;
        }
        const ok = this.values.email === this.account.username && this.values.password === this.account.password;
        this.signInAttempts.push({ username: this.values.email ?? '', passwordLength: (this.values.password ?? '').length, ok });
        this.signInError = ok ? null : 'Incorrect username or password.';
        if (ok) this.page = this.account.numberMatch ? 'number_match' : this.account.twoFactor ? 'two_factor' : 'form';
        break;
      }
      case 'verify':
        this.page = 'form';
        this.focused = null;
        break;
      default:
        break;
    }
  }

  pressEnter() {
    const el = this.elements().find((e) => e.id === this.focused);
    if (!el || el.textarea) {
      if (el?.textarea) this.values[el.id] = `${this.values[el.id] ?? ''}\n`;
      return;
    }
    const submit = this.elements().find((e) => e.type === 'submit');
    if (submit) this.activate(submit);
  }
}

export class MockDriver implements ComputerDriver {
  readonly viewport = { width: 1280, height: 800 };
  private cursor: [number, number] = [0, 0];
  closed = false;

  constructor(readonly site: MockSite) {}

  async screenshot(format: ScreenshotFormat = 'png') {
    this.site.actions.push('screenshot');
    return format === 'jpeg' ? JPEG_1PX : PNG_1PX;
  }

  async click(x: number, y: number, opts?: { button?: MouseButton; clickCount?: number }) {
    this.cursor = [x, y];
    const el = this.site.at(x, y);
    this.site.actions.push(`click:${el?.id ?? 'none'}`);
    if (el && (opts?.button ?? 'left') === 'left') this.site.activate(el);
  }

  async move(x: number, y: number) {
    this.cursor = [x, y];
  }

  async mouseDown() {}

  async mouseUp() {
    const el = this.site.at(this.cursor[0], this.cursor[1]);
    if (el) this.site.activate(el);
  }

  async drag(_from: [number, number], to: [number, number]) {
    this.cursor = to;
  }

  async type(text: string) {
    const id = this.site.focused;
    this.site.actions.push(`type:${id ?? 'none'}`);
    if (!id) return;
    const parts = text.split('\n');
    this.site.values[id] = `${this.site.values[id] ?? ''}${parts[0]}`;
    if (parts.length > 1) this.site.pressEnter();
  }

  async key(combo: string, repeat = 1) {
    this.site.actions.push(`key:${combo}`);
    for (let i = 0; i < repeat; i += 1) {
      const k = combo.toLowerCase();
      if (k === 'return' || k === 'enter' || k === 'kp_enter') this.site.pressEnter();
      if (k === 'ctrl+a' && this.site.focused) this.site.values[this.site.focused] = this.site.values[this.site.focused] ?? '';
      if (k === 'backspace' && this.site.focused) this.site.values[this.site.focused] = '';
    }
  }

  async scroll() {}

  async navigate(url: string) {
    this.site.actions.push(`navigate:${url}`);
    try {
      // The scripted pages keep their own URLs; remember which host the browser was sent to.
      this.site.navigatedHost = new URL(url).host;
    } catch {
      /* not a URL */
    }
  }

  async currentUrl() {
    return this.site.url;
  }

  async describeTarget(x: number, y: number) {
    const el = this.site.at(x, y);
    return el ? this.site.descriptor(el) : null;
  }

  async focusedElement() {
    const el = this.site.elements().find((e) => e.id === this.site.focused);
    return el ? this.site.descriptor(el) : null;
  }

  async readFormFields(): Promise<FormFieldReading[]> {
    return this.site
      .elements()
      .filter((e) => e.field && this.site.values[e.id])
      .map((e) => ({
        label: e.label,
        name: e.id,
        type: e.password ? 'password' : e.type ?? 'text',
        value: e.password ? '••••••' : this.site.values[e.id],
      }));
  }

  /** Tests set this to simulate a checkout page's text. */
  pageText: string | null = null;

  async visibleText(): Promise<string> {
    return this.pageText ?? PAGES[this.site.page]?.text ?? '';
  }

  async pageSignals(): Promise<PageSignals> {
    const els = this.site.elements();
    const numberMatch = this.site.page === 'number_match';
    const text = PAGES[this.site.page]?.text ?? '';
    const approval = numberMatch ? (text.match(/\b(\d{2,3})\b/)?.[1] ?? '47') : null;
    return {
      url: this.site.url,
      hasPasswordField: els.some((e) => e.password),
      hasOneTimeCodeField: els.some((e) => e.otp),
      hasCaptcha: this.site.captcha,
      mentionsVerificationCode: this.site.page === 'two_factor',
      approvalNumber: approval,
      visibleOtpCode: null,
      signInError: this.site.signInError,
    };
  }

  async cursorPosition(): Promise<[number, number]> {
    return this.cursor;
  }

  async cookieSnapshot() {
    return Object.fromEntries(Object.entries(this.site.cookies).map(([d, v]) => [d, [...v]]));
  }

  async clearSiteData(domains: string[]) {
    let n = 0;
    for (const d of domains) {
      n += this.site.cookies[d]?.length ?? 0;
      delete this.site.cookies[d];
    }
    this.site.actions.push(`clear:${domains.join(',')}`);
    return n;
  }

  async fillSignIn(creds: { username: string; password: string }, hints?: SignInHints): Promise<SignInFill> {
    if (this.site.page !== 'login') return 'no_form';
    const behind = this.site.signInBehind;
    if (behind && !behind.opened) {
      if (!hints?.openWith?.some((t) => t.toLowerCase() === behind.link.toLowerCase())) return 'no_form';
      behind.opened = true;
      this.site.actions.push(`open_sign_in:${behind.link}`);
    }
    const host = behind?.leadsTo ?? this.site.navigatedHost ?? new URL(this.site.url).host;
    if (hints?.allowHost && !hints.allowHost(host)) return 'other_site';
    this.site.actions.push('fill_sign_in');
    this.site.values.email = creds.username;
    this.site.values.password = creds.password;
    const button = this.site.elements().find((e) => e.action === 'sign_in');
    if (button) this.site.activate(button);
    return 'submitted';
  }

  async pageOutline(): Promise<PageOutline> {
    const els = this.site.elements();
    return {
      url: this.site.url,
      title: PAGES[this.site.page]?.text ?? '',
      headings: [PAGES[this.site.page]?.text ?? ''],
      dialogs: this.site.cookieBanner ? ['We use cookies'] : [],
      elements: els.map((e, ref) => ({
        ref,
        role: e.tag === 'button' ? 'button' : e.checkbox ? 'checkbox' : e.field ? 'textbox' : 'generic',
        name: e.label,
        tag: e.tag,
        type: e.type,
        x: e.rect[0] + Math.round(e.rect[2] / 2),
        y: e.rect[1] + Math.round(e.rect[3] / 2),
        w: e.rect[2],
        h: e.rect[3],
        disabled: false,
        checked: e.checkbox ? Boolean(this.site.checked[e.id]) : null,
        inForm: this.site.page !== 'done',
        isPassword: Boolean(e.password),
        hasValue: Boolean(this.site.values[e.id]),
      })),
    };
  }

  async locate(target: ElementTarget): Promise<LocatedElement | null> {
    const outline = await this.pageOutline();
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hit =
      (typeof target.ref === 'number' ? outline.elements[target.ref] : undefined) ??
      outline.elements.find((e) => norm(e.name) === norm(target.name) && (!target.role || e.role === target.role)) ??
      outline.elements.find((e) => norm(target.name).length >= 4 && norm(e.name).includes(norm(target.name)));
    return hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h, role: hit.role, name: hit.name, tag: hit.tag } : null;
  }

  async pageFingerprint(): Promise<string> {
    return this.site.fingerprint();
  }

  async dismissOverlays(): Promise<DismissedOverlay[]> {
    if (!this.site.cookieBanner) return [];
    this.site.cookieBanner = false;
    this.site.actions.push('dismiss:cookie');
    return [{ kind: 'cookie', label: 'Reject all' }];
  }

  async startRecording(): Promise<void> {
    this.site.recording = [];
  }

  async stopRecording(): Promise<RecordedAction[]> {
    const got = this.site.recording ?? [];
    this.site.recording = null;
    return got;
  }

  async attachFiles(x: number, y: number, files: TaskFile[]): Promise<'attached' | 'no_file_input'> {
    const el = this.site.at(x, y);
    if (!el?.file) return 'no_file_input';
    this.site.attached.push(...files.map((f) => f.name));
    this.site.actions.push(`attach:${files.map((f) => f.name).join(',')}`);
    return 'attached';
  }

  async downloads(): Promise<DownloadedFile[]> {
    return this.site.downloaded.map((d) => ({ ...d }));
  }

  async close() {
    this.closed = true;
  }
}

export class MockComputerProvider implements ComputerProvider {
  readonly id = 'mock' as const;
  contexts = 0;
  readonly sessions: string[] = [];
  readonly ended: string[] = [];
  readonly liveLinks: Array<{ sessionId: string; expiresInSec: number }> = [];
  site: MockSite;

  constructor(opts: { configured?: boolean; site?: MockSite } = {}) {
    this.isConfigured = opts.configured ?? true;
    this.site = opts.site ?? new MockSite();
  }

  private isConfigured: boolean;

  configured() {
    return this.isConfigured;
  }

  async createContext() {
    this.contexts += 1;
    return `mock-ctx-${this.contexts}`;
  }

  async createSession(input: { contextId: string }): Promise<ComputerSessionHandle> {
    const id = `mock-session-${this.sessions.length + 1}`;
    this.sessions.push(id);
    return { providerSessionId: id, providerContextId: input.contextId, startedAt: new Date() };
  }

  async connect(): Promise<ComputerDriver> {
    return new MockDriver(this.site);
  }

  async liveViewUrl(sessionId: string, opts: { expiresInSec: number }): Promise<LiveViewLink> {
    this.liveLinks.push({ sessionId, expiresInSec: opts.expiresInSec });
    return {
      url: `https://live.mock.invalid/${encodeURIComponent(sessionId)}?t=${randomBytes(8).toString('hex')}`,
      expiresAt: new Date(Date.now() + opts.expiresInSec * 1000).toISOString(),
    };
  }

  async endSession(sessionId: string) {
    this.ended.push(sessionId);
  }
}
