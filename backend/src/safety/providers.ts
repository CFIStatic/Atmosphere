/**
 * Test seam for the live safety providers (Whisper, the frame screen, the
 * confirmation model). Production never sets these; tests inject mocks so
 * the real pipeline (context, decisions, incidents, fanout) runs end to end.
 */

import type { ConfirmInput, ConfirmResult } from './confirm.js';
import type { ScreenInput, ScreenResult } from './screen.js';

export type LiveTranscribeResult = {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
};

export type SafetyProviderOverrides = {
  confirm?: (input: ConfirmInput) => Promise<ConfirmResult | null>;
  screen?: (input: ScreenInput) => Promise<ScreenResult | null>;
  transcribe?: (audio: Buffer, mimeType: string, offsetSeconds: number) => Promise<LiveTranscribeResult>;
  /** Replace the system mailer (tests measure the parallel email fanout). */
  sendMail?: (msg: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean }>;
  /** Capture flat-fee usage rows (Whisper) instead of writing them. */
  meterFlat?: (row: Record<string, unknown>) => void;
};

let overrides: SafetyProviderOverrides = {};

export function setSafetyProvidersForTests(next: SafetyProviderOverrides | null): void {
  overrides = next ?? {};
}

export function safetyProviderOverrides(): SafetyProviderOverrides {
  return overrides;
}
