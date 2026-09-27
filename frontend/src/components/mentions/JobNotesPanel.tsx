import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type SharedJobRecord } from '../../lib/api';
import { expandMentionTokens } from '../../lib/mentions';
import { MentionText } from './MentionText';
import { MentionTextarea } from './MentionTextarea';
import { loadOrgMentions } from './useOrgMentions';

/**
 * Job-file notes. @tags use the same org autocomplete as Ask, and the posted
 * body is indexed so later @questions can find them.
 */
export function JobNotesPanel({
  jobId,
  messages,
  onPosted,
}: {
  jobId: string;
  messages: SharedJobRecord['messages'];
  onPosted: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const raw = draft.trim();
    if (!raw || posting) return;
    setPosting(true);
    setError(null);
    try {
      const members = raw.includes('@') ? await loadOrgMentions(jobId) : [];
      const body = expandMentionTokens(raw, members);
      await api.postJobMessage(jobId, { body });
      setDraft('');
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that note.');
    } finally {
      setPosting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section className="rounded-xl glass-card p-5" data-testid="job-notes">
      <h2 className="text-base font-semibold text-ink-900">Notes</h2>
      <p className="mt-1 text-sm text-ink-500">
        Tag a teammate with @ so Ask can find every note that names them.
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-3 flex items-end gap-2">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          onKeyDown={onKeyDown}
          rows={2}
          jobId={jobId}
          placeholder="Add a note… @someone to tag them"
          disabled={posting}
          className="w-full resize-none rounded-xl border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={posting || !draft.trim()}
          className="rounded-full bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          Post
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      {messages.length > 0 && (
        <ul className="mt-4 space-y-2">
          {messages.map((message) => (
            <li key={message.id} className="rounded-lg border border-line px-3 py-2">
              <p className="text-[11px] font-medium text-ink-500">{message.author_label}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-800">
                <MentionText text={message.body} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
