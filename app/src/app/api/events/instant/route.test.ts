// @vitest-environment node
/**
 * La chiamata rapida: la crea solo lo staff, nasce gia' in diretta, usa e getta
 * e senza pagina pubblica, la password resta solo come hash e il token di chi
 * conduce non finisce mai nel link da condividere.
 */
import { SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, barattolo } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn(), create: vi.fn() },
    eventQuestionnaire: { findUnique: vi.fn(), create: vi.fn() },
    questionTemplate: { findUnique: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
  },
  barattolo: { sessione: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && barattolo.sessione
        ? { value: barattolo.sessione }
        : undefined,
  }),
}));

import { verifyJoinPassword } from '@/lib/auth/password';

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const BASE = 'https://portale.example.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORPO = { title: { it: 'Riunione di redazione' } };
const SLUG = 'riunione-di-redazione';
const QUATTRO_ORE = 4 * 60 * 60 * 1000;
let ip = 0;

function firma(
  claims: Record<string, unknown>,
  opzioni: { segreto?: string; soggetto?: string } = {}
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h');
  if (opzioni.soggetto) jwt.setSubject(opzioni.soggetto);
  return jwt.sign(new TextEncoder().encode(opzioni.segreto ?? SEGRETO));
}

function crea(
  corpo: unknown,
  { indirizzo = `10.9.0.${(ip += 1)}`, query = '', lingua = '' } = {}
) {
  const request = new Request(`http://localhost:3000/api/events/instant${query}`, {
    method: 'POST',
    headers: {
      'x-forwarded-for': indirizzo,
      ...(lingua ? { 'accept-language': lingua } : {}),
    },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

const salvato = (chiamata = 0) =>
  prisma.event.create.mock.calls[chiamata]![0].data as Record<string, unknown>;
const spieDeiLog = () => [
  vi.spyOn(console, 'log'),
  vi.spyOn(console, 'warn'),
  vi.spyOn(console, 'error'),
];
const scrittoNeiLog = () =>
  JSON.stringify(spieDeiLog().flatMap((spia) => spia.mock.calls));

interface Creata {
  id: string;
  slug: string;
  jitsiRoomName: string;
  moderatorToken: string;
  links: { liveRoom: string; shareLink: string };
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const spia of spieDeiLog()) spia.mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  process.env.NEXT_PUBLIC_APP_URL = BASE;
  delete process.env.TRUSTED_PROXY_HOPS;
  barattolo.sessione = await firma({ role: 'admin' });
  prisma.event.findUnique.mockResolvedValue(null);
  prisma.event.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ev-1', ...data })
  );
  prisma.eventQuestionnaire.findUnique.mockResolvedValue(null);
  prisma.eventQuestionnaire.create.mockResolvedValue({ id: 'q-1' });
  prisma.questionTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT_ID,
    active: true,
    role: 'ORGANIZER',
    emailHash: 'impronta',
    name: 'nome-cifrato',
  });
});

describe('chi puo’ creare', () => {
  it('senza sessione e’ 401, e non si crea niente', async () => {
    barattolo.sessione = undefined;
    expect((await crea(CORPO)).status).toBe(401);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('un token firmato altrove e’ 401', async () => {
    barattolo.sessione = await firma(
      { role: 'admin' },
      { segreto: 'un-altro-segreto-lungo-quanto-basta-per-firmare' }
    );
    expect((await crea(CORPO)).status).toBe(401);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('il permesso della password di un evento non basta', async () => {
    barattolo.sessione = await firma({ eventId: 'ev-1', role: 'guest' });
    expect((await crea(CORPO)).status).toBe(401);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('un organizzatore disattivato non crea piu’', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      active: false,
      role: 'ORGANIZER',
      emailHash: 'impronta',
      name: 'nome-cifrato',
    });
    barattolo.sessione = await firma({ role: 'organizer' }, { soggetto: ACCOUNT_ID });
    expect((await crea(CORPO)).status).toBe(401);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('l’organizzatore crea, e la chiamata e’ sua', async () => {
    barattolo.sessione = await firma({ role: 'organizer' }, { soggetto: ACCOUNT_ID });
    expect((await crea(CORPO)).status).toBe(201);
    expect(salvato().createdById).toBe(ACCOUNT_ID);
  });

  it('con la chiave dell’istanza la chiamata non ha un proprietario', async () => {
    expect((await crea(CORPO)).status).toBe(201);
    expect(salvato().createdById).toBeNull();
  });

  it('dall’undicesima in un minuto e’ 429', async () => {
    const indirizzo = '10.9.200.1';
    for (let i = 0; i < 10; i += 1) {
      expect((await crea(CORPO, { indirizzo })).status).toBe(201);
    }
    const r = await crea(CORPO, { indirizzo });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(prisma.event.create).toHaveBeenCalledTimes(10);
  });
});

describe('la richiesta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await crea('non json')).status).toBe(400);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('senza titolo italiano, o con valori fuori misura, e’ 422', async () => {
    for (const corpo of [
      {},
      { title: 'Riunione' },
      { title: {} },
      { title: { en: 'Editorial meeting' } },
      { title: { it: 'x' } },
      { ...CORPO, maxParticipants: 1 },
      { ...CORPO, maxParticipants: 501 },
      { ...CORPO, maxParticipants: 2.5 },
      { ...CORPO, joinPassword: 'abc' },
      { ...CORPO, joinPassword: 'x'.repeat(201) },
      { ...CORPO, moderatorName: 'x' },
    ]) {
      expect((await crea(corpo)).status).toBe(422);
    }
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('il rifiuto di una password troppo corta non la ripete', async () => {
    const testo = await (await crea({ ...CORPO, joinPassword: 'q7w' })).text();
    expect(testo).not.toContain('q7w');
  });
});

describe('la chiamata che nasce', () => {
  it('e’ gia’ in diretta, senza pagina pubblica e con i dati di breve durata', async () => {
    await crea(CORPO);
    expect(salvato()).toMatchObject({
      slug: SLUG,
      title: CORPO.title,
      eventType: 'INSTANT',
      status: 'LIVE',
      postEventPublic: false,
      dataRetentionDays: 7,
      gracePeriodMinutes: -1,
      maxParticipants: 50,
      joinPasswordHash: null,
    });
  });

  it('ha gli orari che servono a chi la spegne quando resta vuota', async () => {
    const prima = Date.now();
    await crea(CORPO);
    const { startsAt, endsAt, lastActiveAt, provisioningStartedAt } = salvato() as {
      startsAt: Date;
      endsAt: Date;
      lastActiveAt: Date;
      provisioningStartedAt: Date;
    };
    expect(startsAt.getTime()).toBeGreaterThanOrEqual(prima);
    expect(endsAt.getTime() - startsAt.getTime()).toBe(QUATTRO_ORE);
    expect(lastActiveAt).toEqual(startsAt);
    expect(provisioningStartedAt).toEqual(startsAt);
  });

  it('stanza e token di chi conduce sono casuali e diversi a ogni chiamata', async () => {
    await crea(CORPO);
    await crea(CORPO);
    const [a, b] = [salvato(0), salvato(1)];
    expect(a.moderatorToken).toMatch(UUID);
    expect(String(a.jitsiRoomName).replace(/^call-/, '')).toMatch(UUID);
    expect(a.moderatorToken).not.toBe(b.moderatorToken);
    expect(a.jitsiRoomName).not.toBe(b.jitsiRoomName);
  });

  it('la capienza indicata arriva allo scaler', async () => {
    await crea({ ...CORPO, maxParticipants: 200, moderatorName: 'Anna Bianchi' });
    expect(salvato()).toMatchObject({
      maxParticipants: 200,
      moderatorName: 'Anna Bianchi',
    });
    expect(salvato().capacityEstimateJson).toHaveProperty('computedAt');
  });

  it('un titolo gia’ usato non urta: l’indirizzo prende un suffisso', async () => {
    prisma.event.findUnique.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        where.slug === SLUG ? { id: 'ev-0' } : null
    );
    const corpo = (await (await crea(CORPO)).json()) as Creata;
    expect(corpo.slug).toBe(`${SLUG}-2`);
  });

  it('la password si salva solo come hash', async () => {
    const r = await crea({ ...CORPO, joinPassword: 'parola-di-accesso' });
    const hash = salvato().joinPasswordHash as string;
    expect(verifyJoinPassword('parola-di-accesso', hash)).toBe(true);
    expect(JSON.stringify(prisma.event.create.mock.calls)).not.toContain(
      'parola-di-accesso'
    );
    expect(await r.text()).not.toContain('parola-di-accesso');
    expect(scrittoNeiLog()).not.toContain('parola-di-accesso');
  });

  it('riceve il questionario di fine chiamata', async () => {
    await crea(CORPO);
    expect(prisma.eventQuestionnaire.create.mock.calls[0]![0].data).toMatchObject({
      eventId: 'ev-1',
      placement: 'POST_EVENT',
    });
  });

  it('senza questionario la chiamata parte lo stesso', async () => {
    prisma.eventQuestionnaire.findUnique.mockRejectedValue(new Error('database giu’'));
    expect((await crea(CORPO)).status).toBe(201);
  });
});

describe('la risposta', () => {
  it('il link da condividere non porta il token di chi conduce', async () => {
    const r = await crea(CORPO);
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as Creata;
    expect(corpo).toMatchObject({
      id: 'ev-1',
      slug: SLUG,
      jitsiRoomName: salvato().jitsiRoomName,
      moderatorToken: salvato().moderatorToken,
    });
    expect(corpo.links.liveRoom).toBe(
      `${BASE}/it/eventi/${SLUG}/live?token=${corpo.moderatorToken}`
    );
    expect(corpo.links.shareLink).toBe(`${BASE}/it/eventi/${SLUG}/live`);
    expect(corpo.links.shareLink).not.toContain(corpo.moderatorToken);
  });

  it('gli indirizzi seguono la lingua della richiesta', async () => {
    const dalBrowser = (await (await crea(CORPO, { lingua: 'en' })).json()) as Creata;
    expect(dalBrowser.links.shareLink).toBe(`${BASE}/en/events/${SLUG}/live`);
    const dallaQuery = (await (
      await crea(CORPO, { query: '?locale=en', lingua: 'it' })
    ).json()) as Creata;
    expect(dallaQuery.links.shareLink).toBe(`${BASE}/en/events/${SLUG}/live`);
  });

  it('il token di chi conduce non finisce nei log', async () => {
    const corpo = (await (await crea(CORPO)).json()) as Creata;
    expect(scrittoNeiLog()).not.toContain(corpo.moderatorToken);
  });
});
