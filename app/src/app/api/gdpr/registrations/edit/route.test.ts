// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SelfService from '@/lib/gdpr/registration-self-service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  invia: vi.fn(async (_c: { codice: string }) => undefined),
  correggi: vi.fn(async () => ({ iscrizioni: 1, voceDiRubrica: false })),
}));
vi.mock('@/lib/db', () => ({
  prisma: { registration: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar' }),
}));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));
vi.mock('@/lib/email/confirmation-code', () => ({ inviaCodiceDiConferma: mocks.invia }));
vi.mock('@/lib/gdpr/registration-self-service', async (originale) => ({
  ...(await originale<typeof SelfService>()),
  correggiIscrizioni: mocks.correggi,
}));

import { emettiCodice, improntaValori } from '@/lib/gdpr/confirmation-code';
import { registraEmissione } from '@/lib/gdpr/confirmation-store';
import { issueGdprToken } from '@/lib/gdpr/request-token';

import { POST } from './route';

const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
let ip = 0;
// Un indirizzo per prova: i conteggi per indirizzo valgono per tutto il processo.
let hash = '';

function chiama(corpo: Record<string, unknown>) {
  ip += 1;
  return POST(
    new Request('http://localhost/api/gdpr/registrations/edit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${ip % 250}`,
      },
      body: JSON.stringify(corpo),
    }) as never,
    { params: Promise.resolve({}) } as never
  );
}
const corpo = () => ({
  token: issueGdprToken('consents', hash),
  registrationId: ISCRIZIONE,
  scope: 'registration',
  displayName: 'Anna Bianchi',
  organization: 'Comune',
  locale: 'de',
});
/** Il primo passo: il codice arriva per email (qui, all'invio finto). */
async function codiceMandato(c = corpo()) {
  const res = await chiama(c);
  expect(res.status).toBe(202);
  const { issuedAt } = (await res.json()) as { issuedAt: number };
  const codice = mocks.invia.mock.calls.at(-1)![0].codice;
  return { codice, issuedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_SECRET', 'segreto-delle-prove-della-correzione-abbastanza-lungo');
  hash = randomBytes(32).toString('hex');
  mocks.findFirst.mockResolvedValue({
    id: ISCRIZIONE,
    eventId: 'e1',
    email: 'cifrata',
    locale: 'it',
    event: { title: { it: 'Riunione', de: 'Sitzung' } },
  });
  mocks.findMany.mockResolvedValue([
    { id: ISCRIZIONE, event: { requireOrganization: false } },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/gdpr/registrations/edit', () => {
  it('senza codice manda il codice all’indirizzo dell’iscrizione, nella lingua della pagina', async () => {
    const res = await chiama(corpo());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ codeSent: true, expiresInMinutes: 15 });
    expect(mocks.invia).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'chiaro:cifrata',
        locale: 'de',
        azione: 'edit',
        tutte: false,
        eventTitle: 'Sitzung',
        registrationId: ISCRIZIONE,
      })
    );
    expect(mocks.correggi).not.toHaveBeenCalled();
  });

  it('con il codice mandato corregge, con i valori ripuliti, e il codice vale una volta', async () => {
    const { codice, issuedAt } = await codiceMandato();
    const conCodice = {
      ...corpo(),
      displayName: ' Anna Bianchi ',
      code: codice,
      issuedAt,
    };
    expect((await chiama(conCodice)).status).toBe(200);
    expect(mocks.correggi).toHaveBeenCalledWith(hash, ISCRIZIONE, 'registration', {
      displayName: 'Anna Bianchi',
      organization: 'Comune',
    });
    expect((await chiama(conCodice)).status).toBe(403);
    expect(mocks.correggi).toHaveBeenCalledTimes(1);
  });

  it('due richieste insieme con il codice giusto: la modifica si fa una volta', async () => {
    const { codice, issuedAt } = await codiceMandato();
    const conCodice = { ...corpo(), code: codice, issuedAt };
    const stati = (await Promise.all([chiama(conCodice), chiama(conCodice)])).map(
      (r) => r.status
    );
    expect(stati.sort()).toEqual([200, 403]);
    expect(mocks.correggi).toHaveBeenCalledTimes(1);
  });

  it('se la correzione fallisce il codice torna valido', async () => {
    const { codice, issuedAt } = await codiceMandato();
    mocks.correggi.mockRejectedValueOnce(new Error('database lento'));
    const conCodice = { ...corpo(), code: codice, issuedAt };
    expect((await chiama(conCodice)).status).toBe(500);
    expect((await chiama(conCodice)).status).toBe(200);
    expect(mocks.correggi).toHaveBeenCalledTimes(2);
  });

  it('un codice giusto ma mai mandato non vale: si indovina solo dopo un’email', async () => {
    const { codice, emessoIl } = emettiCodice({
      azione: 'edit',
      emailHash: hash,
      oggetto: ISCRIZIONE,
      impronta: improntaValori({
        displayName: 'Anna Bianchi',
        organization: 'Comune',
        scope: 'registration',
      }),
    });
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      403
    );
    expect(mocks.correggi).not.toHaveBeenCalled();
  });

  it('un codice di altri valori, o di tutto l’indirizzo, non corregge', async () => {
    const { codice, issuedAt } = await codiceMandato();
    expect(
      (await chiama({ ...corpo(), displayName: 'Altro Nome', code: codice, issuedAt }))
        .status
    ).toBe(403);
    expect(
      (await chiama({ ...corpo(), scope: 'address', code: codice, issuedAt })).status
    ).toBe(403);
    expect(mocks.correggi).not.toHaveBeenCalled();
  });

  it('dopo cinque tentativi sbagliati anche il codice giusto non vale piu’', async () => {
    const { codice, issuedAt } = await codiceMandato();
    const sbagliato = String((Number(codice) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) {
      expect((await chiama({ ...corpo(), code: sbagliato, issuedAt })).status).toBe(403);
    }
    expect((await chiama({ ...corpo(), code: codice, issuedAt })).status).toBe(403);
    expect(mocks.correggi).not.toHaveBeenCalled();
  });

  it('il link dell’email non vale: serve il token della pagina', async () => {
    const res = await chiama({ ...corpo(), token: issueGdprToken('export', hash) });
    expect(res.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('cerca l’iscrizione solo fra quelle dell’indirizzo del token', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await chiama(corpo())).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ISCRIZIONE, emailHash: hash } })
    );
    expect(mocks.invia).not.toHaveBeenCalled();
  });

  it('codice e ora di emissione vanno insieme; i campi in piu’ sono un errore', async () => {
    expect((await chiama({ ...corpo(), code: '123456' })).status).toBe(422);
    expect((await chiama({ ...corpo(), email: 'altra@example.org' })).status).toBe(422);
  });

  it('un ente troppo lungo lo dice con il suo testo', async () => {
    const res = await chiama({ ...corpo(), organization: 'x'.repeat(201) });
    expect(res.status).toBe(422);
    expect((await res.json()).details).toEqual([
      { path: ['organization'], message: 'gdpr.export.editOrganizationTooLong' },
    ]);
  });

  it('dopo cinque codici in un’ora per lo stesso indirizzo risponde 429', async () => {
    for (let i = 0; i < 5; i++) expect((await chiama(corpo())).status).toBe(202);
    expect((await chiama(corpo())).status).toBe(429);
    expect(mocks.invia).toHaveBeenCalledTimes(5);
  });

  it('un’emissione annotata senza email resta valida solo per la sua richiesta', async () => {
    // Il registro si consulta con la richiesta intera: un'emissione per un'altra
    // iscrizione non apre questa.
    const altra = {
      azione: 'edit' as const,
      emailHash: hash,
      oggetto: '22222222-2222-4222-8222-222222222222',
      impronta: improntaValori({
        displayName: 'Anna Bianchi',
        organization: 'Comune',
        scope: 'registration',
      }),
    };
    const { codice, emessoIl } = emettiCodice(altra);
    expect(await registraEmissione(altra, emessoIl)).toBe('ok');
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      403
    );
  });
});
