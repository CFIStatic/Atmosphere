import { describe, expect, it } from 'vitest';
import { displaySpeakerLabel, sanitizeSpeakerProse } from './speakerLabel';

describe('displaySpeakerLabel', () => {
  it('renders a stored Person N label as Speaker N with no parenthesis or role', () => {
    for (const raw of [
      'Person 1 (Seated, Unknown Role)',
      'Person 1 (Seated',
      'Person 2 (Standing, Homeowner)',
      'SPEAKER_00',
      'Speaker 2',
    ]) {
      const shown = displaySpeakerLabel(raw);
      expect(shown).toMatch(/^Speaker \d+$/);
      expect(shown).not.toMatch(/\(|\)|Seated|Homeowner|Unknown|Role|standing/i);
    }
    expect(displaySpeakerLabel('Person 1 (Seated, Unknown Role)')).toBe('Speaker 1');
    expect(displaySpeakerLabel('Person 1 (Seated')).toBe('Speaker 1');
    expect(displaySpeakerLabel('SPEAKER_00')).toBe('Speaker 1');
  });

  it('does not invent a role, posture, or relationship', () => {
    expect(displaySpeakerLabel('Seated man')).toBe('Unidentified speaker');
    expect(displaySpeakerLabel('homeowner')).toBe('Unidentified speaker');
    expect(displaySpeakerLabel('the contractor')).toBe('Unidentified speaker');
    expect(displaySpeakerLabel('Unknown')).toBe('Unidentified speaker');
  });
});

describe('sanitizeSpeakerProse', () => {
  it('rewrites stored labels in answer text and leaves no open parenthesis', () => {
    const cleaned = sanitizeSpeakerProse(
      'Person 1 (Seated said the binder is full. The seated man agreed. **Bold** stays.',
    );
    expect(cleaned).toContain('Speaker 1 said the binder is full.');
    expect(cleaned).toContain('An unidentified speaker agreed');
    expect(cleaned).not.toMatch(/\(|Person \d|Seated/);
    expect(cleaned).toContain('**Bold**');
  });
});
