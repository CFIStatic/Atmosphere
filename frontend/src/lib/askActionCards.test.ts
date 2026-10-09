import { describe, expect, it } from 'vitest';
import { askActionCards } from './askActionCards';

const ids = (question: string, answer: string) => askActionCards({ question, answer }).map((c) => c.id);

describe('askActionCards', () => {
  it('offers a punch list when work is left, and to text the crew when someone has to come back', () => {
    expect(
      ids('What is left on the kitchen?', 'Two items are still outstanding: the base trim is not installed and the crew has to come back Tuesday to patch the drywall. ⟦followups: a? ;; b?⟧'),
    ).toEqual(['punch', 'text-crew']);
  });

  it('offers a homeowner update when the work is finished', () => {
    expect(ids('Are we done drying?', 'Yes. The moisture readings on Oct 3 were all under 15%, so drying is finished and the equipment came out that afternoon.')).toEqual(['homeowner']);
  });

  it('offers Computer for portal and supplier work, as a prefill the person finishes', () => {
    const cards = askActionCards({ question: 'What materials do we need?', answer: 'The materials list from the walkthrough is 12 sheets of drywall, 3 boxes of screws and 2 buckets of mud. You can order the materials from the supplier portal.' });
    expect(cards.map((c) => c.id)).toContain('computer');
    expect(cards.find((c) => c.id === 'computer')?.mode).toBe('prefill');
  });

  it('nothing for small talk, failures, or a Computer task answer', () => {
    expect(ids('thanks', 'You are welcome.')).toEqual([]);
    expect(ids('What did the adjuster say?', 'That is not on the file. No clips from the adjuster visit were uploaded, so there is nothing to quote yet from that meeting.')).toEqual([]);
    expect(ids('Order drywall', 'Computer is on it: it opened the supplier portal and is filling in the order now. ⟦actions: start_computer_task|x⟧')).toEqual([]);
  });

  it('never more than three', () => {
    const answer = 'The crew has to come back tomorrow: trim is still not installed, the homeowner wants an update, and the claim form on the carrier portal needs the new photos.';
    expect(askActionCards({ question: 'status?', answer }).length).toBeLessThanOrEqual(3);
  });
});
