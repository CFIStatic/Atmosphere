/**
 * Defensive detection signatures for Atmosphere.
 *
 * These patterns identify probe and attack *traffic* so the agent can block or
 * deceive the caller. They are not payloads to run against anything — matching
 * a signature only raises a threat score and triggers a defensive response.
 */

export interface Signature {
  rule: string;
  category: import('./types.js').ThreatCategory;
  severity: import('./types.js').ThreatSeverity;
  score: number;
  reason: string;
  /** Test against the raw URL path (decoded once, lowercased). */
  path?: RegExp;
  /** Test against the query string. */
  query?: RegExp;
  /** Test against a single header value (name is looked up case-insensitively). */
  header?: { name: string; pattern: RegExp };
  /** Test against User-Agent. */
  userAgent?: RegExp;
  /** Test against a redacted body string (only for small JSON bodies). */
  body?: RegExp;
}

/** Common scanner / exploit-kit user agents. Case-insensitive. */
const SCANNER_UA =
  /sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|wfuzz|acunetix|nessus|openvas|w3af|havij|pangolin|libwww-perl|python-requests\/|curl\/7\.(0|1|2)|scrapy|httpclient|java\/1\.|go-http-client|nuclei|httpx|feroxbuster|ffuf/i;

/**
 * Paths attackers routinely probe. Hitting one of these is almost never a
 * legitimate Atmosphere client — real traffic lives under /api/* with known
 * routers. Serving a decoy here keeps them busy away from real surfaces.
 */
const HONEYPOT_PATHS =
  /^\/(?:\.env(?:\..+)?|\.git(?:\/|$)|\.svn(?:\/|$)|\.DS_Store|wp-admin(?:\/|$)|wp-login\.php|xmlrpc\.php|phpmyadmin(?:\/|$)|pma(?:\/|$)|adminer(?:\.php)?(?:\/|$)|administrator(?:\/|$)|cgi-bin(?:\/|$)|vendor\/phpunit|actuator(?:\/|$)|server-status|server-info|\.aws\/|config\.php|web\.config|backup(?:\.sql|\.zip|\.tar)?(?:\/|$)|dump\.sql|db\.sql|api\/v1\/(?:admin|internal|debug|secrets|keys)|api\/(?:admin|internal|debug|secrets|config\/raw)|graphql\/playground|console\/?$|_ignition\/|telescope(?:\/|$)|horizon(?:\/|$)|phpinfo\.php|info\.php|test\.php|shell\.php|cmd\.php|eval\.php)/i;

const TRAVERSAL =
  /(?:\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c|%252e%252e%252f|\/etc\/(?:passwd|shadow)|\/proc\/self|\\windows\\system32)/i;

const INJECTION =
  /(?:(?:\bunion\b.+\bselect\b)|(?:\bselect\b.+\bfrom\b)|(?:\bdrop\b.+\btable\b)|(?:\binsert\b.+\binto\b)|(?:\bupdate\b.+\bset\b)|(?:;?\s*sleep\s*\()|(?:benchmark\s*\()|(?:(?:%27|')\s*(?:or|and)\s*(?:%27|')?\d)|(?:<\s*script\b)|(?:javascript\s*:)|(?:\bonerror\s*=)|(?:\beval\s*\()|(?:\$\{.*\})|(?:;\s*(?:cat|wget|curl|bash|sh|nc|ncat)\b))/i;

export const SIGNATURES: Signature[] = [
  {
    rule: 'honeypot.path',
    category: 'honeypot',
    severity: 'high',
    score: 70,
    reason: 'Request hit a decoy / probe path that no legitimate Atmosphere client uses.',
    path: HONEYPOT_PATHS,
  },
  {
    rule: 'traversal.path',
    category: 'traversal',
    severity: 'critical',
    score: 90,
    reason: 'Path traversal or sensitive OS path probe detected.',
    path: TRAVERSAL,
  },
  {
    rule: 'traversal.query',
    category: 'traversal',
    severity: 'critical',
    score: 90,
    reason: 'Path traversal payload in the query string.',
    query: TRAVERSAL,
  },
  {
    rule: 'injection.query',
    category: 'injection',
    severity: 'critical',
    score: 85,
    reason: 'SQL / script injection pattern in the query string.',
    query: INJECTION,
  },
  {
    rule: 'injection.body',
    category: 'injection',
    severity: 'high',
    score: 75,
    reason: 'SQL / script injection pattern in the request body.',
    body: INJECTION,
  },
  {
    rule: 'scanner.user_agent',
    category: 'scanner',
    severity: 'medium',
    score: 40,
    reason: 'User-Agent matches a known vulnerability scanner or exploit toolkit.',
    userAgent: SCANNER_UA,
  },
  {
    rule: 'recon.dotfile',
    category: 'recon',
    severity: 'medium',
    score: 45,
    reason: 'Dotfile or hidden configuration probe.',
    path: /^\/\.(?!well-known)/i,
  },
  {
    rule: 'protocol.unexpected_method',
    category: 'protocol',
    severity: 'low',
    score: 15,
    reason: 'Unusual HTTP method for this API surface.',
    // Matched in detector via method allow-list rather than a regex here.
  },
];

/** Paths the deception layer owns — must stay out of the real router table. */
export const DECOY_PATHS: readonly string[] = [
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.git/config',
  '/.git/HEAD',
  '/.aws/credentials',
  '/wp-admin',
  '/wp-login.php',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/phpmyadmin/',
  '/adminer.php',
  '/administrator',
  '/server-status',
  '/phpinfo.php',
  '/api/admin',
  '/api/admin/users',
  '/api/internal',
  '/api/internal/debug',
  '/api/secrets',
  '/api/v1/secrets',
  '/api/v1/admin',
  '/api/config/raw',
  '/graphql/playground',
  '/console',
  '/actuator',
  '/actuator/env',
  '/telescope',
  '/backup.sql',
  '/dump.sql',
  '/web.config',
  '/config.php',
];

export function isDecoyPath(path: string): boolean {
  const normalized = path.split('?')[0] ?? path;
  if (DECOY_PATHS.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
    return true;
  }
  return HONEYPOT_PATHS.test(normalized);
}

/**
 * Real office mutations. A job title like "drop cloths on the table" can
 * trip injection.body (score 75 → 403 Forbidden). Duplicate / rename /
 * Start a job must still run — observe, do not refuse.
 */
const TRUSTED_PRODUCT_PATH =
  /^\/api\/(?:operations\/(?:shared\/[^/]+(?:\/duplicate)?|intake\/(?:approve|propose)|jobs\/quick-start)$|jobs(?:\/[^/]+)?$|auth(?:\/|$)|org(?:\/|$)|profile(?:\/|$))/i;

export function isTrustedProductPath(path: string): boolean {
  const normalized = (path.split('?')[0] ?? path).replace(/\/+$/, '') || '/';
  if (isDecoyPath(normalized)) return false;
  return TRUSTED_PRODUCT_PATH.test(normalized);
}
