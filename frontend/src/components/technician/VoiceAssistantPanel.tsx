import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type AssistantContext, type AssistantTurn } from '../../lib/api';
import { useSpeechRecognition, useSpeechSynthesis } from '../../hooks/useSpeech';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useMediaRecorder, recorderSupported } from '../../hooks/useMediaRecorder';
import { ArrowUpIcon, MicIcon, SparkIcon, SpinnerIcon, SpeakerIcon, StopIcon } from '../icons';

interface Props {
  context: AssistantContext;
  /** What the assistant can currently see, shown under the title. */
  contextLabel: string;
  transcriptionAvailable: boolean;
  assistantAvailable: boolean;
}

interface Turn extends AssistantTurn {
  id: string;
}

/**
 * How the mic button behaves, decided once from what the browser and the
 * deployment can actually do:
 *
 * - `recognition` — Chrome/Edge. Live captions, no server round trip, free.
 * - `upload`      — Safari/Firefox with server transcription configured. Record
 *                   a clip, post it, get text back.
 * - `none`        — Neither. The text box is still there; a technician can type.
 */
type MicMode = 'recognition' | 'upload' | 'none';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The assistant rail.
 *
 * It sits alongside whatever the technician is doing rather than being a place
 * they navigate to — the whole point is asking about the thing currently on
 * screen, so it stays in view while the camera runs.
 */
export function VoiceAssistantPanel({
  context,
  contextLabel,
  transcriptionAvailable,
  assistantAvailable,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(true);

  const recognition = useSpeechRecognition();
  const synthesis = useSpeechSynthesis();

  const micMode: MicMode = recognition.supported
    ? 'recognition'
    : transcriptionAvailable && recorderSupported()
      ? 'upload'
      : 'none';

  // History is read inside async callbacks; a ref avoids stale-closure bugs
  // without making every callback depend on the whole transcript.
  const turnsRef = useRef<Turn[]>(turns);
  turnsRef.current = turns;

  const contextRef = useRef(context);
  contextRef.current = context;

  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;

      const history: AssistantTurn[] = turnsRef.current.map(({ role, content }) => ({ role, content }));
      setTurns((prev) => [...prev, { id: newId(), role: 'user', content: message }]);
      setDraft('');
      setSending(true);
      setError(null);

      try {
        const { reply } = await api.assist(message, history, contextRef.current);
        setTurns((prev) => [...prev, { id: newId(), role: 'assistant', content: reply }]);
        if (speakReplies) synthesis.speak(reply);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      } finally {
        setSending(false);
      }
    },
    [sending, speakReplies, synthesis],
  );

  /* ---- Mic: dictation path ---- */

  function toggleDictation() {
    if (recognition.listening) {
      recognition.stop();
      const spoken = `${recognition.transcript} ${recognition.interim}`.trim();
      recognition.reset();
      if (spoken) void send(spoken);
      return;
    }
    // Stop the assistant mid-sentence when interrupted — talking over the user
    // also means the mic picks up our own voice.
    synthesis.cancel();
    recognition.reset();
    recognition.start();
  }

  /* ---- Mic: record-and-upload path ---- */

  const { stream, start: startStream, stop: stopStream, error: streamError } = useMediaStream({
    audio: true,
  });

  const handleClip = useCallback(
    async (clip: { blob: Blob }) => {
      stopStream();
      setSending(true);
      setError(null);
      try {
        const { text } = await api.transcribe(clip.blob);
        await send(text);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't transcribe that clip.");
      } finally {
        setSending(false);
      }
    },
    [send, stopStream],
  );

  const clipRecorder = useMediaRecorder({ kind: 'audio', onComplete: handleClip });

  async function toggleClipRecording() {
    if (clipRecorder.state !== 'idle') {
      clipRecorder.stop();
      return;
    }
    synthesis.cancel();
    const next = stream ?? (await startStream());
    if (next) clipRecorder.start(next);
  }

  const listening = micMode === 'recognition' ? recognition.listening : clipRecorder.state !== 'idle';

  function handleMic() {
    if (micMode === 'recognition') toggleDictation();
    else if (micMode === 'upload') void toggleClipRecording();
  }

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, recognition.interim]);

  const liveText = `${recognition.transcript} ${recognition.interim}`.trim();
  const problem = error ?? recognition.error ?? streamError ?? clipRecorder.error;

  return (
    <section className="flex h-full flex-col bg-paper-50">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-500 text-white">
            <SparkIcon width={16} height={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">Atmosphere</p>
            <p className="truncate text-xs text-ink-500">Context: {contextLabel}</p>
          </div>
        </div>

        <button
          onClick={() => {
            if (speakReplies) synthesis.cancel();
            setSpeakReplies((prev) => !prev);
          }}
          disabled={!synthesis.supported}
          aria-pressed={speakReplies && synthesis.supported}
          title={speakReplies ? 'Replies are spoken aloud' : 'Replies are silent'}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
            speakReplies && synthesis.supported
              ? 'border-brand-200 bg-brand-50 text-brand-700'
              : 'border-line bg-paper-0 text-ink-500 hover:bg-paper-100'
          }`}
        >
          <SpeakerIcon width={14} height={14} />
          {speakReplies ? 'Speaking' : 'Muted'}
        </button>
      </header>

      {!assistantAvailable && (
        <p className="border-b border-caution-200 bg-caution-50 px-4 py-2 text-xs leading-relaxed text-caution-600">
          No assistant model is configured, so replies come from a small built-in responder.
          Dictation, recording, and detection are unaffected.
        </p>
      )}

      <div ref={scrollRef} className="cx-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && !liveText && (
          <div className="rounded-lg border border-dashed border-line-strong bg-paper-0 px-4 py-6 text-center">
            <p className="text-sm text-ink-600">Ask about the job, or dictate a note.</p>
            <p className="mt-1 text-xs text-ink-400">
              {micMode === 'none'
                ? 'This browser has no dictation — type instead.'
                : 'Hit the mic, say your piece, hit it again.'}
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <p
              className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                turn.role === 'user'
                  ? 'rounded-br-sm bg-brand-500 text-white'
                  : 'rounded-bl-sm glass-card text-ink-800 shadow-card'
              }`}
            >
              {turn.content}
            </p>
          </div>
        ))}

        {/* Live captions while dictating, so the user can see it heard them. */}
        {liveText && (
          <div className="flex justify-end">
            <p className="max-w-[90%] rounded-2xl rounded-br-sm border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm italic leading-relaxed text-brand-700">
              {liveText}
            </p>
          </div>
        )}

        {sending && (
          <div className="flex justify-start">
            <span className="flex items-center gap-2 rounded-2xl rounded-bl-sm glass-card px-3.5 py-2.5 text-sm text-ink-500 shadow-card">
              <SpinnerIcon className="animate-spin text-brand-500" width={15} height={15} />
              Thinking…
            </span>
          </div>
        )}
      </div>

      {problem && (
        <p role="alert" className="border-t border-danger-200 bg-danger-50 px-4 py-2 text-xs text-danger-700">
          {problem}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="border-t border-line px-3 py-3"
      >
        <div
          className={`flex items-center gap-2 rounded-xl border bg-paper-0 px-2 py-1.5 shadow-card transition ${
            listening ? 'border-brand-400' : 'border-line'
          }`}
        >
          {micMode !== 'none' && (
            <button
              type="button"
              onClick={handleMic}
              aria-pressed={listening}
              aria-label={listening ? 'Stop listening and send' : 'Start listening'}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                listening
                  ? 'animate-pulse bg-danger-600 text-white'
                  : 'text-ink-500 hover:bg-paper-100 hover:text-ink-800'
              }`}
            >
              {listening ? <StopIcon width={15} height={15} /> : <MicIcon width={17} height={17} />}
            </button>
          )}

          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={listening ? 'Listening…' : 'Ask Atmosphere about this job…'}
            disabled={listening}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink-900 placeholder-ink-400 outline-none disabled:opacity-70"
          />

          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-paper-300 disabled:text-ink-400"
          >
            <ArrowUpIcon width={16} height={16} />
          </button>
        </div>

        <p className="mt-2 px-1 text-[11px] leading-snug text-ink-400">
          Replies are short because they get read aloud. Recordings stay on this device.
        </p>
      </form>
    </section>
  );
}
