import type { Request } from 'express';

export type ClassifiedAction = {
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  skip: boolean;
};

const SKIP_EXACT = new Set([
  '/',
  '/api',
  '/api/',
  '/api/health',
  '/api/ready',
  '/health',
  '/ready',
]);

const SKIP_PREFIX = ['/api/telemetry/feature'];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

type Rule = {
  method: string;
  pattern: RegExp;
  action: string;
  resourceType?: string;
  resourceParam?: number;
};

const RULES: Rule[] = [
  { method: 'POST', pattern: /^\/api\/auth\/login\/?$/, action: 'auth.signed_in' },
  { method: 'POST', pattern: /^\/api\/auth\/signup\/?$/, action: 'auth.signed_up' },
  { method: 'POST', pattern: /^\/api\/auth\/logout\/?$/, action: 'auth.signed_out' },
  { method: 'POST', pattern: /^\/api\/auth\/forgot-password\/?$/, action: 'auth.password_reset_requested' },
  { method: 'POST', pattern: /^\/api\/auth\/reset-password\/?$/, action: 'auth.password_reset' },
  { method: 'POST', pattern: /^\/api\/auth\/internal-login\/?$/, action: 'auth.staff_signed_in' },
  { method: 'POST', pattern: /^\/api\/media\/catalog\/uploads\/?$/, action: 'video.upload_started', resourceType: 'media' },
  { method: 'POST', pattern: /^\/api\/media\/catalog\/uploads\/complete\/?$/, action: 'video.uploaded', resourceType: 'media' },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/media/catalog/objects/(${UUID})/?$`),
    action: 'video.deleted',
    resourceType: 'media',
    resourceParam: 1,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/media/catalog/objects/(${UUID})/url/?$`),
    action: 'video.viewed',
    resourceType: 'media',
    resourceParam: 1,
  },
  {
    method: 'POST',
    pattern: /^\/api\/job-share\/[^/]+\/proof\/?$/,
    action: 'video.uploaded',
    resourceType: 'proof',
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/operations/shared/(${UUID})/evidence/(${UUID})/?$`),
    action: 'video.deleted',
    resourceType: 'proof',
    resourceParam: 2,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/legal/jobs/(${UUID})/?$`),
    action: 'legal.job_portal_viewed',
    resourceType: 'job',
    resourceParam: 1,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/operations/shared/proof/(${UUID})/video/?$`),
    action: 'video.viewed',
    resourceType: 'proof',
    resourceParam: 1,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/evidence-portal/library/?$`),
    action: 'evidence.library_viewed',
    resourceType: 'library',
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/evidence-portal/evidence/([^/]+)/ask/?$`),
    action: 'evidence.asked',
    resourceType: 'proof',
    resourceParam: 1,
  },
  {
    method: 'POST',
    pattern: /^\/api\/verifier-share\/[^/]+\/evidence\/([^/]+)\/ask\/?$/,
    action: 'evidence.asked',
    resourceType: 'proof',
    resourceParam: 1,
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/legal/holds/?$`),
    action: 'legal.hold_created',
    resourceType: 'legal_hold',
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/legal/holds/(${UUID})/release/?$`),
    action: 'legal.hold_released',
    resourceType: 'legal_hold',
    resourceParam: 1,
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/legal/holds/(${UUID})/produce/?$`),
    action: 'legal.produced',
    resourceType: 'legal_hold',
    resourceParam: 1,
  },
  {
    method: 'GET',
    pattern: /^\/api\/legal\/auto-holds\/?$/,
    action: 'legal.auto_holds_reviewed',
    resourceType: 'legal_hold',
  },
  {
    method: 'POST',
    pattern: /^\/api\/legal\/auto-holds\/sweep\/?$/,
    action: 'legal.auto_hold_sweep_run',
    resourceType: 'legal_hold',
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/legal/videos/(${UUID})/url/?$`),
    action: 'legal.video_produced',
    resourceType: 'vault',
    resourceParam: 1,
  },
];

/**
 * Map an HTTP request to a legal-monitor action.
 *
 * Heartbeats and probes are skipped. Named product events win; everything
 * else signed-in still lands as http.<method> so the trail has no holes.
 */
export function classifyRequest(req: Request): ClassifiedAction {
  const path = req.path || req.url?.split('?')[0] || '';
  if (SKIP_EXACT.has(path) || SKIP_PREFIX.some((prefix) => path.startsWith(prefix))) {
    return { action: 'skip', resourceType: null, resourceId: null, skip: true };
  }
  if (req.method === 'OPTIONS') {
    return { action: 'skip', resourceType: null, resourceId: null, skip: true };
  }

  const method = req.method.toUpperCase();
  for (const rule of RULES) {
    if (rule.method !== method) continue;
    const match = rule.pattern.exec(path);
    if (!match) continue;
    return {
      action: rule.action,
      resourceType: rule.resourceType ?? null,
      resourceId: rule.resourceParam ? match[rule.resourceParam] ?? null : null,
      skip: false,
    };
  }

  return {
    action: `http.${method.toLowerCase()}`,
    resourceType: 'http',
    resourceId: path,
    skip: false,
  };
}
