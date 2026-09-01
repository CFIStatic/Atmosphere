export type RecordingKind = 'audio' | 'video';

export interface StoredRecording {
  id: string;
  kind: RecordingKind;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** A dictated note, or the objects the camera saw — whatever gives it a name. */
  note?: string;
}

/**
 * Local store for captured audio and video.
 *
 * Recordings stay on the device. IndexedDB holds the blobs so a technician who
 * backgrounds the app, loses signal, or reloads the tab still has this
 * morning's walkthrough — an in-memory array would drop it, which for a job
 * that cannot be re-walked is a real loss.
 *
 * Nothing is uploaded. Getting a recording off the phone is an explicit
 * download, so what was said inside a customer's house does not silently
 * become server-side data.
 */

const DB_NAME = 'atmosphere-technician';
const DB_VERSION = 1;
const STORE = 'recordings';

/**
 * Private browsing and some locked-down enterprise profiles refuse IndexedDB.
 * Rather than failing the whole feature, fall back to memory for the session.
 */
let memoryFallback: Map<string, StoredRecording> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function useMemory(): Map<string, StoredRecording> {
  memoryFallback ??= new Map();
  return memoryFallback;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = operation(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function listRecordings(): Promise<StoredRecording[]> {
  try {
    const all = await runTransaction<StoredRecording[]>('readonly', (store) => store.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [...useMemory().values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

export async function saveRecording(recording: StoredRecording): Promise<void> {
  try {
    await runTransaction('readwrite', (store) => store.put(recording));
  } catch {
    useMemory().set(recording.id, recording);
  }
}

export async function deleteRecording(id: string): Promise<void> {
  try {
    await runTransaction('readwrite', (store) => store.delete(id));
  } catch {
    useMemory().delete(id);
  }
}

export async function clearRecordings(): Promise<void> {
  try {
    await runTransaction('readwrite', (store) => store.clear());
  } catch {
    useMemory().clear();
  }
}

/* ---- Presentation helpers ---- */

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** File extension for a download, derived from the container the browser used. */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.includes('mp4')) return 'mp4';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('mpeg')) return 'mp3';
  if (base.includes('wav')) return 'wav';
  return 'webm';
}

export function downloadRecording(recording: StoredRecording): void {
  const url = URL.createObjectURL(recording.blob);
  const stamp = new Date(recording.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `atmosphere-${recording.kind}-${stamp}.${extensionFor(recording.mimeType)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in Safari; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** IDs only need to be unique on this device. */
export function newRecordingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
