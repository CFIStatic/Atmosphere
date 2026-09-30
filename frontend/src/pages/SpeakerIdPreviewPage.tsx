import { useState } from 'react';
import { VoiceEnrollmentCard } from '../components/settings/VoiceEnrollmentCard';
import { TeamVoiceList } from '../components/settings/TeamVoiceList';
import { SpeakerVerificationPrompt } from '../components/ask/SpeakerVerificationPrompt';
import { SpeakerRenameControl } from '../components/analysis/SpeakerRenameControl';
import { verificationQuestion, type RoleGuessStatus } from '../lib/speakerIdentity';

const QUESTION = verificationQuestion({
  speakerLabel: 'Speaker 2',
  clipTitle: 'North slope walkthrough',
  tSec: 42,
  candidateName: 'Marco',
});

/**
 * Synthetic office surfaces for speaker identification. No job media.
 * Dev-only route so screenshots do not need a signed-in company.
 */
export function SpeakerIdPreviewPage() {
  const [answered, setAnswered] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [clipSpeaker, setClipSpeaker] = useState({
    speakerLabel: 'Speaker 3',
    confirmedName: null as string | null,
    role: 'homeowner' as const,
    roleStatus: 'tentative' as RoleGuessStatus,
    quote: 'my house',
    tSec: 65,
  });
  return (
    <div className="min-h-screen bg-paper-100">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Settings</h1>
          <p className="mt-1 text-sm text-ink-600">Account · synthetic preview</p>
        </header>
        <div data-testid="preview-enrollment">
          <VoiceEnrollmentCard />
        </div>
        <div data-testid="preview-enrolled">
          <VoiceEnrollmentCard
            preview={{
              state: {
                enrolled: true,
                consentedAt: '2026-09-29T15:04:00.000Z',
                crossCompanyOptIn: false,
              },
              pendingRequests: [{ id: 'req-1', requester_user_id: 'user-alex', status: 'pending' }],
            }}
          />
        </div>
        <div data-testid="preview-team">
          <TeamVoiceList
            currentUserId="user-1"
            preview={[
              {
                userId: 'user-1',
                fullName: 'Alex Rivera',
                email: 'alex@example.com',
                consentStatus: 'enrolled',
                consentedAt: '2026-09-29T15:04:00.000Z',
                crossCompanyOptIn: false,
                pendingRequestId: null,
              },
              {
                userId: 'user-2',
                fullName: 'Marco Diaz',
                email: 'marco@example.com',
                consentStatus: 'pending',
                consentedAt: null,
                crossCompanyOptIn: false,
                pendingRequestId: 'req-2',
              },
              {
                userId: 'user-3',
                fullName: 'Priya Shah',
                email: 'priya@example.com',
                consentStatus: 'revoked',
                consentedAt: null,
                crossCompanyOptIn: false,
                pendingRequestId: null,
              },
              {
                userId: 'user-4',
                fullName: 'Jonah Ellis',
                email: 'jonah@example.com',
                consentStatus: 'none',
                consentedAt: null,
                crossCompanyOptIn: false,
                pendingRequestId: null,
              },
            ]}
          />
        </div>
        <section className="rounded-xl glass-card p-5" aria-label="Ask this job" data-testid="preview-ask">
          <h2 className="text-base font-semibold text-ink-900">Chat</h2>
          <p className="mt-1 text-sm text-ink-600">Forgot something? Ask what happened on site or what was said.</p>
          <div className="mt-4">
            {answered ? (
              <p className="text-sm text-ink-700" data-testid="preview-ask-result">
                Saved: {answered}
              </p>
            ) : (
              <SpeakerVerificationPrompt
                verification={{
                  id: 'v1',
                  proofId: 'clip-1',
                  question: QUESTION,
                  speakerLabel: 'Speaker 2',
                  clipTitle: 'North slope walkthrough',
                  tSec: 42,
                  candidateName: 'Marco',
                  role: null,
                  quote: "I'm Marco",
                }}
                onAnswer={(input) => setAnswered(input.answer === 'other' ? input.displayName || input.role || 'other' : input.answer)}
              />
            )}
          </div>
        </section>
        <section className="rounded-xl glass-card p-5" data-testid="preview-clip">
          <h2 className="text-base font-semibold text-ink-900">North slope walkthrough</h2>
          <p className="mt-1 text-xs text-ink-500">Synthetic clip · no recording</p>
          <div className="mt-4">
            <SpeakerRenameControl
              speaker={clipSpeaker}
              onSave={(input) => {
                setClipSpeaker((current) => ({
                  ...current,
                  confirmedName: input.displayName ?? current.confirmedName,
                  roleStatus: input.role ? 'corrected' : current.roleStatus,
                }));
                setSaved(input.displayName || input.role || 'saved');
              }}
            />
            {saved ? <p className="mt-2 text-sm text-ink-700">Corrected to {saved}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
