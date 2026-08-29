import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldCaptureInvitePath,
  fieldCaptureInviteUrl,
} from '../src/verifier/deliverPartyInvite.js';
import { LIVE_FIELD_CAPTURE_ORIGIN } from '../src/lib/publicAppOrigin.js';

test('Field Capture invite links keep the job-share token on web and phone', () => {
  assert.equal(
    fieldCaptureInvitePath('abc/def'),
    '/fieldcapture/index.html?token=abc%2Fdef',
  );
  assert.equal(
    fieldCaptureInviteUrl('tok123'),
    `${LIVE_FIELD_CAPTURE_ORIGIN}/?token=tok123`,
  );
});
