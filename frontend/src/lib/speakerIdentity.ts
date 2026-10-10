/**
 * Speaker labels for the office UI.
 *
 * A person's name shows only when it is confirmed or a high-confidence voice
 * match. A role guess is marked as a guess and is never a fact label.
 */

export const VOICE_CONSENT_TEXT =
  'I consent to Atmosphere creating a voiceprint from this recording to recognize my voice on job clips. I can revoke this consent at any time, which deletes the voiceprint. Atmosphere will not use this voiceprint to identify me on another company\'s jobs unless I turn on cross-company matching in my own account settings.';

export const SPEAKER_ROLES = ['homeowner', 'subcontractor', 'crew', 'adjuster', 'other'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];
export type RoleGuessStatus = 'tentative' | 'confirmed' | 'corrected' | 'dismissed';

export function speakerClock(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const n = Math.floor(seconds);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function verificationQuestion(input: {
  speakerLabel: string;
  clipTitle: string;
  tSec: number | null;
  candidateName?: string | null;
  role?: SpeakerRole | null;
}): string {
  const label = input.speakerLabel.replace(/\s+/g, ' ').trim();
  const who = !label || /^unidentified speaker$/i.test(label) ? 'this speaker' : label;
  const title = input.clipTitle.replace(/\s+/g, ' ').trim().replace(/[\s,;:–—-]+$/, '');
  const clip = title && title.toLowerCase() !== 'this clip' ? `“${title}”` : 'this clip';
  const at = speakerClock(input.tSec);
  const heard = at ? `Heard at ${at} in ${clip}.` : `Heard in ${clip}.`;
  const name = input.candidateName?.replace(/\s+/g, ' ').trim();
  if (name) return `Is ${who} ${name}? ${heard}`;
  if (input.role) return `Is ${who} the ${input.role}? ${heard}`;
  return `Who is ${who}? ${heard}`;
}

/** Name, or "Speaker 3 (likely homeowner)" while a role is still a guess. */
export function uiSpeakerLabel(input: {
  speakerLabel: string | null | undefined;
  confirmedName?: string | null;
  role?: SpeakerRole | null;
  roleStatus?: RoleGuessStatus | null;
}): string {
  const name = input.confirmedName?.trim();
  if (name) return name;
  const base = (input.speakerLabel ?? '').replace(/\s+/g, ' ').trim() || 'Unidentified speaker';
  if (!input.role || !input.roleStatus || input.roleStatus === 'dismissed') return base;
  const inner = input.roleStatus === 'tentative' ? `likely ${input.role}` : input.role;
  return `${base} (${inner})`;
}

/** Evidence, verbatim attribution, and exports. Guesses are omitted. */
export function factSpeakerLabel(input: {
  speakerLabel: string | null | undefined;
  confirmedName?: string | null;
}): string {
  const name = input.confirmedName?.trim();
  if (name) return name;
  return (input.speakerLabel ?? '').replace(/\s+/g, ' ').trim() || 'Unidentified speaker';
}

/** 16 kHz mono PCM WAV so the server can embed the sample without ffmpeg. */
export function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function fileToWavBase64(file: Blob): Promise<string> {
  const audio = new AudioContext();
  try {
    const decoded = await audio.decodeAudioData(await file.arrayBuffer());
    const rate = 16000;
    const length = Math.max(1, Math.round(decoded.duration * rate));
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = encodeMonoWav(samples, rate);
    const buffer = await wav.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } finally {
    await audio.close();
  }
}
