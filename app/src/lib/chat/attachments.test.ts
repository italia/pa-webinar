import { describe, it, expect } from 'vitest';

import { verifyAssetRead } from './attachment-token';
import { assetUrlFromKey, CHAT_ATTACHMENT_MIME } from './attachments';

// Le chiavi del namespace chat vengono firmate: serve la chiave HMAC.
process.env.APP_SECRET = 'test-app-secret-for-attachments';

const EVT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('assetUrlFromKey', () => {
  it('mappa una chiave PUBBLICA su un URL nudo, senza token', () => {
    expect(assetUrlFromKey('assets/image/2026/07/uuid-pic.png')).toBe(
      '/api/assets/image/2026/07/uuid-pic.png',
    );
  });
  it('tollera una chiave senza il prefisso assets/', () => {
    expect(assetUrlFromKey('document/x.pdf')).toBe('/api/assets/document/x.pdf');
  });
  it('firma un allegato di CHAT con un token di lettura legato al percorso', () => {
    const key = `assets/chat/${EVT}/2026/07/uuid-verbale.pdf`;
    const url = assetUrlFromKey(key);
    expect(url.startsWith(`/api/assets/chat/${EVT}/2026/07/uuid-verbale.pdf?t=`)).toBe(true);
    const t = new URL(url, 'https://x').searchParams.get('t')!;
    // Il token vale per QUESTA chiave e QUESTO evento, non per altri.
    expect(verifyAssetRead(t, key, EVT)).toBe(true);
    expect(verifyAssetRead(t, key + '.altro', EVT)).toBe(false);
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
