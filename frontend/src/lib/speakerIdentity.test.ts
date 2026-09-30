import { describe, expect, it } from 'vitest';
import { factSpeakerLabel, uiSpeakerLabel, verificationQuestion, VOICE_CONSENT_TEXT } from './speakerIdentity';
import { sanitizeSpeakerProse } from './speakerLabel';

describe('speaker identity labels', () => {
  it('asks with the clip and timestamp', () => {
    expect(
      verificationQuestion({
        speakerLabel: 'Speaker 2',
        clipTitle: 'North slope walkthrough',
        tSec: 42,
        candidateName: 'Marco',
      }),
    ).toBe('Is Speaker 2 in North slope walkthrough at 0:42 Marco?');
  });

  it('marks a role as a guess and closes the parenthesis', () => {
    const label = uiSpeakerLabel({ speakerLabel: 'Speaker 3', role: 'homeowner', roleStatus: 'tentative' });
    expect(label).toBe('Speaker 3 (likely homeowner)');
    expect(label.split('(').length).toBe(label.split(')').length);
    expect(factSpeakerLabel({ speakerLabel: 'Speaker 3' })).toBe('Speaker 3');
  });

  it('shows a confirmed name and drops the guess', () => {
    expect(uiSpeakerLabel({ speakerLabel: 'Speaker 3', confirmedName: 'Marco', role: 'homeowner', roleStatus: 'tentative' })).toBe('Marco');
    expect(factSpeakerLabel({ speakerLabel: 'Speaker 3', confirmedName: 'Marco' })).toBe('Marco');
  });

  it('strips a role guess from prose that evidence and exports would keep', () => {
    const cleaned = sanitizeSpeakerProse('Speaker 3 (likely homeowner) said the deductible is open.');
    expect(cleaned).toContain('Speaker 3');
    expect(cleaned).not.toMatch(/likely|homeowner|\(/);
  });

  it('keeps the consent wording stable', () => {
    expect(VOICE_CONSENT_TEXT).toMatch(/deletes the voiceprint/);
    expect(VOICE_CONSENT_TEXT).toMatch(/cross-company matching/);
  });
});
