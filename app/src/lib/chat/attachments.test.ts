import { describe, it, expect } from 'vitest';

import { assetUrlFromKey, CHAT_ATTACHMENT_MIME } from './attachments';

describe('assetUrlFromKey', () => {
  it('maps a storage key to the relative asset-serving URL', () => {
    expect(assetUrlFromKey('assets/image/2026/07/uuid-pic.png')).toBe(
      '/api/assets/image/2026/07/uuid-pic.png',
    );
  });
  it('tolerates a key without the assets/ prefix', () => {
    expect(assetUrlFromKey('document/x.pdf')).toBe('/api/assets/document/x.pdf');
  });
});

describe('CHAT_ATTACHMENT_MIME', () => {
  it('allows images + pdf, not svg or office/archives', () => {
    expect(CHAT_ATTACHMENT_MIME.has('image/png')).toBe(true);
    expect(CHAT_ATTACHMENT_MIME.has('application/pdf')).toBe(true);
    expect(CHAT_ATTACHMENT_MIME.has('image/svg+xml')).toBe(false);
    expect(
      CHAT_ATTACHMENT_MIME.has(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(false);
  });
});
