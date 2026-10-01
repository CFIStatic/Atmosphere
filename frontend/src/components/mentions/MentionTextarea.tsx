import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MutableRefObject, type Ref } from 'react';
import { PersonAvatar } from '../PersonAvatar';
import {
  filterMentionMembers,
  mentionDisplayName,
  mentionQueryAt,
  mentionToken,
  type MentionMember,
} from '../../lib/mentions';
import { useOrgMentions } from './useOrgMentions';

function assignRef(ref: Ref<HTMLTextAreaElement> | undefined, node: HTMLTextAreaElement | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  (ref as MutableRefObject<HTMLTextAreaElement | null>).current = node;
}

/**
 * Textarea that opens an org-member menu at `@`.
 * Inserts `@Full Name`. The parent stores the user id when the message is sent.
 * Two people with the same name get the id token immediately.
 */
export function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  onPaste,
  inputRef,
  className,
  placeholder,
  disabled,
  rows = 1,
  autoGrow = false,
  jobId = null,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  autoGrow?: boolean;
  /** When set, the menu lists only people on this job. */
  jobId?: string | null;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<{ start: number; end: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const open = query != null;
  const members = useOrgMentions(open, jobId);
  const options = open ? filterMentionMembers(members, query.query) : [];

  useEffect(() => {
    if (!autoGrow) return;
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value, autoGrow]);

  function syncQuery(text: string, cursor: number) {
    const next = mentionQueryAt(text, cursor, members);
    setQuery(next);
    setHighlight(0);
  }

  function insert(member: MentionMember) {
    if (!query) return;
    const name = mentionDisplayName(member);
    const sameName = members.filter(
      (row) => mentionDisplayName(row).toLowerCase() === name.toLowerCase(),
    );
    const inserted = sameName.length > 1 ? mentionToken(name, member.userId) : `@${name}`;
    const before = value.slice(0, query.start);
    const after = value.slice(query.end);
    const spacer = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';
    const next = `${before}${inserted}${spacer}${after}`;
    onChange(next);
    setQuery(null);
    const caret = before.length + inserted.length + spacer.length;
    requestAnimationFrame(() => {
      const el = localRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insert(options[highlight] ?? options[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={(node) => {
          localRef.current = node;
          assignRef(inputRef, node);
        }}
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          syncQuery(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onClick={(event) => syncQuery(value, event.currentTarget.selectionStart ?? value.length)}
        onBlur={() => {
          window.setTimeout(() => setQuery(null), 140);
        }}
      />
      {open && (
        <ul
          data-testid="mention-menu"
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full min-w-[16rem] overflow-auto rounded-xl border border-line bg-paper-0 py-1 shadow-card"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-500">No people in this company match.</li>
          ) : (
            options.map((member, index) => (
              <li key={member.userId}>
                <button
                  type="button"
                  role="option"
                  data-testid="mention-option"
                  data-user-id={member.userId}
                  aria-selected={index === highlight}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === highlight ? 'bg-brand-50 text-ink-900' : 'text-ink-800 hover:bg-paper-50'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insert(member);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <PersonAvatar
                    fullName={mentionDisplayName(member)}
                    avatarUrl={member.avatarUrl}
                    size="xs"
                    className="h-6 w-6 text-[10px]"
                  />
                  <span className="font-semibold">{mentionDisplayName(member)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
