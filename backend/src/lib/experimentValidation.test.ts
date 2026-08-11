import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { experimentAssignSchema, experimentEventSchema } from './validation.js';

describe('experiment validation', () => {
  it('accepts a valid assign body', () => {
    const parsed = experimentAssignSchema.parse({ experimentKey: 'intake_cta_copy' });
    assert.equal(parsed.experimentKey, 'intake_cta_copy');
  });

  it('rejects an invalid experiment key', () => {
    assert.throws(() => experimentAssignSchema.parse({ experimentKey: 'Nope!' }));
  });

  it('accepts a conversion event with props', () => {
    const parsed = experimentEventSchema.parse({
      experimentKey: 'intake_cta_copy',
      eventName: 'conversion',
      props: { inviteCount: 2 },
    });
    assert.equal(parsed.eventName, 'conversion');
    assert.equal((parsed.props as { inviteCount: number }).inviteCount, 2);
  });
});
