// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { jwtVerify } from 'jose';

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
const JWT_ISSUER = 'eventi-dtd';
const JWT_AUDIENCE = 'jitsi';
const JWT_SUBJECT = 'jitsi.test.local';

beforeAll(() => {
  process.env.JITSI_JWT_SECRET = JWT_SECRET;
  process.env.APP_SECRET = 'test-app-secret';
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
    expect(ctx.user.affiliation).toBe('member');
    expect(ctx.user.moderator).toBe('false');
  });

  it('sets correct default expiry (~4 hours)', async () => {
    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Test',
      uniqueId: 'test-1',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    const exp = payload.exp!;
    const iat = payload.iat!;
    // Default is 4 hours = 14400 seconds
    expect(exp - iat).toBe(14400);
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

  it('includes avatar URL pointing to our API', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://videocall-test.innovazione.gov.it';

    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Raff',
      uniqueId: 'test-avatar',
      isModerator: false,
    });

    const payload = await decodeJwt(jwt);
    const ctx = payload.context as { user: Record<string, string> };
    expect(ctx.user.avatar).toContain('/api/avatar');
    expect(ctx.user.avatar).toContain('name=Raff');
    expect(ctx.user.avatar).not.toContain('gh=');

    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('includes Gravatar MD5 hash in avatar URL when email provided', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://videocall-test.innovazione.gov.it';

    const jwt = await generateJitsiJwt({
      roomName: 'room',
      displayName: 'Mario Rossi',
      uniqueId: 'test-gravatar',
      isModerator: false,
      email: 'mario@example.com',
    });

    const payload = await decodeJwt(jwt);
    const ctx = payload.context as { user: Record<string, string> };
    expect(ctx.user.avatar).toContain('gh=');
    expect(ctx.user.avatar).not.toContain('mario@');

    delete process.env.NEXT_PUBLIC_APP_URL;
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
