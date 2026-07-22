import { describe, it, expect } from 'vitest';

import {
  buildAssetKey,
  buildChatAssetKey,
  chatAssetEventId,
  isChatAssetPath,
  sanitizeFilename,
} from './asset-key';

const FIXED_UUID = '11111111-2222-3333-4444-555555555555';
const FIXED_DATE = new Date(Date.UTC(2026, 3, 7, 10, 0, 0)); // 2026-04-07
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('sanitizeFilename', () => {
  it('keeps a basic filename unchanged', () => {
    expect(sanitizeFilename('photo.png')).toBe('photo.png');
  });

  it('replaces spaces and punctuation with hyphens and collapses runs', () => {
    expect(sanitizeFilename('my cool image (final).jpg')).toBe(
      'my-cool-image-final.jpg',
    );
  });

  it('strips emoji and non-ASCII into hyphens while keeping extension', () => {
    const out = sanitizeFilename('party🎉time.mp3');
    expect(out).toBe('party-time.mp3');
  });

  it('does not transliterate — non-ASCII letters are stripped, ext preserved', () => {
    // We intentionally do NOT transliterate: safer than half-correct mappings.
    // Accented characters collapse to a hyphen then get trimmed before the
    // extension separator, leaving a clean stem.
    const out = sanitizeFilename('città.pdf');
    expect(out).toBe('citt.pdf');
  });
});

describe('buildAssetKey', () => {
  it('builds the expected path for a basic filename', () => {
    const key = buildAssetKey('image', 'photo.png', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    expect(key).toBe(`assets/image/2026/04/${FIXED_UUID}-photo.png`);
  });

  it('uses the matching type prefix for audio and document', () => {
    expect(
      buildAssetKey('audio', 'clip.mp3', { uuid: FIXED_UUID, now: FIXED_DATE }),
    ).toBe(`assets/audio/2026/04/${FIXED_UUID}-clip.mp3`);
    expect(
      buildAssetKey('document', 'slides.pdf', {
        uuid: FIXED_UUID,
        now: FIXED_DATE,
      }),
    ).toBe(`assets/document/2026/04/${FIXED_UUID}-slides.pdf`);
  });

  it('strips path-traversal attempts and leaves only the base filename', () => {
    const key = buildAssetKey('document', '../../../etc/passwd', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    // basename is "passwd", no traversal chars survive.
    expect(key).toBe(`assets/document/2026/04/${FIXED_UUID}-passwd`);
    expect(key).not.toContain('..');
    expect(key).not.toContain('etc/passwd');
  });

  it('handles Windows-style backslash paths', () => {
    const key = buildAssetKey('image', 'C:\\Users\\x\\evil.png', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    expect(key).toBe(`assets/image/2026/04/${FIXED_UUID}-evil.png`);
  });

  it('strips emoji-only stems into a safe filename', () => {
    const key = buildAssetKey('image', '🎉🎊.png', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    // Emoji collapse into hyphens then trim — the stem becomes empty, but
    // the extension survives so we keep a meaningful ".png".
    expect(key.startsWith(`assets/image/2026/04/${FIXED_UUID}-`)).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
    expect(key).not.toMatch(/[^\x20-\x7E]/);
  });

  it('truncates long filenames to 60 chars while preserving the extension', () => {
    const longStem = 'a'.repeat(200);
    const key = buildAssetKey('document', `${longStem}.pdf`, {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    const parts = key.split('/');
    const filePart = parts[parts.length - 1] ?? ''; // "<uuid>-<sanitized>"
    const sanitized = filePart.slice(FIXED_UUID.length + 1);
    expect(sanitized.length).toBeLessThanOrEqual(60);
    expect(sanitized.endsWith('.pdf')).toBe(true);
  });

  it('zero-pads single-digit months', () => {
    const jan = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const key = buildAssetKey('image', 'x.png', { uuid: FIXED_UUID, now: jan });
    expect(key).toBe(`assets/image/2026/01/${FIXED_UUID}-x.png`);
  });

  it('falls back to "file" when sanitization strips everything', () => {
    const key = buildAssetKey('image', '!!!', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    expect(key).toBe(`assets/image/2026/04/${FIXED_UUID}-file`);
  });
});

/**
 * Il namespace degli allegati di chat.
 *
 * Non è organizzazione dello storage: è l'unica cosa che permette a
 * /api/assets di negare un documento condiviso in chat lasciando pubblici logo,
 * copertine e materiali. Finché le due famiglie condividevano
 * `assets/image|document/…` la rotta non poteva distinguerle, e la sola difesa
 * di un PDF riservato era che l'UUID non fosse indovinabile — cioè nessuna,
 * appena l'URL usciva dalla stanza.
 */
describe('buildChatAssetKey', () => {
  it('mette il namespace e l’eventId nel percorso', () => {
    expect(
      buildChatAssetKey(EVENT_ID, 'verbale.pdf', {
        uuid: FIXED_UUID,
        now: FIXED_DATE,
      }),
    ).toBe(`assets/chat/${EVENT_ID}/2026/04/${FIXED_UUID}-verbale.pdf`);
  });

  it('sanifica il nome file come gli altri asset (niente traversal nel namespace)', () => {
    const key = buildChatAssetKey(EVENT_ID, '../../../etc/passwd', {
      uuid: FIXED_UUID,
      now: FIXED_DATE,
    });
    // Un `..` sopravvissuto qui uscirebbe dal namespace e quindi dal gate.
    expect(key).toBe(`assets/chat/${EVENT_ID}/2026/04/${FIXED_UUID}-passwd`);
    expect(chatAssetEventId(key.replace(/^assets\//, ''))).toBe(EVENT_ID);
  });

  it('rifiuta un eventId che non è un UUID invece di scrivere una chiave illeggibile', () => {
    // Passare lo slug produrrebbe una chiave che il parser scarta: l'allegato
    // si caricherebbe e smetterebbe di aprirsi, senza errori, in un altro
    // punto del sistema.
    expect(() => buildChatAssetKey('il-caffettino', 'x.pdf')).toThrow();
  });
});

describe('isChatAssetPath / chatAssetEventId', () => {
  const sub = (key: string) => key.replace(/^assets\//, '');

  it('riconosce come protetto solo il namespace chat', () => {
    expect(isChatAssetPath(`chat/${EVENT_ID}/2026/04/${FIXED_UUID}-x.pdf`)).toBe(true);
    // Gli asset pubblici NON devono finire nel ramo protetto: sono già in
    // pagine pubbliche, og:image ed email.
    expect(isChatAssetPath(`image/2026/04/${FIXED_UUID}-logo.png`)).toBe(false);
    expect(isChatAssetPath(`audio/2026/04/${FIXED_UUID}-attesa.mp3`)).toBe(false);
    expect(isChatAssetPath(`document/2026/04/${FIXED_UUID}-slide.pdf`)).toBe(false);
  });

  it('non si fa ingannare da un prefisso che somiglia al namespace', () => {
    // `chatbot/...` non è `chat/...`: senza il separatore un asset pubblico
    // finirebbe dietro il gate di un evento inesistente.
    expect(isChatAssetPath('chatbot/2026/04/x.png')).toBe(false);
    expect(chatAssetEventId('chatbot/2026/04/x.png')).toBeNull();
  });

  it('estrae l’eventId proprietario dal percorso', () => {
    expect(chatAssetEventId(sub(buildChatAssetKey(EVENT_ID, 'a.png')))).toBe(EVENT_ID);
  });

  it('nega per default quando il namespace è protetto ma il percorso è malformato', () => {
    // Chi risponde null qui riceve un 404 dalla rotta: mai un fallback al
    // ramo pubblico, che sarebbe un bypass del gate per variante di percorso.
    expect(chatAssetEventId('chat')).toBeNull();
    expect(chatAssetEventId('chat/')).toBeNull();
    expect(chatAssetEventId('chat/non-un-uuid/2026/04/x.png')).toBeNull();
    expect(chatAssetEventId(`chat/${EVENT_ID}`)).toBeNull();
    expect(chatAssetEventId(`chat/${EVENT_ID}/`)).toBeNull();
  });
});
