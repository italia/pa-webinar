// @vitest-environment node
import { createHash } from 'crypto';

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { jwtVerify } from 'jose';

import { readGravatarRef } from '@/lib/gravatar-ref';

import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
  generateModeratorToken,
  generateAccessToken,
  hashEmail,
} from './jwt';

const JWT_SECRET = 'test-secret-for-jwt-tests';
const JWT_ISSUER = 'pa-webinar';
const JWT_AUDIENCE = 'jitsi';
const JWT_SUBJECT = 'jitsi.test.local';

beforeAll(() => {
  process.env.JITSI_JWT_SECRET = JWT_SECRET;
  process.env.APP_SECRET = 'test-app-secret';
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.NEXT_PUBLIC_JITSI_DOMAIN = JWT_SUBJECT;
});

async function decodeJwt(token: string) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return payload;
}

// ── generateJitsiJwt ────────────────────────────────────────

describe('generateJitsiJwt', () => {
  it('generates a valid JWT for moderator', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'evt-test-room',
      displayName: 'Moderatore',
      uniqueId: 'mod-123',
      isModerator: true,
    });

    expect(jwt).toBeTruthy();
    expect(jwt.split('.')).toHaveLength(3);

    const payload = await decodeJwt(jwt);
    expect(payload.room).toBe('evt-test-room');
    expect(payload.moderator).toBe(true);
    expect(payload.affiliation).toBe('owner');
    expect(payload.sub).toBe(JWT_SUBJECT);

    const ctx = payload.context as { user: Record<string, string> };
    expect(ctx.user.name).toBe('Moderatore');
    // `displayName` is set alongside `name` so older Prosody token
    // modules that look up the alternate field also see the real name
    // (instead of the random "Judah-hqj" stats_id fallback).
    expect(ctx.user.displayName).toBe('Moderatore');
    expect(ctx.user.id).toBe('mod-123');
    expect(ctx.user.affiliation).toBe('owner');
    expect(ctx.user.moderator).toBe('true');
  });

  it('generates a valid JWT for participant', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'evt-test-room',
      displayName: 'Mario Rossi',
      uniqueId: 'reg-456',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    expect(payload.moderator).toBe(false);
    expect(payload.affiliation).toBe('member');

    const ctx = payload.context as { user: Record<string, string> };
    expect(ctx.user.name).toBe('Mario Rossi');
    expect(ctx.user.displayName).toBe('Mario Rossi');
    expect(ctx.user.affiliation).toBe('member');
    expect(ctx.user.moderator).toBe('false');
  });

  it('sets a 90-minute default expiry for participants', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Test',
      uniqueId: 'test-1',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    // 90 min = 5400 s — tight window so a leaked participant token
    // has a small replay surface (Jitsi has no jti blacklist).
    expect(payload.exp! - payload.iat!).toBe(5400);
  });

  it('sets a 2-hour default expiry for moderators', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Mod',
      uniqueId: 'mod-1',
      isModerator: true,
    });

    const payload = await decodeJwt(jwt);
    // 2h = 7200s. Tighter than the original 4h because Jitsi has no
    // jti blacklist; moderators rejoin via magic link to refresh.
    expect(payload.exp! - payload.iat!).toBe(7200);
  });

  it('respects custom expiry', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Guest',
      uniqueId: 'guest-1',
      isModerator: false,
      expiresInSeconds: 7200,
    });

    const payload = await decodeJwt(jwt);
    expect(payload.exp! - payload.iat!).toBe(7200);
  });

  it('allows overriding the JWT subject explicitly', async () => {
    process.env.JITSI_JWT_SUBJECT = 'meet.jitsi';

    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Guest',
      uniqueId: 'guest-1',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    expect(payload.sub).toBe('meet.jitsi');

    delete process.env.JITSI_JWT_SUBJECT;
  });

  it('embeds avatar as inline SVG data URI (CSP-safe for Jitsi web)', async () => {
    // Il default è un data URI: attraversa qualunque restrizione e non fa
    // partire richieste. Non è però vero, come diceva questa nota, che una URL
    // remota sia bloccata: sul bundle jitsi-web in produzione (stable-10741)
    // `avatarURL` del JWT viene usata senza condizioni e, se non carica, si
    // ricade sulle iniziali. Nessun header CSP su quell'origine.
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Raff',
      uniqueId: 'test-avatar',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    const ctx = payload.context as { user: Record<string, string> };
    const avatar = ctx.user.avatar ?? '';
    expect(avatar).toMatch(/^data:image\/svg\+xml;base64,/);
    // Initials come from displayName — decode and spot-check.
    const base64 = avatar.split(',')[1] ?? '';
    const svg = Buffer.from(base64, 'base64').toString('utf-8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>R<'); // single-initial "R" for "Raff"
  });

  it('never leaks raw email into avatar payload (GDPR)', async () => {
    // Even when we have the email we must not ship it in the JWT; the
    // avatar is derived from the displayName only.
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Mario Rossi',
      uniqueId: 'test-gravatar',
      isModerator: false,
      email: 'mario@example.com',
    });

    const payload = await decodeJwt(jwt);
    const ctx = payload.context as { user: Record<string, string> };
    expect(ctx.user.avatar).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(ctx.user.avatar).not.toContain('mario@');
    expect(ctx.user.avatar).not.toContain('example.com');
  });

  describe('con Gravatar attivo (opt-in dell\'amministratore)', () => {
    const EMAIL = 'mario.rossi@example.com';
    const MD5 = createHash('md5').update(EMAIL).digest('hex');

    async function avatarOf(overrides: Record<string, unknown> = {}) {
      const jwt = await generateJitsiJwt({
        roomName: 'room',
        displayName: 'Mario Rossi',
        uniqueId: 'test-gravatar-on',
        isModerator: false,
        email: EMAIL,
        useGravatar: true,
        ...overrides,
      });
      const payload = await decodeJwt(jwt);
      const ctx = payload.context as { user: Record<string, string> };
      return ctx.user.avatar ?? '';
    }

    it('punta al NOSTRO proxy, mai a gravatar.com', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
      const avatar = await avatarOf();
      expect(avatar.startsWith('https://webinar.example.gov.it/api/avatar?')).toBe(true);
      expect(avatar).not.toContain('gravatar.com');
    });

    it('non porta né l\'email né il suo hash in chiaro (ADR-004)', async () => {
      // Jitsi diffonde questo URL in presenza a tutta la sala: quello che ci
      // finisce dentro è pubblico verso il pubblico dell'evento.
      process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
      const avatar = await avatarOf();
      expect(avatar).not.toContain('mario.rossi');
      expect(avatar).not.toContain('example.com');
      expect(avatar).not.toContain(MD5);

      const ref = new URL(avatar).searchParams.get('g');
      expect(ref).toBeTruthy();
      expect(readGravatarRef(ref!)).toBe(MD5);
    });

    it('legge NEXT_PUBLIC_APP_URL a RUNTIME, non a build time', async () => {
      // `process.env.NEXT_PUBLIC_*` in notazione puntata viene sostituito da
      // webpack a build time, e l'immagine è costruita con il default
      // http://localhost:3000: ogni partecipante avrebbe visto un avatar
      // puntato al proprio computer. Cambiare il valore DOPO l'import deve
      // cambiare l'URL emesso.
      process.env.NEXT_PUBLIC_APP_URL = 'https://primo.example.it';
      expect(await avatarOf()).toContain('https://primo.example.it/api/avatar');
      process.env.NEXT_PUBLIC_APP_URL = 'https://secondo.example.it';
      expect(await avatarOf()).toContain('https://secondo.example.it/api/avatar');
    });

    it('senza un URL pubblico valido resta il data URI, non un link rotto', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'non-un-url';
      expect(await avatarOf()).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it('senza email resta il data URI (link primario condiviso, ospiti)', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
      expect(await avatarOf({ email: undefined })).toMatch(
        /^data:image\/svg\+xml;base64,/,
      );
    });

    afterEach(() => {
      delete process.env.NEXT_PUBLIC_APP_URL;
    });
  });

  it('includes features in context', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Mod',
      uniqueId: 'mod-1',
      isModerator: true,
    });

    const payload = await decodeJwt(jwt);
    const ctx = payload.context as { features: Record<string, boolean> };
    expect(ctx.features.recording).toBe(true);
    expect(ctx.features['screen-sharing']).toBe(true);
  });
});

// ── ID generators ───────────────────────────────────────────

describe('moderatorJitsiId', () => {
  it('includes event id', () => {
    const id = moderatorJitsiId('abc-123');
    expect(id).toContain('mod-');
    expect(id).toContain('abc-123');
  });

  it('generates different IDs each call', () => {
    const id1 = moderatorJitsiId('same-event');
    const id2 = moderatorJitsiId('same-event');
    expect(id1).not.toBe(id2);
  });
});

describe('participantJitsiId', () => {
  it('includes registration id', () => {
    const id = participantJitsiId('reg-456');
    expect(id).toContain('reg-');
    expect(id).toContain('reg-456');
  });
});

describe('guestJitsiId', () => {
  it('starts with guest-', () => {
    expect(guestJitsiId()).toMatch(/^guest-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 10 }, () => guestJitsiId()));
    expect(ids.size).toBe(10);
  });
});

// ── Token generators ────────────────────────────────────────

describe('generateModeratorToken', () => {
  it('returns a UUID', () => {
    const token = generateModeratorToken();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('generateAccessToken', () => {
  it('returns a 24-char string', async () => {
    const token = await generateAccessToken();
    expect(token).toHaveLength(24);
  });

  it('generates unique tokens', async () => {
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => generateAccessToken()),
    );
    expect(new Set(tokens).size).toBe(5);
  });
});

// ── hashEmail ───────────────────────────────────────────────

describe('hashEmail', () => {
  it('produces deterministic output', () => {
    expect(hashEmail('test@example.com')).toBe(hashEmail('test@example.com'));
  });

  it('is case insensitive', () => {
    expect(hashEmail('Test@Example.COM')).toBe(hashEmail('test@example.com'));
  });

  it('trims whitespace', () => {
    expect(hashEmail('  test@example.com  ')).toBe(hashEmail('test@example.com'));
  });

  it('different emails produce different hashes', () => {
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });

  it('returns a 64-char hex string (SHA-256)', () => {
    expect(hashEmail('test@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});
