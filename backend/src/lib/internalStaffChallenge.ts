import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { staffFullName } from './internalStaffGate.js';

const MAX_AGE_SEC = 10 * 60;

export interface StaffChallenge {
  v: 1;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  enrolled: boolean;
  secret?: string;
  exp: number;
}

export function signStaffChallenge(payload: Omit<StaffChallenge, 'v' | 'exp' | 'fullName'>): string {
  const body: StaffChallenge = {
    v: 1,
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    fullName: staffFullName(payload.firstName, payload.lastName),
    enrolled: payload.enrolled,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  if (payload.secret) body.secret = payload.secret;
  const json = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${json}.${hmac(json)}`;
}

export function readStaffChallenge(token: string): StaffChallenge | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const json = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(json);
  if (!safeEqualUtf8(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as StaffChallenge;
    if (parsed.v !== 1 || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.email || !parsed.firstName || !parsed.lastName) return null;
    if (typeof parsed.enrolled !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function hmac(json: string): string {
  return createHmac('sha256', config.device.pepper).update(json).digest('base64url');
}

function safeEqualUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
