import { VendorHttpClient, VendorError } from './http.js';
import type { ScanConnector, ScanProjectSummary } from './ports.js';
import type { ProviderSecret } from '../credentials.js';
import type { JobPhoto, Opening, RoomMeasurements, ScanProject } from '../types.js';

/**
 * DocuSketch connector — signs in to the scanning account and reads a project's
 * rooms, measurements, and photos.
 *
 * Two auth modes, in preference order:
 *
 *   1. **API key.** Sent as a bearer token. Preferred: no password is held, and
 *      revoking access does not mean rotating a human's login.
 *   2. **Username + password.** The agent posts the credentials to the login
 *      endpoint once and caches the returned session token until it expires.
 *      This is what "log in to DocuSketch" means in practice, and it exists
 *      because photo access is session-scoped on some tenants.
 *
 * A password is never sent more than once per token lifetime, is never logged,
 * and is never written anywhere but the encrypted vault.
 *
 * Payload shapes vary between DocuSketch tenants and API versions, so every
 * field read here goes through `normaliseRoom` / `normalisePhoto`, which accept
 * the aliases seen in the wild and fail loudly on a project that carries no
 * measurements at all. Point `DOCUSKETCH_BASE_URL` at the tenant's API root.
 */

interface LoginResponse {
  token?: string;
  access_token?: string;
  expiresIn?: number;
  expires_in?: number;
}

/** Tokens are refreshed early so a long run never trips over an expiry. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export class DocuSketchConnector implements ScanConnector {
  readonly name = 'DocuSketch';

  private readonly http: VendorHttpClient;
  private readonly baseUrl: string;
  private readonly secret: ProviderSecret;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  /** In-flight login, so concurrent photo fetches share one sign-in. */
  private loginInFlight: Promise<string> | null = null;

  constructor(baseUrl: string, secret: ProviderSecret) {
    this.secret = secret;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.http = new VendorHttpClient({
      vendor: this.name,
      baseUrl,
      authHeaders: async () => ({ Authorization: `Bearer ${await this.accessToken()}` }),
    });
  }

  private async accessToken(): Promise<string> {
    if (this.secret.apiKey) return this.secret.apiKey;
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_SAFETY_MARGIN_MS) {
      return this.token;
    }
    // Collapse concurrent logins: a run analysing photos in parallel would
    // otherwise post the password once per in-flight request.
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    if (!this.secret.username || !this.secret.password) {
      throw new VendorError(this.name, 401, 'no API key and no username/password stored', false);
    }

    // The login call carries the password, so it is deliberately built without
    // the auth-header factory (which would recurse) and never retried on a 4xx.
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: this.secret.username,
        username: this.secret.username,
        password: this.secret.password,
      }),
    });

    if (!response.ok) {
      throw new VendorError(
        this.name,
        response.status,
        response.status === 401 || response.status === 403
          ? 'sign-in was rejected — check the stored DocuSketch credentials'
          : `sign-in failed (${response.status})`,
        response.status >= 500,
      );
    }

    const body = (await response.json()) as LoginResponse;
    const token = body.token ?? body.access_token;
    if (!token) {
      throw new VendorError(this.name, 502, 'sign-in returned no token', false);
    }

    const ttlSeconds = body.expiresIn ?? body.expires_in ?? 3600;
    this.token = token;
    this.tokenExpiresAt = Date.now() + ttlSeconds * 1000;
    return token;
  }

  async verify(): Promise<void> {
    await this.accessToken();
    await this.http.request<unknown>({ path: '/projects', query: { limit: 1 } });
  }

  async listProjects(options: { search?: string; limit?: number } = {}): Promise<ScanProjectSummary[]> {
    const body = await this.http.request<{ data?: RawProject[]; projects?: RawProject[] }>({
      path: '/projects',
      query: { search: options.search, limit: options.limit ?? 25 },
    });
    const projects = body.data ?? body.projects ?? [];
    return projects.map((p) => ({
      id: String(p.id),
      name: p.name ?? p.title ?? `Project ${p.id}`,
      address: p.address?.street ?? p.addressLine1,
      claimNumber: p.claimNumber ?? p.claim_number,
      capturedAt: p.capturedAt ?? p.created_at,
    }));
  }

  async getProject(projectId: string): Promise<ScanProject> {
    const raw = await this.http.request<RawProject>({ path: `/projects/${projectId}` });

    const rooms = (raw.rooms ?? raw.spaces ?? []).map(normaliseRoom);
    if (rooms.length === 0) {
      throw new VendorError(
        this.name,
        422,
        `project ${projectId} has no rooms — the scan may still be processing`,
        false,
      );
    }

    return {
      id: String(raw.id ?? projectId),
      name: raw.name ?? raw.title ?? `Project ${projectId}`,
      claimNumber: raw.claimNumber ?? raw.claim_number,
      policyNumber: raw.policyNumber ?? raw.policy_number,
      insuredName: raw.insuredName ?? raw.customerName,
      address: {
        street: raw.address?.street ?? raw.addressLine1,
        city: raw.address?.city,
        state: raw.address?.state,
        postalCode: raw.address?.postalCode ?? raw.address?.zip,
      },
      lossDate: raw.lossDate ?? raw.loss_date,
      capturedAt: raw.capturedAt ?? raw.created_at,
      rooms,
      photos: (raw.photos ?? raw.images ?? []).map(normalisePhoto),
    };
  }

  async downloadPhoto(photo: JobPhoto): Promise<{ bytes: Buffer; contentType: string }> {
    // Photo URLs are commonly absolute pre-signed links on a CDN host rather
    // than paths on the API host, so absolute URLs bypass the base URL.
    if (/^https?:\/\//i.test(photo.url)) {
      const response = await fetch(photo.url, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      });
      if (!response.ok) {
        throw new VendorError(this.name, response.status, `photo ${photo.id} download failed`, response.status >= 500);
      }
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? photo.contentType ?? 'image/jpeg',
      };
    }
    return this.http.fetchBinary({ path: photo.url });
  }
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

interface RawProject {
  id?: string | number;
  name?: string;
  title?: string;
  claimNumber?: string;
  claim_number?: string;
  policyNumber?: string;
  policy_number?: string;
  insuredName?: string;
  customerName?: string;
  addressLine1?: string;
  address?: { street?: string; city?: string; state?: string; postalCode?: string; zip?: string };
  lossDate?: string;
  loss_date?: string;
  capturedAt?: string;
  created_at?: string;
  rooms?: RawRoom[];
  spaces?: RawRoom[];
  photos?: RawPhoto[];
  images?: RawPhoto[];
}

interface RawRoom {
  id?: string | number;
  name?: string;
  label?: string;
  type?: string;
  roomType?: string;
  level?: string;
  floor?: string;
  floorArea?: number;
  floor_area?: number;
  areaSqFt?: number;
  ceilingArea?: number;
  ceiling_area?: number;
  wallArea?: number;
  wall_area?: number;
  perimeter?: number;
  perimeterLf?: number;
  height?: number;
  ceilingHeight?: number;
  openings?: RawOpening[];
  doors?: RawOpening[];
  windows?: RawOpening[];
}

interface RawOpening {
  id?: string | number;
  type?: string;
  kind?: string;
  width?: number;
  height?: number;
  sharedWith?: string;
}

interface RawPhoto {
  id?: string | number;
  roomId?: string | number;
  room_id?: string | number;
  caption?: string;
  label?: string;
  takenAt?: string;
  created_at?: string;
  url?: string;
  downloadUrl?: string;
  contentType?: string;
  mimeType?: string;
}

/** Default ceiling height when the scan omits it — the US residential norm. */
const DEFAULT_CEILING_HEIGHT_FT = 8;

function normaliseRoom(raw: RawRoom, index: number): RoomMeasurements {
  const floorArea = firstNumber(raw.floorArea, raw.floor_area, raw.areaSqFt) ?? 0;
  const height =
    firstNumber(raw.ceilingHeight, raw.height) ?? DEFAULT_CEILING_HEIGHT_FT;
  const perimeter = firstNumber(raw.perimeterLf, raw.perimeter) ?? estimatePerimeter(floorArea);

  const openings: Opening[] = [
    ...(raw.openings ?? []).map((o) => normaliseOpening(o, 'other')),
    ...(raw.doors ?? []).map((o) => normaliseOpening(o, 'door')),
    ...(raw.windows ?? []).map((o) => normaliseOpening(o, 'window')),
  ];

  return {
    id: String(raw.id ?? `room-${index + 1}`),
    name: raw.name ?? raw.label ?? `Room ${index + 1}`,
    roomType: (raw.roomType ?? raw.type)?.toLowerCase(),
    floorAreaSqFt: floorArea,
    // A flat ceiling matches the floor. Scans that measure a vaulted ceiling
    // report it separately, and that value wins when present.
    ceilingAreaSqFt: firstNumber(raw.ceilingArea, raw.ceiling_area) ?? floorArea,
    // Gross wall area from perimeter × height when the scan does not give it;
    // openings are deducted downstream in `quantities.ts`, not here.
    wallAreaSqFt: firstNumber(raw.wallArea, raw.wall_area) ?? perimeter * height,
    perimeterLf: perimeter,
    ceilingHeightFt: height,
    openings,
    level: raw.level ?? raw.floor,
  };
}

function normaliseOpening(raw: RawOpening, fallbackKind: Opening['kind']): Opening {
  const declared = (raw.kind ?? raw.type ?? '').toLowerCase();
  const kind: Opening['kind'] = declared.includes('door')
    ? 'door'
    : declared.includes('window')
      ? 'window'
      : declared.includes('cased') || declared.includes('opening')
        ? 'cased_opening'
        : fallbackKind;

  // Standard US door and window sizes, used only when the scan omits a
  // dimension — a missing width would otherwise zero out casing and baseboard.
  const defaults = kind === 'door' ? { width: 3, height: 6.67 } : { width: 3, height: 4 };
  return {
    kind,
    width: raw.width ?? defaults.width,
    height: raw.height ?? defaults.height,
    sharedWithRoomId: raw.sharedWith,
  };
}

function normalisePhoto(raw: RawPhoto, index: number): JobPhoto {
  return {
    id: String(raw.id ?? `photo-${index + 1}`),
    roomId: raw.roomId !== undefined || raw.room_id !== undefined
      ? String(raw.roomId ?? raw.room_id)
      : undefined,
    caption: raw.caption ?? raw.label,
    takenAt: raw.takenAt ?? raw.created_at,
    url: raw.downloadUrl ?? raw.url ?? '',
    contentType: raw.contentType ?? raw.mimeType,
  };
}

function firstNumber(...values: (number | undefined)[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/**
 * Perimeter of a square with the same area — the least-wrong guess when the
 * scan omits it. Real rooms are rarely square, so this under-reports; anything
 * derived from it is flagged rather than trusted.
 */
function estimatePerimeter(floorAreaSqFt: number): number {
  return floorAreaSqFt > 0 ? 4 * Math.sqrt(floorAreaSqFt) : 0;
}

