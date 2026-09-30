/**
 * Open-source speaker embedding for the Node transcription stack.
 *
 * The pipeline transcribes with a Whisper-compatible endpoint and does not
 * run a neural diarizer. This module embeds a short PCM clip with the classic
 * open method those labels can be matched against: mel-frequency cepstral
 * coefficients, deltas, and mean/variance pooling over voiced frames
 * (Davis & Mermelstein, 1980). No model weights and no change to the
 * transcription or Ask providers. Swap the vector later; cosine match stays.
 */

const TARGET_RATE = 16_000;
const FRAME = 400;
const HOP = 160;
const FFT_SIZE = 512;
const MEL_BANDS = 26;
const CEPS = 13;
const MIN_VOICED_FRAMES = 8;

export const SPEAKER_EMBEDDING_MODEL = 'mfcc-stat-pool-v1';
export const SPEAKER_EMBEDDING_DIM = CEPS * 3 * 2;

export class SpeakerEmbeddingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SpeakerEmbeddingError';
    this.code = code;
  }
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

function bitReverse(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const reT = re[i]!;
      re[i] = re[j]!;
      re[j] = reT;
      const imT = im[i]!;
      im[i] = im[j]!;
      im[j] = imT;
    }
  }
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  bitReverse(re, im);
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const j = i + k + half;
        const vRe = re[j]! * wRe - im[j]! * wIm;
        const vIm = re[j]! * wIm + im[j]! * wRe;
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[j] = uRe - vRe;
        im[j] = uIm - vIm;
        const nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }
}

function melFilterbank(sampleRate: number): number[][] {
  const bins = FFT_SIZE / 2 + 1;
  const low = hzToMel(80);
  const high = hzToMel(Math.min(7600, sampleRate / 2));
  const points = new Array<number>(MEL_BANDS + 2);
  for (let i = 0; i < points.length; i += 1) {
    const hz = melToHz(low + ((high - low) * i) / (MEL_BANDS + 1));
    points[i] = Math.floor(((FFT_SIZE + 1) * hz) / sampleRate);
  }
  const filters: number[][] = [];
  for (let m = 1; m <= MEL_BANDS; m += 1) {
    const filter = new Array<number>(bins).fill(0);
    const left = points[m - 1]!;
    const mid = points[m]!;
    const right = points[m + 1]!;
    for (let k = left; k < mid; k += 1) {
      if (k >= 0 && k < bins && mid !== left) filter[k] = (k - left) / (mid - left);
    }
    for (let k = mid; k < right; k += 1) {
      if (k >= 0 && k < bins && right !== mid) filter[k] = (right - k) / (right - mid);
    }
    filters.push(filter);
  }
  return filters;
}

function dct(values: number[]): number[] {
  const out = new Array<number>(CEPS);
  for (let i = 0; i < CEPS; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) {
      sum += values[j]! * Math.cos((Math.PI * i * (j + 0.5)) / values.length);
    }
    out[i] = sum;
  }
  return out;
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const scale = fromRate / toRate;
  for (let i = 0; i < length; i += 1) {
    const pos = i * scale;
    const left = Math.floor(pos);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = pos - left;
    out[i] = (samples[left] ?? 0) * (1 - frac) + (samples[right] ?? 0) * frac;
  }
  return out;
}

function hamming(length: number): Float64Array {
  const win = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return win;
}

const WINDOW = hamming(FRAME);

function frameEnergy(samples: Float32Array, start: number): number {
  let energy = 0;
  for (let i = 0; i < FRAME; i += 1) {
    const s = samples[start + i] ?? 0;
    energy += s * s;
  }
  return energy / FRAME;
}

function mfccFrame(samples: Float32Array, start: number, filters: number[][]): number[] | null {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FRAME; i += 1) re[i] = (samples[start + i] ?? 0) * WINDOW[i]!;
  fft(re, im);
  const power = new Array<number>(FFT_SIZE / 2 + 1);
  for (let i = 0; i < power.length; i += 1) {
    power[i] = re[i]! * re[i]! + im[i]! * im[i]! + 1e-10;
  }
  const mels = filters.map((filter) => {
    let sum = 0;
    for (let i = 0; i < filter.length; i += 1) sum += filter[i]! * power[i]!;
    return Math.log(Math.max(sum, 1e-10));
  });
  const cep = dct(mels);
  cep[0] = 0;
  return cep;
}

function deltas(frames: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < frames.length; i += 1) {
    const prev = frames[Math.max(0, i - 2)]!;
    const next = frames[Math.min(frames.length - 1, i + 2)]!;
    out.push(next.map((value, k) => (value - prev[k]!) / 2));
  }
  return out;
}

function meanStd(rows: number[][]): number[] {
  const dim = rows[0]?.length ?? 0;
  const mean = new Array<number>(dim).fill(0);
  for (const row of rows) {
    for (let i = 0; i < dim; i += 1) mean[i]! += row[i]!;
  }
  for (let i = 0; i < dim; i += 1) mean[i] = mean[i]! / rows.length;
  const std = new Array<number>(dim).fill(0);
  for (const row of rows) {
    for (let i = 0; i < dim; i += 1) {
      const d = row[i]! - mean[i]!;
      std[i]! += d * d;
    }
  }
  for (let i = 0; i < dim; i += 1) std[i] = Math.sqrt(std[i]! / rows.length);
  return [...mean, ...std];
}

/** L2-normalized MFCC statistic-pool embedding. Throws when the clip has no voice. */
export function embedPcm(samples: Float32Array, sampleRate: number): number[] {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new SpeakerEmbeddingError('bad_audio', 'The voice sample could not be read.');
  }
  const pcm = resampleLinear(samples, sampleRate, TARGET_RATE);
  if (pcm.length < TARGET_RATE) {
    throw new SpeakerEmbeddingError('too_short', 'Record at least one second of speech.');
  }
  const filters = melFilterbank(TARGET_RATE);
  const energies: number[] = [];
  const starts: number[] = [];
  for (let start = 0; start + FRAME < pcm.length; start += HOP) {
    starts.push(start);
    energies.push(frameEnergy(pcm, start));
  }
  const peak = Math.max(...energies, 0);
  if (peak < 1e-6) {
    throw new SpeakerEmbeddingError('no_speech', 'No speech was detected in that sample.');
  }
  const voiced = starts.filter((_, index) => energies[index]! > peak * 0.08);
  if (voiced.length < MIN_VOICED_FRAMES) {
    throw new SpeakerEmbeddingError('no_speech', 'No speech was detected in that sample.');
  }
  const staticFrames = voiced
    .map((start) => mfccFrame(pcm, start, filters))
    .filter((row): row is number[] => !!row);
  const delta = deltas(staticFrames);
  const delta2 = deltas(delta);
  const stacked = staticFrames.map((frame, index) => [...frame, ...delta[index]!, ...delta2[index]!]);
  return l2normalize(meanStd(stacked));
}

export function l2normalize(values: number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new SpeakerEmbeddingError('no_speech', 'No speech was detected in that sample.');
  }
  return values.map((value) => Math.round((value / norm) * 1e6) / 1e6);
}

/** Cosine similarity of two equal-length embeddings. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

export function decodeWavPcm(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  if (bytes.length < 44) {
    throw new SpeakerEmbeddingError('bad_audio', 'Upload a WAV recording.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new SpeakerEmbeddingError('bad_audio', 'Upload a WAV recording.');
  }
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === 'data') {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (format !== 1 || (bits !== 16 && bits !== 8) || channels < 1 || channels > 2 || dataOffset < 0) {
    throw new SpeakerEmbeddingError('bad_audio', 'Upload a PCM WAV recording.');
  }
  const end = Math.min(bytes.length, dataOffset + dataSize);
  const frames = Math.floor((end - dataOffset) / (channels * (bits / 8)));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let mixed = 0;
    for (let c = 0; c < channels; c += 1) {
      const at = dataOffset + (i * channels + c) * (bits / 8);
      if (bits === 16) mixed += view.getInt16(at, true) / 32768;
      else mixed += (bytes[at]! - 128) / 128;
    }
    samples[i] = mixed / channels;
  }
  return { sampleRate, samples };
}

export function embedWav(bytes: Uint8Array): number[] {
  const { sampleRate, samples } = decodeWavPcm(bytes);
  const maxSamples = sampleRate * 20;
  const clipped = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples;
  return embedPcm(clipped, sampleRate);
}

/** Embed one diarized speaker by concatenating that speaker's time ranges. */
export function embedSpeakerRanges(
  samples: Float32Array,
  sampleRate: number,
  ranges: Array<{ startSec: number; endSec: number }>,
): number[] | null {
  const pieces: Float32Array[] = [];
  let total = 0;
  const cap = sampleRate * 20;
  for (const range of ranges) {
    const start = Math.max(0, Math.floor(range.startSec * sampleRate));
    const end = Math.min(samples.length, Math.ceil(range.endSec * sampleRate));
    if (end - start < sampleRate * 0.3) continue;
    const slice = samples.subarray(start, Math.min(end, start + (cap - total)));
    if (!slice.length) continue;
    pieces.push(slice);
    total += slice.length;
    if (total >= cap) break;
  }
  if (total < sampleRate) return null;
  const joined = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  try {
    return embedPcm(joined, sampleRate);
  } catch {
    return null;
  }
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
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
  return bytes;
}
