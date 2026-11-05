// @vitest-environment node
/**
 * La password di un evento riservato: i tentativi si contano per indirizzo ed
 * evento, solo la password giusta produce il permesso, e il permesso vale per
 * quell'evento soltanto.
 */
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, barattolo } = vi.hoisted(() => ({
  prisma: { event: { findUnique: vi.fn() } },
  barattolo: new Map<string, string>(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      barattolo.has(nome) ? { value: barattolo.get(nome) ?? '' } : undefined,
  }),
}));

import { hashJoinPassword } from '@/lib/auth/password';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-del-permesso-abbastanza-lungo';
const EVENTO_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ALTRO_EVENTO_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const PASSWORD = 'parola-di-accesso';
const HASH = hashJoinPassword(PASSWORD);
const DODICI_ORE = 12 * 60 * 60;
let ip = 0;

function prova(
  corpo: unknown,
  { indirizzo = `10.8.0.${(ip += 1)}`, slug = 'evento-riservato' } = {}
) {
  const request = new Request(
    `http://localhost:3000/api/events/${slug}/verify-password`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: slug }),
  });
}

const cookieDi = (r: Response) => r.headers.get('set-cookie') ?? '';
const permessoDi = (r: Response) =>
  new RegExp(`join_granted_${EVENTO_ID}=([^;]*)`).exec(cookieDi(r))?.[1] ?? '';
const spieDeiLog = () => [
  vi.spyOn(console, 'log'),
  vi.spyOn(console, 'warn'),
  vi.spyOn(console, 'error'),
];
const scrittoNeiLog = () =>
  JSON.stringify(spieDeiLog().flatMap((spia) => spia.mock.calls));

beforeEach(() => {
  vi.clearAllMocks();
  for (const spia of spieDeiLog()) spia.mockImplementation(() => {});
  barattolo.clear();
  process.env.APP_SECRET = SEGRETO;
  delete process.env.TRUSTED_PROXY_HOPS;
  prisma.event.findUnique.mockResolvedValue({
    id: EVENTO_ID,
    joinPasswordHash: HASH,
    status: 'LIVE',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('la password', () => {
  it('quella giusta da’ il permesso', async () => {
    const r = await prova({ password: PASSWORD });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
    expect(permessoDi(r)).not.toBe('');
    expect(prisma.event.findUnique.mock.calls[0]![0].where).toEqual({
      slug: 'evento-riservato',
    });
  });

  it('un corpo vuoto e’ una password sbagliata, non un errore del server', async () => {
    expect((await prova(null)).status).toBe(403);
    expect((await prova('[]')).status).toBe(403);
  });

  it('una sbagliata e’ 403, senza permesso', async () => {
    for (const password of ['sbagliata', PASSWORD.toUpperCase(), `${PASSWORD} `, '']) {
      const r = await prova({ password });
      expect(r.status).toBe(403);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });

  it('una password assente, o che non e’ testo, vale come sbagliata', async () => {
    for (const corpo of [{}, { password: 123456 }, { password: [PASSWORD] }, []]) {
      const r = await prova(corpo);
      expect(r.status).toBe(403);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });

  it('un hash guasto nel database non apre con nessuna password', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: EVENTO_ID,
      joinPasswordHash: 'scrypt:zz:zz',
      status: 'LIVE',
    });
    const r = await prova({ password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    const r = await prova({ password: PASSWORD });
    expect(r.status).toBe(404);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('un evento senza password non da’ permessi', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: EVENTO_ID,
      joinPasswordHash: null,
      status: 'LIVE',
    });
    const r = await prova({ password: PASSWORD });
    expect(r.status).toBe(400);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await prova('non json')).status).toBe(400);
  });
});

describe('i tentativi', () => {
  it('dall’undicesimo in un minuto e’ 429, anche con la password giusta', async () => {
    const opzioni = { indirizzo: '10.8.200.1' };
    for (let i = 0; i < 10; i += 1) {
      expect((await prova({ password: `tentativo-${i}` }, opzioni)).status).toBe(403);
    }
    prisma.event.findUnique.mockClear();
    const r = await prova({ password: PASSWORD }, opzioni);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('il contatore e’ per evento e per indirizzo', async () => {
    const indirizzo = '10.8.200.2';
    for (let i = 0; i < 11; i += 1) await prova({ password: 'no' }, { indirizzo });
    const altroEvento = await prova(
      { password: PASSWORD },
      { indirizzo, slug: 'altro-evento' }
    );
    expect(altroEvento.status).toBe(200);
    const altroIndirizzo = await prova(
      { password: PASSWORD },
      { indirizzo: '10.8.200.3' }
    );
    expect(altroIndirizzo.status).toBe(200);
  });

  it('inventare voci a sinistra in X-Forwarded-For non apre un contatore nuovo', async () => {
    for (let i = 0; i < 10; i += 1) {
      await prova({ password: 'no' }, { indirizzo: `198.51.100.${i + 1}, 10.8.200.4` });
    }
    const r = await prova(
      { password: PASSWORD },
      { indirizzo: '198.51.100.99, 10.8.200.4' }
    );
    expect(r.status).toBe(429);
  });
});

describe('il permesso', () => {
  it('dice l’evento e il ruolo di ospite, e scade dopo dodici ore', async () => {
    const r = await prova({ password: PASSWORD });
    const { payload } = await jwtVerify(permessoDi(r), new TextEncoder().encode(SEGRETO));
    expect(payload.eventId).toBe(EVENTO_ID);
    expect(payload.role).toBe('guest');
    expect(payload.exp! - payload.iat!).toBe(DODICI_ORE);
  });

  it('il cookie e’ quello dell’evento, non si legge da JavaScript e non viaggia fra siti', async () => {
    const cookie = cookieDi(await prova({ password: PASSWORD }));
    expect(cookie).toContain(`join_granted_${EVENTO_ID}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toMatch(/;\s*Path=\/\s*(;|$)/);
    expect(cookie).toContain(`Max-Age=${DODICI_ORE}`);
    expect(cookie).not.toContain('Secure');
  });

  it('in produzione viaggia solo su HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(cookieDi(await prova({ password: PASSWORD }))).toContain('Secure');
  });

  it('chi legge il permesso lo riconosce, per il suo evento soltanto', async () => {
    const permesso = permessoDi(await prova({ password: PASSWORD }));
    await expect(hasJoinGrant(EVENTO_ID)).resolves.toBe(false);
    barattolo.set(`join_granted_${EVENTO_ID}`, permesso);
    await expect(hasJoinGrant(EVENTO_ID)).resolves.toBe(true);
    barattolo.set(`join_granted_${ALTRO_EVENTO_ID}`, permesso);
    await expect(hasJoinGrant(ALTRO_EVENTO_ID)).resolves.toBe(false);
  });

  it('in produzione con un segreto corto non si firma niente', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.APP_SECRET = 'corto';
    const r = await prova({ password: PASSWORD });
    expect(r.status).toBe(500);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('password e hash non finiscono in risposta ne’ nei log', async () => {
    const riuscita = await prova({ password: PASSWORD });
    const rifiutata = await prova({ password: `${PASSWORD}x` });
    expect(await riuscita.text()).not.toContain(HASH);
    expect(await rifiutata.text()).not.toContain(PASSWORD);
    expect(scrittoNeiLog()).not.toContain(PASSWORD);
    expect(scrittoNeiLog()).not.toContain(HASH);
  });
});
