import { useRef, useState } from 'react';
import type { PhotoManifestEntry } from '../../lib/api';

/**
 * Source intake.
 *
 * Four inputs, none of them required on their own — the agent works from
 * whatever it is given and says loudly what it had to infer. That matters
 * practically: a technician who has photos and notes but no scan yet should get
 * a usable draft, not a validation error.
 *
 * Photos are read for their metadata only. The bytes never leave the browser:
 * an estimate needs the timestamp and the caption, not the pixels, and shipping
 * a few hundred HEICs to the server to extract a filename would be slow and
 * pointless. Captions are editable here because they are what substantiate
 * demolition line items later — "flood cut 24in master bath" is worth more on
 * review than the photo it labels.
 */

export interface Sources {
  docusketch?: unknown;
  mica?: unknown;
  photos: PhotoManifestEntry[];
  notes: string;
}

export function SourcePanel({
  sources,
  onChange,
  onLoadDemo,
  busy,
}: {
  sources: Sources;
  onChange: (next: Sources) => void;
  onLoadDemo: () => void;
  busy?: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setError(key: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  async function readJson(file: File, key: 'docusketch' | 'mica') {
    try {
      const parsed = JSON.parse(await file.text());
      setError(key, null);
      onChange({ ...sources, [key]: parsed });
    } catch {
      setError(key, `${file.name} is not valid JSON. Export it again from the app.`);
    }
  }

  function addPhotos(files: FileList) {
    const added: PhotoManifestEntry[] = Array.from(files).map((file) => ({
      filename: file.name,
      // lastModified is the closest thing to EXIF capture time available without
      // parsing the file. Close enough to establish an on-site timeline.
      capturedAt: new Date(file.lastModified).toISOString(),
      caption: '',
    }));
    onChange({ ...sources, photos: [...sources.photos, ...added] });
  }

  function updateCaption(index: number, caption: string) {
    const photos = sources.photos.map((photo, i) => (i === index ? { ...photo, caption } : photo));
    onChange({ ...sources, photos });
  }

  const captioned = sources.photos.filter((photo) => photo.caption?.trim()).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Sources</h2>
        <button
          onClick={onLoadDemo}
          disabled={busy}
          className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600 disabled:opacity-60"
        >
          Load a demo job
        </button>
      </div>

      <FileCard
        label="DocuSketch scan"
        hint="The measured geometry. Its numbers override anything typed by hand."
        accept="application/json,.json"
        loaded={Boolean(sources.docusketch)}
        error={errors.docusketch}
        onFile={(file) => readJson(file, 'docusketch')}
        onClear={() => onChange({ ...sources, docusketch: undefined })}
      />

      <FileCard
        label="MICA report"
        hint="The drying record — moisture readings, psychrometrics, equipment log, monitoring visits."
        accept="application/json,.json"
        loaded={Boolean(sources.mica)}
        error={errors.mica}
        onFile={(file) => readJson(file, 'mica')}
        onClear={() => onChange({ ...sources, mica: undefined })}
      />

      {/* ---- Photos ---- */}
      <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-white">Photos</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Read for filename and timestamp only — the images stay on this device.
            </p>
          </div>
          <PhotoPicker onFiles={addPhotos} />
        </div>

        {sources.photos.length > 0 && (
          <>
            <p className="mt-3 text-xs text-gray-500">
              {sources.photos.length} photo{sources.photos.length === 1 ? '' : 's'} · {captioned}{' '}
              captioned.{' '}
              {captioned < sources.photos.length && (
                <span className="text-amber-300">
                  Uncaptioned photos cannot substantiate a line item.
                </span>
              )}
            </p>
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {sources.photos.map((photo, index) => (
                <li key={`${photo.filename}-${index}`} className="flex items-center gap-2">
                  <span
                    className="w-32 shrink-0 truncate font-mono text-[11px] text-gray-500"
                    title={photo.filename}
                  >
                    {photo.filename}
                  </span>
                  <input
                    value={photo.caption ?? ''}
                    onChange={(e) => updateCaption(index, e.target.value)}
                    placeholder="e.g. flood cut 24in — kitchen north wall"
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
                  />
                </li>
              ))}
            </ul>
            <button
              onClick={() => onChange({ ...sources, photos: [] })}
              className="mt-2 text-xs text-gray-500 transition hover:text-gray-300"
            >
              Clear photos
            </button>
          </>
        )}
      </div>

      {/* ---- Notes ---- */}
      <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
        <p className="text-sm font-medium text-white">Field notes</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Dimensions, cut heights, equipment counts and category are read out of plain text.
          Structured sources win where they overlap.
        </p>
        <textarea
          value={sources.notes}
          onChange={(e) => onChange({ ...sources, notes: e.target.value })}
          rows={7}
          placeholder={'Cat 2 from the dishwasher supply line, ran overnight.\n\nKitchen 16x13.5 — vinyl out, cavity wet, flood cut 24in.\nSet 21 air movers, 3 LGR.'}
          className="mt-2 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FileCard({
  label,
  hint,
  accept,
  loaded,
  error,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  accept: string;
  loaded: boolean;
  error?: string;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">
            {label}
            {loaded && <span className="ml-2 text-xs text-emerald-400">loaded</span>}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>
        <div className="flex gap-2">
          {loaded && (
            <button
              onClick={onClear}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition hover:text-gray-200"
            >
              Remove
            </button>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600"
          >
            Choose file
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function PhotoPicker({ onFiles }: { onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600"
      >
        Add photos
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
