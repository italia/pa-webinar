import { describe, it, expect } from 'vitest';

import {
  signWebhookBody,
  verifyWebhookSignature,
} from './webhook-signature';

describe('webhook signature', () => {
  const secret = 'a'.repeat(32);
  const body = '{"roomName":"event-42","recordingUrl":"https://x/y.mp4"}';

  it('round-trips a signed body', () => {
    const sig = signWebhookBody(body, secret);
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('rejects a body tampered after signing', () => {
    const sig = signWebhookBody(body, secret);
    expect(verifyWebhookSignature(body + ' ', sig, secret)).toBe(false);
  });

  it('rejects a signature signed with a different secret', () => {
    const sig = signWebhookBody(body, 'b'.repeat(32));
    expect(verifyWebhookSignature(body, sig, secret)).toBe(false);
  });

  it('rejects when the header is missing', () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects malformed signature headers', () => {
    expect(verifyWebhookSignature(body, 'sha256=zz', secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'md5=abc', secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=', secret)).toBe(false);
  });
});
