/**
 * AWS Signature Version 4 for the few EC2 Query API calls desktop hosts need
 * (start, stop, describe). Small enough that the AWS SDK isn't worth adding.
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

export interface AwsKeys {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding, as SigV4 wants it. */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** "20150830T123600Z" */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Sign a request. Returns the headers to send (Authorization, X-Amz-Date,
 * and X-Amz-Security-Token when a session token is used). `headers` must
 * include host; they are all signed.
 */
export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
  service: string;
  region: string;
  keys: AwsKeys;
  now: Date;
}): Record<string, string> {
  const { method, url, body, service, region, keys, now } = input;
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, 'x-amz-date': date };
  if (keys.sessionToken) headers['x-amz-security-token'] = keys.sessionToken;

  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = url.pathname
    .split('/')
    .map((seg) => awsEncode(decodeURIComponent(seg)))
    .join('/') || '/';
  const canonicalRequest = [method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${keys.secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
