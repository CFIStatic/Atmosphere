import { useState } from 'react';
import { SPEAKER_ROLES, type SpeakerRole } from '../../lib/speakerIdentity';

export type SpeakerVerification = {
  id: string;
  proofId: string;
  question: string;
  speakerLabel: string;
  clipTitle: string;
  tSec: number | null;
  candidateName: string | null;
  role: SpeakerRole | null;
  quote: string | null;
};

type Props = {
  verification: SpeakerVerification;
  onAnswer: (input: { id: string; answer: 'yes' | 'no' | 'other'; displayName?: string; role?: SpeakerRole }) => void;
};

/** Proactive Ask check. Yes / No / Someone else. The quote stays verbatim. */
export function SpeakerVerificationPrompt({ verification, onAnswer }: Props) {
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<SpeakerRole | ''>('');

  return (
    <div className="rounded-2xl border border-line bg-paper-0 px-3.5 py-3 text-sm text-ink-800 shadow-card" data-testid="speaker-verification">
      <p className="font-medium text-ink-900" data-testid="speaker-verification-question">
        {verification.question}
      </p>
      {verification.quote ? (
        <p className="mt-1 text-xs italic text-ink-500">Exact: “{verification.quote}”</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full bg-ink-900 px-3 py-1.5 text-sm font-semibold text-paper-0"
          data-testid="speaker-verify-yes"
          onClick={() => onAnswer({ id: verification.id, answer: 'yes' })}
        >
          Yes
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-800"
          data-testid="speaker-verify-no"
          onClick={() => onAnswer({ id: verification.id, answer: 'no' })}
        >
          No
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-800"
          data-testid="speaker-verify-other"
          onClick={() => setOther(true)}
        >
          Someone else
        </button>
      </div>
      {other ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() && !role) return;
            onAnswer({
              id: verification.id,
              answer: 'other',
              displayName: name.trim() || undefined,
              role: role || undefined,
            });
          }}
        >
          <label className="text-xs text-ink-600">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 block rounded-md border border-line bg-paper-50 px-2 py-1.5 text-sm text-ink-900"
              data-testid="speaker-verify-name"
            />
          </label>
          <label className="text-xs text-ink-600">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as SpeakerRole | '')}
              className="mt-1 block rounded-md border border-line bg-paper-50 px-2 py-1.5 text-sm text-ink-900"
              data-testid="speaker-verify-role"
            >
              <option value="">No role change</option>
              {SPEAKER_ROLES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-ink-900">
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}
