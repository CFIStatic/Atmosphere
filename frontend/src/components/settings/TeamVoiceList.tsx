import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';

export type TeamVoicePerson = {
  userId: string;
  fullName: string | null;
  email: string | null;
  consentStatus: 'enrolled' | 'pending' | 'revoked' | 'none';
  consentedAt: string | null;
  crossCompanyOptIn: boolean;
  pendingRequestId: string | null;
};

const STATUS: Record<TeamVoicePerson['consentStatus'], string> = {
  enrolled: 'Enrolled',
  pending: 'Pending their confirmation',
  revoked: 'Revoked',
  none: 'Not enrolled',
};

type Props = {
  preview?: TeamVoicePerson[];
  currentUserId?: string;
};

export function TeamVoiceList({ preview, currentUserId }: Props) {
  const [people, setPeople] = useState<TeamVoicePerson[]>(preview ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    const load = (api as { voiceTeam?: () => Promise<{ people: TeamVoicePerson[] }> }).voiceTeam;
    if (!load) return;
    void load()
      .then((res) => setPeople(res.people))
      .catch(() => undefined);
  }, [preview]);

  async function request(userId: string) {
    setError(null);
    if (preview) {
      setPeople((rows) =>
        rows.map((row) => (row.userId === userId ? { ...row, consentStatus: 'pending' } : row)),
      );
      return;
    }
    try {
      await api.requestVoiceEnrollment(userId);
      setPeople((rows) =>
        rows.map((row) => (row.userId === userId ? { ...row, consentStatus: 'pending' } : row)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
    }
  }

  if (!preview && !(api as { voiceTeam?: unknown }).voiceTeam && people.length === 0) return null;

  return (
    <section className="rounded-xl glass-card p-5 sm:p-6" data-testid="team-voice-list">
      <h2 className="text-base font-semibold text-ink-900">Team voices</h2>
      <p className="mt-1 text-sm text-ink-600">
        Consent status for this company. A teammate is enrolled only after they confirm from their own account. Embeddings are not shown here.
      </p>
      <ul className="mt-4 divide-y divide-line/70">
        {people.map((person) => (
          <li key={person.userId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="team-voice-row">
            <div>
              <p className="text-sm font-medium text-ink-900">{person.fullName || person.email || 'Teammate'}</p>
              <p className="text-xs text-ink-500" data-testid="team-voice-status">
                {STATUS[person.consentStatus]}
                {person.consentStatus === 'enrolled' && person.crossCompanyOptIn ? ' · cross-company on' : ''}
                {person.consentedAt ? ` · ${new Date(person.consentedAt).toLocaleString()}` : ''}
              </p>
            </div>
            {person.userId !== currentUserId && person.consentStatus === 'none' ? (
              <button
                type="button"
                onClick={() => void request(person.userId)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-800"
                data-testid="team-voice-request"
              >
                Request enrollment
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
