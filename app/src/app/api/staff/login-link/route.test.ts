// @vitest-environment node
/**
 * La richiesta del link di accesso dello staff: da fuori non si deve poter
 * capire quali indirizzi hanno un account, ne' dalla risposta ne' dal tempo che
 * impiega, e la casella di una persona non si puo' inondare.
 */
import { createHash } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, enqueueEmail, dopoLaRisposta } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    staffLoginToken: { create: vi.fn() },
  },
  enqueueEmail: vi.fn(),
  dopoLaRisposta: [] as Array<() => Promise<void>>,
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar' }),
}));
// Fuori da una richiesta vera `after` lancia. Qui si raccoglie il lavoro: si
// vede cosa aspetta la risposta e cosa no.
vi.mock('next/server', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  after: (lavoro: () => Promise<void>) => {
    dopoLaRisposta.push(lavoro);
  },
}));

import { encryptPII, hashEmail } from '@/lib/crypto/pii';

import { POST } from './route';

const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const INDIRIZZO = 'anna.bianchi@example.com';
const DISATTIVATO = 'mario.rossi@example.com';
const SCONOSCIUTO = 'nessuno@example.com';
let ip = 0;

function chiedi(corpo: unknown, indirizzo = `10.6.0.${(ip += 1)}`) {
  const request = new Request('http://localhost:3000/api/staff/login-link', {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

async function finisciIlLavoro() {
  for (const lavoro of dopoLaRisposta.splice(0)) await lavoro();
}

function account(email: string, active: boolean) {
  return {
    id: ACCOUNT_ID,
    email: encryptPII(email),
    name: encryptPII('Anna Bianchi'),
    active,
  };
}

const spieDeiLog = () => [
  vi.spyOn(console, 'log'),
  vi.spyOn(console, 'warn'),
  vi.spyOn(console, 'error'),
];
const scrittoNeiLog = () =>
  JSON.stringify(spieDeiLog().flatMap((spia) => spia.mock.calls));

function linkNellaMail() {
  const { text } = enqueueEmail.mock.calls[0]![0] as { text: string };
  return new URL(/https:\/\/\S+/.exec(text)?.[0] ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const spia of spieDeiLog()) spia.mockImplementation(() => {});
  dopoLaRisposta.length = 0;
  process.env.APP_SECRET = 'segreto-di-prova-della-sessione-abbastanza-lungo';
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.com';
  delete process.env.TRUSTED_PROXY_HOPS;
  prisma.staffAccount.findUnique.mockImplementation(
    async ({ where }: { where: { emailHash: string } }) => {
      if (where.emailHash === hashEmail(INDIRIZZO)) return account(INDIRIZZO, true);
      if (where.emailHash === hashEmail(DISATTIVATO)) return account(DISATTIVATO, false);
      return null;
    }
  );
  prisma.staffLoginToken.create.mockResolvedValue({ id: 'tok-1' });
  enqueueEmail.mockResolvedValue(undefined);
});

describe('cosa vede chi chiede', () => {
  it('account attivo, disattivato e sconosciuto ricevono la stessa risposta', async () => {
    const risposte = [
      await chiedi({ email: INDIRIZZO }),
      await chiedi({ email: DISATTIVATO }),
      await chiedi({ email: SCONOSCIUTO }),
    ];
    for (const r of risposte) expect(r.status).toBe(202);
    const [attivo, ...altre] = await Promise.all(
      risposte.map(async (r) => ({
        corpo: await r.text(),
        intestazioni: Object.fromEntries(r.headers),
      }))
    );
    expect(attivo!.corpo).toBe('{"ok":true}');
    for (const altra of altre) expect(altra).toEqual(attivo);
  });

  it('prima di rispondere non si cerca l’account: il tempo non lo rivela', async () => {
    await chiedi({ email: INDIRIZZO });
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.staffLoginToken.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(dopoLaRisposta).toHaveLength(1);
  });

  it('l’indirizzo non finisce nella risposta ne’ nei log', async () => {
    const r = await chiedi({ email: INDIRIZZO });
    await finisciIlLavoro();
    expect(await r.text()).not.toContain(INDIRIZZO);
    expect(scrittoNeiLog()).not.toContain(INDIRIZZO);
    expect(scrittoNeiLog()).not.toContain('Anna');
  });
});

describe('chi riceve il link', () => {
  it('un account attivo riceve il link, e nel database resta solo l’hash', async () => {
    await chiedi({ email: INDIRIZZO });
    await finisciIlLavoro();
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(enqueueEmail.mock.calls[0]![0].to).toBe(INDIRIZZO);

    const token = linkNellaMail().searchParams.get('t') ?? '';
    expect(token.length).toBeGreaterThan(20);
    const { data } = prisma.staffLoginToken.create.mock.calls[0]![0] as {
      data: { accountId: string; tokenHash: string; expiresAt: Date };
    };
    expect(data.accountId).toBe(ACCOUNT_ID);
    expect(data.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('l’account si cerca per impronta, senza badare a maiuscole e spazi', async () => {
    await chiedi({ email: '  Anna.Bianchi@Example.com  ' });
    await finisciIlLavoro();
    const { where } = prisma.staffAccount.findUnique.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(where).toEqual({ emailHash: hashEmail(INDIRIZZO) });
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
  });

  it('un account disattivato non riceve niente', async () => {
    await chiedi({ email: DISATTIVATO });
    await finisciIlLavoro();
    expect(prisma.staffAccount.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.staffLoginToken.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('un indirizzo sconosciuto non produce token ne’ email', async () => {
    await chiedi({ email: SCONOSCIUTO });
    await finisciIlLavoro();
    expect(prisma.staffAccount.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.staffLoginToken.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('il link segue la lingua della pagina, l’italiano se non e’ indicata', async () => {
    await chiedi({ email: INDIRIZZO, locale: 'en' });
    await finisciIlLavoro();
    expect(linkNellaMail().pathname).toBe('/en/admin/access');

    enqueueEmail.mockClear();
    await chiedi({ email: INDIRIZZO });
    await finisciIlLavoro();
    expect(linkNellaMail().pathname).toBe('/it/admin/accesso');
  });

  it('una lingua che la piattaforma non ha non spreca il token', async () => {
    await chiedi({ email: INDIRIZZO, locale: 'xx' });
    await finisciIlLavoro();
    expect(linkNellaMail().pathname).toBe('/it/admin/accesso');
  });
});

describe('i limiti', () => {
  it('dalla sesta richiesta in un minuto lo stesso indirizzo IP riceve 429', async () => {
    const insistente = '10.6.200.1';
    for (let i = 0; i < 5; i += 1) {
      expect((await chiedi({ email: `p${i}@example.com` }, insistente)).status).toBe(202);
    }
    dopoLaRisposta.length = 0;
    const fermato = await chiedi({ email: INDIRIZZO }, insistente);
    expect(fermato.status).toBe(429);
    expect(Number(fermato.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(dopoLaRisposta).toHaveLength(0);
  });

  it('oltre tre richieste per la stessa casella dalla stessa rete non parte altro, e non si vede', async () => {
    const rete = '10.6.200.2';
    const risposte = [];
    for (let i = 0; i < 4; i += 1)
      risposte.push(await chiedi({ email: INDIRIZZO }, rete));
    expect(dopoLaRisposta).toHaveLength(3);
    const quarta = risposte[3]!;
    expect(quarta.status).toBe(202);
    await expect(quarta.text()).resolves.toBe('{"ok":true}');
  });

  it('il limite della coppia non tiene fuori la persona da un’altra rete', async () => {
    const email = 'chiara.verdi@example.com';
    for (let i = 0; i < 4; i += 1) await chiedi({ email }, '10.6.200.3');
    dopoLaRisposta.length = 0;
    await chiedi({ email }, '10.6.200.4');
    expect(dopoLaRisposta).toHaveLength(1);
  });

  it('una sola rete non esaurisce il limite largo dell’indirizzo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const email = 'paola.neri@example.com';
      // Oltre il limite largo, dalla stessa rete: quelle fermate dalla coppia non contano.
      for (let i = 0; i < 25; i += 1) {
        if (i % 5 === 0) vi.advanceTimersByTime(61_000);
        await chiedi({ email }, '10.6.210.1');
      }
      dopoLaRisposta.length = 0;
      await chiedi({ email }, '10.6.210.2');
      expect(dopoLaRisposta).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('il limite della coppia non ferma le altre caselle della stessa rete', async () => {
    const rete = '10.6.200.5';
    for (let i = 0; i < 4; i += 1) {
      await chiedi({ email: 'luca.neri@example.com' }, rete);
    }
    dopoLaRisposta.length = 0;
    await chiedi({ email: 'sara.gialli@example.com' }, rete);
    expect(dopoLaRisposta).toHaveLength(1);
  });

  it('oltre venti invii in un’ora la casella si ferma da ogni rete', async () => {
    const email = 'paola.blu@example.com';
    for (let i = 1; i <= 20; i += 1) await chiedi({ email }, `10.6.201.${i}`);
    expect(dopoLaRisposta).toHaveLength(20);
    dopoLaRisposta.length = 0;
    const r = await chiedi({ email }, '10.6.201.21');
    expect(r.status).toBe(202);
    expect(dopoLaRisposta).toHaveLength(0);
  });

  it('maiuscole diverse non aprono un contatore nuovo', async () => {
    const rete = '10.6.200.6';
    for (const email of [
      'elena.viola@example.com',
      'Elena.Viola@example.com',
      'ELENA.VIOLA@example.com',
      'elena.VIOLA@example.com',
    ]) {
      await chiedi({ email }, rete);
    }
    expect(dopoLaRisposta).toHaveLength(3);
  });
});

describe('la richiesta', () => {
  it('senza un indirizzo valido e’ 422, e non parte niente', async () => {
    const troppoLungo = `${'a'.repeat(60)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(
      60
    )}.${'e'.repeat(10)}.example.com`;
    for (const corpo of [
      {},
      { email: 'non-una-email' },
      { email: 42 },
      { email: troppoLungo },
      { email: INDIRIZZO, locale: 'i' },
      { email: INDIRIZZO, locale: 'lingua-lunga' },
      null,
    ]) {
      expect((await chiedi(corpo)).status).toBe(422);
    }
    expect(dopoLaRisposta).toHaveLength(0);
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await chiedi('non json')).status).toBe(400);
    expect(dopoLaRisposta).toHaveLength(0);
  });
});
