// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ iscrizione: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { registration: { findUnique: db.iscrizione } } }));

import { generateJitsiJwt } from '@/lib/auth/jwt';

import { identitaPerValutazione } from './participation';
import { issueRatingToken } from './rating-link';

const STANZA = 'stanza-di-prova';
const EVENTO = '11111111-1111-4111-8111-111111111111';
const ISCRIZIONE = '22222222-2222-4222-8222-222222222222';

beforeAll(() => {
  process.env.JITSI_JWT_SECRET = 'segreto-jitsi-di-prova-per-la-partecipazione-0123456789';
  process.env.APP_SECRET = 'segreto-app-di-prova-per-il-link-della-valutazione-0123456789';
});

beforeEach(() => {
  db.iscrizione.mockReset();
  db.iscrizione.mockResolvedValue({ id: ISCRIZIONE, eventId: EVENTO, joinedAt: new Date() });
});

const tokenSala = (uniqueId = 'guest-abc', opts: { stanza?: string; scadeTra?: number; moderatore?: boolean } = {}) =>
  generateJitsiJwt({
    roomName: opts.stanza ?? STANZA,
    displayName: 'Ospite',
    uniqueId,
    isModerator: opts.moderatore ?? false,
    expiresInSeconds: opts.scadeTra ?? 3600,
  });

const chiedi = (extra: Partial<Parameters<typeof identitaPerValutazione>[0]>) =>
  identitaPerValutazione({ eventId: EVENTO, roomName: STANZA, iscrizione: null, ...extra });

describe('valutazione solo da chi ha partecipato, una a testa', () => {
  it('un iscritto entrato in sala risponde con la sua iscrizione', async () => {
    await expect(chiedi({ iscrizione: { id: ISCRIZIONE, joinedAt: new Date() } })).resolves.toEqual({
      registrationId: ISCRIZIONE,
      chiaveOspite: null,
    });
  });

  it('il link della valutazione dell\'email vale per l\'iscrizione entrata in sala', async () => {
    await expect(chiedi({ ratingToken: issueRatingToken(EVENTO, ISCRIZIONE)! })).resolves.toEqual({
      registrationId: ISCRIZIONE,
      chiaveOspite: null,
    });
    db.iscrizione.mockResolvedValueOnce({ id: ISCRIZIONE, eventId: EVENTO, joinedAt: null });
    await expect(chiedi({ ratingToken: issueRatingToken(EVENTO, ISCRIZIONE)! })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });

  it('un ospite risponde con il token della sala, una volta per ingresso', async () => {
    await expect(chiedi({ tokenSala: await tokenSala() })).resolves.toEqual({
      registrationId: null,
      chiaveOspite: 'posto:guest-abc',
    });
  });

  it('un token scaduto da poco vale ancora: la valutazione arriva a fine evento', async () => {
    await expect(chiedi({ tokenSala: await tokenSala('guest-abc', { scadeTra: -1 }) })).resolves.toMatchObject({
      chiaveOspite: 'posto:guest-abc',
    });
  });

  it('il posto di un iscritto risponde con la sua iscrizione, anche senza link personale', async () => {
    await expect(chiedi({ tokenSala: await tokenSala(`reg-${ISCRIZIONE}-a1b2c3d4`) })).resolves.toEqual({
      registrationId: ISCRIZIONE,
      chiaveOspite: null,
    });
  });

  it('con il link di un\'iscrizione mai entrata e il posto di un ospite, risponde l\'ospite', async () => {
    await expect(
      chiedi({ iscrizione: { id: ISCRIZIONE, joinedAt: null }, tokenSala: await tokenSala() }),
    ).resolves.toEqual({ registrationId: null, chiaveOspite: 'posto:guest-abc' });
  });

  it('senza prova, con un\'altra stanza, un token falso o di chi modera: 403 NOT_A_PARTICIPANT', async () => {
    const prove = [
      undefined,
      await tokenSala('guest-abc', { stanza: 'altra-stanza' }),
      'non-un-token',
      await tokenSala('mod-evento-1234', { moderatore: true }),
    ];
    for (const tokenSalaProva of prove) {
      await expect(chiedi({ tokenSala: tokenSalaProva })).rejects.toMatchObject({
        statusCode: 403,
        code: 'NOT_A_PARTICIPANT',
      });
    }
  });
});
