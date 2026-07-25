import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, Circle, Mic, Square, Trash2, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, cn } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { useSetTaskStatus, useTasks } from '../../data/hooks';
import { relativeTime } from '../../domain/format';
import { useAssistant } from '../../assistant/AssistantContext';

/**
 * Field mode — the phone-first surface for technicians on site.
 *
 * Built around the three things that actually happen in a flooded basement:
 * capture a photo, dictate a note because your hands are wet, and tick a task
 * off. Targets are oversized and the layout is single-column; nothing here
 * assumes a mouse or a spare hand.
 *
 * Capture is genuinely functional — MediaRecorder for audio, the camera capture
 * intent for photos — and degrades honestly when the browser or the user denies
 * permission rather than pretending to record.
 */

interface VoiceNote {
  id: string;
  url: string;
  seconds: number;
  at: string;
}

interface Photo {
  id: string;
  url: string;
  name: string;
  at: string;
}

const QUICK_COMMANDS = [
  'Log moisture readings for this job',
  'Equipment is not drying — flag this job',
  'Request an extra air mover',
  'Mark this job ready for the next phase',
];

export function FieldPage() {
  const { data: tasks = [] } = useTasks();
  const setStatus = useSetTaskStatus();
  const { send } = useAssistant();

  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | undefined>(undefined);
  const createdUrls = useRef<string[]>([]);
  // Held in a ref because the recorder's `onstop` closure captures state as it
  // was when recording began, not as it is when recording ends.
  const elapsedRef = useRef(0);

  const todaysTasks = tasks.filter((t) => t.status !== 'done').slice(0, 6);

  // Object URLs are leaked memory until revoked; clean up everything this page
  // created when it unmounts.
  useEffect(
    () => () => {
      createdUrls.current.forEach(URL.revokeObjectURL);
      window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    window.clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setCaptureError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setCaptureError('Voice notes are not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        createdUrls.current.push(url);
        setNotes((prev) => [
          { id: `n-${Date.now()}`, url, seconds: elapsedRef.current, at: new Date().toISOString() },
          ...prev,
        ]);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      elapsedRef.current = 0;
      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } catch {
      setCaptureError('Microphone permission was denied. Enable it to record voice notes.');
    }
  }, []);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map((file) => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return {
        id: `p-${Date.now()}-${file.name}`,
        url,
        name: file.name,
        at: new Date().toISOString(),
      };
    });
    setPhotos((prev) => [...next, ...prev]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  return (
    <>
      <PageHeader title="Field mode" description="Capture from site, hands-free where possible" />

      <PageBody className="mx-auto max-w-2xl space-y-4">
        {captureError && (
          <p
            role="alert"
            className="rounded-lg border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-xs text-state-warn"
          >
            {captureError}
          </p>
        )}

        {/* ── Capture ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-2xl border py-7 transition active:scale-[0.98]',
              recording
                ? 'border-state-danger/40 bg-state-danger/10'
                : 'border-white/10 bg-ink-800/60 hover:bg-ink-700/60',
            )}
          >
            {recording ? (
              <>
                <Square className="h-7 w-7 text-state-danger" />
                <span className="font-mono text-sm text-state-danger">
                  {formatElapsed(elapsed)}
                </span>
                <span className="text-2xs text-gray-500">Tap to stop</span>
              </>
            ) : (
              <>
                <Mic className="h-7 w-7 text-brand-400" />
                <span className="text-sm font-medium text-gray-200">Voice note</span>
              </>
            )}
          </button>

          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-white/10',
              'bg-ink-800/60 py-7 transition hover:bg-ink-700/60 active:scale-[0.98]',
            )}
          >
            <Camera className="h-7 w-7 text-brand-400" />
            <span className="text-sm font-medium text-gray-200">Photos</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                addPhotos(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {/* ── Captured media ────────────────────────────────────────────────── */}
        {photos.length > 0 && (
          <Card>
            <CardHeader title={`Photos (${photos.length})`} description="Not yet uploaded" />
            <CardBody>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((photo) => (
                  <li key={photo.id} className="group relative aspect-square">
                    <img
                      src={photo.url}
                      alt={photo.name}
                      className="h-full w-full rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.id)}
                      aria-label={`Remove ${photo.name}`}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/70 text-gray-300 transition hover:text-state-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        {notes.length > 0 && (
          <Card>
            <CardHeader title={`Voice notes (${notes.length})`} description="Not yet uploaded" />
            <CardBody className="space-y-2">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-center gap-3 rounded-lg bg-ink-700/50 p-2.5"
                >
                  <Mic className="h-4 w-4 shrink-0 text-brand-400" />
                  <audio controls src={note.url} className="h-8 flex-1" />
                  <span className="shrink-0 text-2xs text-gray-600">{relativeTime(note.at)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {/* ── Quick commands ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Quick commands" description="Send straight to Atmosphere" />
          <CardBody className="grid gap-2">
            {QUICK_COMMANDS.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => send(command)}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-ink-700/40 px-3 py-3 text-left text-sm text-gray-200 transition hover:bg-ink-600/60 active:scale-[0.99]"
              >
                <Zap className="h-4 w-4 shrink-0 text-brand-400" />
                {command}
              </button>
            ))}
          </CardBody>
        </Card>

        {/* ── Today's tasks ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Your tasks" description="Tap to complete" />
          <CardBody className="p-0">
            {todaysTasks.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="Nothing assigned" />
            ) : (
              <ul className="divide-y divide-white/5">
                {todaysTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: task.id, status: 'done' })}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition active:bg-white/5"
                    >
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-100">{task.title}</p>
                        <p className="mt-0.5 text-2xs text-gray-600">
                          {task.jobNumber}
                          {task.dueDate && ` · due ${relativeTime(task.dueDate)}`}
                        </p>
                      </div>
                      {task.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-center pb-4">
          <Link to="/my-work">
            <Button variant="ghost" size="sm">
              Back to My Work
            </Button>
          </Link>
        </div>
      </PageBody>
    </>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
