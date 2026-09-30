import { useState } from 'react';
import {
  SPEAKER_ROLES,
  factSpeakerLabel,
  uiSpeakerLabel,
  type RoleGuessStatus,
  type SpeakerRole,
} from '../../lib/speakerIdentity';

export type ClipSpeaker = {
  speakerLabel: string;
  confirmedName?: string | null;
  role?: SpeakerRole | null;
  roleStatus?: RoleGuessStatus | null;
  quote?: string | null;
  tSec?: number | null;
};

type Props = {
  speaker: ClipSpeaker;
  onSave: (input: { speakerLabel: string; displayName?: string; role?: SpeakerRole }) => void;
};

/**
 * Clip control for a diarized speaker. The visible label may include a role
 * guess. The fact label underneath is what evidence and exports keep.
 */
export function SpeakerRenameControl({ speaker, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(speaker.confirmedName ?? '');
  // A tentative guess stays a guess until the office explicitly picks a role.
  const [role, setRole] = useState<SpeakerRole | ''>('');
  const ui = uiSpeakerLabel({
    speakerLabel: speaker.speakerLabel,
    confirmedName: speaker.confirmedName,
    role: speaker.confirmedName ? null : speaker.role,
    roleStatus: speaker.roleStatus,
  });
  const fact = factSpeakerLabel({ speakerLabel: speaker.speakerLabel, confirmedName: speaker.confirmedName });

  return (
    <div className="rounded-lg border border-line/80 bg-white/70 px-3 py-2" data-testid="speaker-rename">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink-900" data-testid="speaker-ui-label">
            {ui}
          </p>
          {ui !== fact ? (
            <p className="text-[11px] text-ink-500" data-testid="speaker-fact-label">
              Evidence keeps {fact}
              {speaker.roleStatus === 'tentative' ? ' until you confirm a name.' : '.'}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-800"
          data-testid="speaker-correct"
          onClick={() => setOpen((value) => !value)}
        >
          Correct speaker
        </button>
      </div>
      {open ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              speakerLabel: speaker.speakerLabel,
              displayName: name.trim() || undefined,
              role: role || undefined,
            });
            setOpen(false);
          }}
        >
          <label className="text-xs text-ink-600">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 block rounded-md border border-line bg-paper-50 px-2 py-1.5 text-sm text-ink-900"
              data-testid="speaker-rename-name"
            />
          </label>
          <label className="text-xs text-ink-600">
            Role guess
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as SpeakerRole | '')}
              className="mt-1 block rounded-md border border-line bg-paper-50 px-2 py-1.5 text-sm text-ink-900"
              data-testid="speaker-rename-role"
            >
              <option value="">Unchanged</option>
              {SPEAKER_ROLES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-paper-0" data-testid="speaker-rename-save">
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}
