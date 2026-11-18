// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SelfService from '@/lib/gdpr/registration-self-service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  invia: vi.fn(async () => undefined),
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
import { issueGdprToken } from '@/lib/gdpr/request-token';

import { POST } from './route';

const HASH = 'b'.repeat(64);
const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
let ip = 0;

function chiama(corpo: Record<string, unknown>) {
  ip += 1;
  return POST(
    new Request('http://localhost/api/gdpr/registrations/edit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${ip}`,
      },
      body: JSON.stringify(corpo),
    }) as never,
    { params: Promise.resolve({}) } as never
  );
}
const corpo = () => ({
  token: issueGdprToken('consents', HASH),
  registrationId: ISCRIZIONE,
  scope: 'registration',
  displayName: 'Anna Bianchi',
  organization: 'Comune',
  locale: 'de',
});
const codicePer = (
  valori = { displayName: 'Anna Bianchi', organization: 'Comune', scope: 'registration' }
) =>
  emettiCodice({
    azione: 'edit',
    emailHash: HASH,
    oggetto: ISCRIZIONE,
    impronta: improntaValori(valori),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_SECRET', 'segreto-delle-prove-della-correzione-abbastanza-lungo');
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

  it('con il codice giusto corregge, con i valori ripuliti', async () => {
    const { codice, emessoIl } = codicePer();
    const res = await chiama({
      ...corpo(),
      displayName: ' Anna Bianchi ',
      code: codice,
      issuedAt: emessoIl,
    });
    expect(res.status).toBe(200);
    expect(mocks.correggi).toHaveBeenCalledWith(HASH, ISCRIZIONE, 'registration', {
      displayName: 'Anna Bianchi',
      organization: 'Comune',
    });
    expect(mocks.invia).not.toHaveBeenCalled();
  });

  it('un codice di altri valori, o di tutto l’indirizzo, non corregge', async () => {
    const { codice, emessoIl } = codicePer({
      displayName: 'Altro',
      organization: 'Comune',
      scope: 'registration',
    });
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      403
    );
    const tutte = emettiCodice({
      azione: 'edit',
      emailHash: HASH,
      oggetto: 'address:',
      impronta: improntaValori({
        displayName: 'Anna Bianchi',
        organization: 'Comune',
        scope: 'registration',
      }),
    });
    expect(
      (await chiama({ ...corpo(), code: tutte.codice, issuedAt: tutte.emessoIl })).status
    ).toBe(403);
    expect(mocks.correggi).not.toHaveBeenCalled();
  });

  it('il link dell’email non vale: serve il token della pagina', async () => {
    const res = await chiama({ ...corpo(), token: issueGdprToken('export', HASH) });
    expect(res.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('cerca l’iscrizione solo fra quelle dell’indirizzo del token', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await chiama(corpo())).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ISCRIZIONE, emailHash: HASH } })
    );
    expect(mocks.invia).not.toHaveBeenCalled();
  });

  it('codice e ora di emissione vanno insieme; i campi in piu’ sono un errore', async () => {
    expect((await chiama({ ...corpo(), code: '123456' })).status).toBe(422);
    expect((await chiama({ ...corpo(), email: 'altra@example.org' })).status).toBe(422);
  });

  it('dopo tre codici in un’ora per lo stesso indirizzo risponde 429', async () => {
    const altro = 'c'.repeat(64);
    const conToken = () => ({ ...corpo(), token: issueGdprToken('consents', altro) });
    for (let i = 0; i < 3; i++) expect((await chiama(conToken())).status).toBe(202);
    expect((await chiama(conToken())).status).toBe(429);
    expect(mocks.invia).toHaveBeenCalledTimes(3);
  });
});
