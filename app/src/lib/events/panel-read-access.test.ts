import { describe, it, expect, vi, beforeEach } from 'vitest';

// Il cancello decide «puoi leggere, e come ti chiami per il server». I tre
// collaboratori sono finti così ogni test fissa un ramo solo.
vi.mock('@/lib/db', () => ({
  prisma: {
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/auth/moderator', () => ({
  isEventModeratorCached: vi.fn(),
}));
vi.mock('@/lib/events/join-grant', () => ({
  hasJoinGrant: vi.fn(),
}));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));

import { isEventModeratorCached } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { authorizePanelRead, type PanelReadEvent } from './panel-read-access';

const mockedIsModerator = isEventModeratorCached as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;

const evento = (over: Partial<PanelReadEvent> = {}): PanelReadEvent => ({
  id: 'evt-1',
  status: 'LIVE',
  eventType: 'SCHEDULED',
  moderatorToken: 'tok-mod',
  joinPasswordHash: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  mockedIsModerator.mockResolvedValue(false);
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
  mockedJoinGrant.mockResolvedValue(false);
});

describe('authorizePanelRead', () => {
  it('senza token, in diretta, si legge da ospite', async () => {
    // È IL difetto che ha rotto i sondaggi in sala: in una chiamata
    // istantanea nessuno ha un token, e il pannello rispondeva 401 a tutti.
    await expect(authorizePanelRead(evento(), null)).resolves.toEqual({
      kind: 'guest',
      registrationId: null,
      isModerator: false,
    });
  });

  it('una chiamata istantanea è aperta anche mentre il bridge si accende', async () => {
    for (const status of ['PROVISIONING', 'IDLE', 'LIVE']) {
      const r = await authorizePanelRead(
        evento({ status, eventType: 'INSTANT' }),
        null,
      );
      expect(r.kind, status).toBe('guest');
    }
  });

  it('un evento a calendario non in diretta pretende un token', async () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'PROVISIONING', 'IDLE', 'ENDED']) {
      await expect(
        authorizePanelRead(evento({ status }), null),
        status,
      ).rejects.toMatchObject({ statusCode: 401 });
    }
  });

  it('con la password, l’indirizzo da solo non apre il pannello', async () => {
    const protetto = evento({ joinPasswordHash: 'hash' });
    await expect(authorizePanelRead(protetto, null)).rejects.toMatchObject({
      statusCode: 401,
    });
    // Col cookie di accesso già ottenuto, invece, sì.
    mockedJoinGrant.mockResolvedValue(true);
    await expect(authorizePanelRead(protetto, null)).resolves.toMatchObject({
      kind: 'guest',
    });
  });

  it('il token moderatore vede tutto', async () => {
    mockedIsModerator.mockResolvedValue(true);
    await expect(authorizePanelRead(evento(), 'tok-mod')).resolves.toEqual({
      kind: 'moderator',
      registrationId: null,
      isModerator: true,
    });
    // Non deve nemmeno andare a cercare una registrazione.
    expect(mockedRegistration).not.toHaveBeenCalled();
  });

  it('una registrazione di questo evento porta con sé la propria identità', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: 'evt-1' });
    await expect(authorizePanelRead(evento(), 'tok-reg')).resolves.toEqual({
      kind: 'participant',
      registrationId: 'reg-1',
      isModerator: false,
    });
  });

  it('una registrazione di un ALTRO evento non vale', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-9', eventId: 'evt-altro' });
    await expect(authorizePanelRead(evento(), 'tok-reg')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('il relatore legge come il pubblico, non come moderatore', async () => {
    // Uno SPEAKER non è un moderatore (lo dice isEventModerator) e non è una
    // registrazione: prima cadeva nel ramo «token che non risolve» e restava
    // senza pannello.
    mockedGrant.mockResolvedValue({ eventId: 'evt-1', revokedAt: null });
    await expect(authorizePanelRead(evento(), 'tok-speaker')).resolves.toEqual({
      kind: 'speaker',
      registrationId: null,
      isModerator: false,
    });
  });

  it('un grant revocato, o di un altro evento, non vale', async () => {
    mockedGrant.mockResolvedValue({ eventId: 'evt-1', revokedAt: new Date() });
    await expect(authorizePanelRead(evento(), 'tok-speaker')).rejects.toMatchObject({
      statusCode: 403,
    });
    mockedGrant.mockResolvedValue({ eventId: 'evt-altro', revokedAt: null });
    await expect(authorizePanelRead(evento(), 'tok-speaker')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("con l'accesso ospiti spento un evento a calendario pretende un token anche in diretta", async () => {
    siteSettings.guestAccessEnabled = false;
    await expect(authorizePanelRead(evento(), null)).rejects.toMatchObject({
      statusCode: 401,
    });
    // Chi conduce e chi è iscritto leggono come prima.
    mockedIsModerator.mockResolvedValue(true);
    await expect(authorizePanelRead(evento(), 'tok-mod')).resolves.toMatchObject({
      kind: 'moderator',
    });
  });

  it("con l'accesso ospiti spento una chiamata istantanea resta aperta a chi ha il link", async () => {
    siteSettings.guestAccessEnabled = false;
    const r = await authorizePanelRead(evento({ eventType: 'INSTANT' }), null);
    expect(r.kind).toBe('guest');
  });

  it('un token che non risolve fallisce, non si declassa a ospite', async () => {
    // Anche a evento LIVE, dove un ospite passerebbe: un link scaduto deve
    // dirlo, non trasformarsi in silenzio in un visitatore anonimo.
    await expect(authorizePanelRead(evento(), 'tok-scaduto')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
