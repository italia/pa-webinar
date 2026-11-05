// @vitest-environment node
/**
 * Lingue e traduzioni del sito: solo l’amministrazione. Salvare una traduzione
 * non perde quelle gia’ fatte, e dopo ogni salvataggio le impostazioni in
 * memoria si rileggono.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione, svuotaCache } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    siteSetting: { findUnique: vi.fn(), update: vi.fn() },
  },
  sessione: { cookie: undefined as string | undefined },
  svuotaCache: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ invalidateSettingsCache: svuotaCache }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';

import { GET, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request('http://localhost/api/admin/languages', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined
      ? { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
      : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}
const salva = (corpo: unknown) => chiama(PUT, 'PUT', corpo);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const LINGUE = { availableLocales: ['it', 'en'], localeNames: { it: 'Italiano' } };
const TRADUZIONE = { locale: 'en', overrides: { 'home.titolo': 'Welcome' } };

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-lingue-del-sito-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.siteSetting.findUnique.mockResolvedValue({ translationOverrides: {} });
  prisma.siteSetting.update.mockImplementation(
    async ({ data }: { data: object }) => data
  );
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401, e la configurazione resta', async () => {
    sessione.cookie = undefined;
    expect((await chiama(GET, 'GET')).status).toBe(401);
    expect((await salva(LINGUE)).status).toBe(401);
    expect((await salva(TRADUZIONE)).status).toBe(401);
    expect(prisma.siteSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.siteSetting.update).not.toHaveBeenCalled();
  });

  it('chi organizza e’ rifiutato', async () => {
    await entra('ORGANIZER');
    expect((await chiama(GET, 'GET')).status).toBe(401);
    expect((await salva(LINGUE)).status).toBe(401);
    expect((await salva(TRADUZIONE)).status).toBe(401);
    expect(prisma.siteSetting.update).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('consegna la configurazione salvata', async () => {
    const salvata = {
      availableLocales: ['it', 'fr'],
      localeNames: { it: 'Italiano', fr: 'Français' },
      translationOverrides: { fr: { titolo: 'Bienvenue' } },
    };
    prisma.siteSetting.findUnique.mockResolvedValue(salvata);
    expect(await (await chiama(GET, 'GET')).json()).toEqual(salvata);
  });

  it('senza la riga delle impostazioni propone italiano e inglese', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue(null);
    expect(await (await chiama(GET, 'GET')).json()).toEqual({
      availableLocales: ['it', 'en'],
      localeNames: { it: 'Italiano', en: 'English' },
      translationOverrides: {},
    });
  });
});

describe('PUT delle lingue attive', () => {
  it('un corpo vuoto o che non e’ un oggetto e’ un rifiuto, non un errore del server', async () => {
    for (const corpo of [null, 5, 'null']) {
      expect((await salva(corpo)).status).toBeLessThan(500);
    }
  });

  it('scrive lingue e nomi, senza toccare le traduzioni', async () => {
    const r = await salva(LINGUE);
    expect(r.status).toBe(200);
    expect(prisma.siteSetting.update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'singleton' },
      data: LINGUE,
    });
    expect(prisma.siteSetting.update.mock.calls[0]![0].data).not.toHaveProperty(
      'translationOverrides'
    );
    expect(svuotaCache).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.action).toBe(
      'LANGUAGES_LOCALES_UPDATE'
    );
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      {},
      { availableLocales: 'it', localeNames: {} },
      { availableLocales: ['i'], localeNames: {} },
      { availableLocales: ['it'], localeNames: { it: 'x'.repeat(51) } },
      // Con una sola delle due chiavi non e’ una traduzione.
      { locale: 'en' },
      { overrides: {} },
    ];
    for (const corpo of corpi) {
      expect((await salva(corpo)).status).toBe(422);
    }
    expect(prisma.siteSetting.update).not.toHaveBeenCalled();
    expect(svuotaCache).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await salva('non-json')).status).toBe(400);
    expect(prisma.siteSetting.update).not.toHaveBeenCalled();
  });
});

describe('PUT di una traduzione', () => {
  it('aggiunge alle voci gia’ fatte e non tocca le altre lingue', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue({
      translationOverrides: {
        en: { 'home.titolo': 'Hello', 'home.sotto': 'Subtitle' },
        fr: { 'home.titolo': 'Bonjour' },
      },
    });
    const r = await salva(TRADUZIONE);
    expect(r.status).toBe(200);
    expect(prisma.siteSetting.update.mock.calls[0]![0].data).toEqual({
      translationOverrides: {
        en: { 'home.titolo': 'Welcome', 'home.sotto': 'Subtitle' },
        fr: { 'home.titolo': 'Bonjour' },
      },
    });
  });

  it('la prima traduzione parte da zero', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue(null);
    await salva(TRADUZIONE);
    expect(prisma.siteSetting.update.mock.calls[0]![0].data).toEqual({
      translationOverrides: { en: { 'home.titolo': 'Welcome' } },
    });
  });

  it('svuota la cache e la traccia dice lingua e chiavi', async () => {
    await salva(TRADUZIONE);
    expect(svuotaCache).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'LANGUAGES_TRANSLATIONS_UPDATE',
      details: JSON.stringify({ locale: 'en', keys: ['home.titolo'] }),
    });
  });

  it('una voce non testuale o una lingua malformata sono 422', async () => {
    const corpi = [
      { locale: 'en', overrides: { titolo: 1 } },
      { locale: 'e', overrides: {} },
      { locale: 'troppo-lunga', overrides: {} },
    ];
    for (const corpo of corpi) {
      expect((await salva(corpo)).status).toBe(422);
    }
    expect(prisma.siteSetting.update).not.toHaveBeenCalled();
  });
});
