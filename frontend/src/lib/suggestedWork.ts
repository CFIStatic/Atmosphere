/**
 * Handing an approved suggestion to Job Chat.
 *
 * Approve returns the prompt; the job file's Chat sends it as the person's
 * own request, so Chat's usual routing applies (Computer for Xactimate and
 * CRM work, which still stops at its own Approve before anything is saved or
 * submitted). The prompt waits in sessionStorage when the Chat panel is not
 * mounted yet (approving from the queue opens the job file first).
 */
export const SUGGESTED_WORK_ASK_EVENT = 'atmosphere:suggested-work-ask';

const key = (jobId: string) => `atm:suggested-work-ask:${jobId}`;

export function queueSuggestedAsk(jobId: string, prompt: string): void {
  try {
    sessionStorage.setItem(key(jobId), prompt);
  } catch {
    // Private mode: the event below still reaches a mounted panel.
  }
  window.dispatchEvent(new CustomEvent(SUGGESTED_WORK_ASK_EVENT, { detail: { jobId } }));
}

/** The waiting prompt for this job, removed as it is read so it is sent once. */
export function takeSuggestedAsk(jobId: string): string | null {
  try {
    const text = sessionStorage.getItem(key(jobId));
    if (text) sessionStorage.removeItem(key(jobId));
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}
