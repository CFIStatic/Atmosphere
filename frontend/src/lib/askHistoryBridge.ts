/**
 * Bridges Ask chat history between the job-file React panel and the verifier
 * left rail (Videos section). Uses the same postMessage channel as the rest of
 * the operations shell — no new chrome.
 */

import type { AskThread } from './api';

export const ASK_HISTORY_EVENT = 'atmosphere-ask-history';
export const ASK_HISTORY_ACTION = 'atmosphere-ask-history-action';

export type AskHistoryPayload = {
  jobId: string;
  threads: AskThread[];
  activeThreadId: string | null;
};

export type AskHistoryAction =
  | { type: 'new-chat'; jobId: string }
  | { type: 'select-thread'; jobId: string; threadId: string };

export function publishAskHistory(payload: AskHistoryPayload) {
  window.dispatchEvent(new CustomEvent(ASK_HISTORY_EVENT, { detail: payload }));
}

export function onAskHistory(handler: (payload: AskHistoryPayload) => void): () => void {
  const fn = (event: Event) => {
    const detail = (event as CustomEvent<AskHistoryPayload>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(ASK_HISTORY_EVENT, fn);
  return () => window.removeEventListener(ASK_HISTORY_EVENT, fn);
}

export function publishAskHistoryAction(action: AskHistoryAction) {
  window.dispatchEvent(new CustomEvent(ASK_HISTORY_ACTION, { detail: action }));
}

export function onAskHistoryAction(handler: (action: AskHistoryAction) => void): () => void {
  const fn = (event: Event) => {
    const detail = (event as CustomEvent<AskHistoryAction>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(ASK_HISTORY_ACTION, fn);
  return () => window.removeEventListener(ASK_HISTORY_ACTION, fn);
}
