import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure helpers extracted from the evidence-download Checkout URL builders so
 * the substitution rules stay covered without standing up Stripe.
 */

function evidenceReturnUrls(
  successTemplate: string,
  cancelTemplate: string,
  token: string,
  downloadId: string,
): { successUrl: string; cancelUrl: string } {
  return {
    successUrl: successTemplate
      .replaceAll('{token}', encodeURIComponent(token))
      .replaceAll('{downloadId}', encodeURIComponent(downloadId)),
    cancelUrl: cancelTemplate
      .replaceAll('{token}', encodeURIComponent(token))
      .replaceAll('{downloadId}', encodeURIComponent(downloadId)),
  };
}

describe('evidence download Stripe return URLs', () => {
  it('substitutes token and download id into both templates', () => {
    const { successUrl, cancelUrl } = evidenceReturnUrls(
      'https://app.example/verifier/?share={token}&checkout=success&download={downloadId}',
      'https://app.example/verifier/?share={token}&checkout=cancelled',
      'tok/with spaces',
      'dl-123',
    );

    assert.equal(
      successUrl,
      'https://app.example/verifier/?share=tok%2Fwith%20spaces&checkout=success&download=dl-123',
    );
    assert.equal(
      cancelUrl,
      'https://app.example/verifier/?share=tok%2Fwith%20spaces&checkout=cancelled',
    );
  });

  it('leaves unrelated placeholders alone', () => {
    const { successUrl } = evidenceReturnUrls(
      'https://app.example/ok?x={other}&d={downloadId}',
      'https://app.example/cancel',
      't',
      'd1',
    );
    assert.equal(successUrl, 'https://app.example/ok?x={other}&d=d1');
  });
});
