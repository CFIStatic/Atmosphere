import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Talking to the user, and listening back.
 *
 * Two very different maturity levels live here:
 *
 * - **Speech synthesis** is universally supported and works offline. It is the
 *   whole of the "talk back at users" half, no server involved.
 * - **Speech recognition** is Chrome/Edge only. Safari and Firefox ship nothing
 *   usable, and those are half the phones on a job site — so `recognitionSupported`
 *   exists to let the caller fall back to recording a clip and posting it to
 *   `/api/technician/transcribe` instead.
 */

/* ---- Minimal Web Speech typings (not in lib.dom) ---- */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/* ---- Listening ---- */

interface UseSpeechRecognition {
  supported: boolean;
  listening: boolean;
  /** Text confirmed by the engine so far this session. */
  transcript: string;
  /** The words still being revised — render these greyed out. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(lang = 'en-US'): UseSpeechRecognition {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getRecognitionCtor() !== null;

  // Distinguishes "the engine stopped on its own after a pause" (restart it)
  // from "the user pressed stop" (leave it alone).
  const wantsToListenRef = useRef(false);

  const stop = useCallback(() => {
    wantsToListenRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('This browser cannot listen. Record a clip instead and it will be transcribed.');
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    // Continuous + interim results give live captions rather than one lump of
    // text at the end, which is what makes the mic feel responsive.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = '';
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += text;
        else pending += text;
      }
      if (finalText) setTranscript((prev) => (prev ? `${prev} ${finalText.trim()}` : finalText.trim()));
      setInterim(pending);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return; // benign
      wantsToListenRef.current = false;
      setError(
        event.error === 'not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings.'
          : "Couldn't hear you clearly. Try again.",
      );
      setListening(false);
    };

    recognition.onend = () => {
      // Chrome stops after a few seconds of silence; restart so a technician
      // gathering their thoughts mid-sentence doesn't lose the mic.
      if (wantsToListenRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* already starting — fall through and reset */
        }
      }
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;
    wantsToListenRef.current = true;
    setError(null);
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      wantsToListenRef.current = false;
      setError("Couldn't start the microphone.");
    }
  }, [lang]);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      wantsToListenRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, transcript, interim, error, start, stop, reset };
}

/* ---- Speaking ---- */

interface UseSpeechSynthesis {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
}

export function useSpeechSynthesis(lang = 'en-US'): UseSpeechSynthesis {
  const [speaking, setSpeaking] = useState(false);
  const supported = synthesisSupported();

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;

      // Cancel anything already queued — the newest reply is the relevant one,
      // and stacked utterances talk over each other.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1.02; // marginally brisk; full speed sounds sluggish aloud
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [supported, lang],
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // Don't keep talking after the user navigates away.
  useEffect(() => {
    return () => {
      if (synthesisSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return { supported, speaking, speak, cancel };
}
