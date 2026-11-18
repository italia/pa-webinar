// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  invia: vi.fn(async (_c: { codice: string }) => undefined),
  cancella: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { registration: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar' }),
}));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));
vi.mock('@/lib/email/confirmation-code', () => ({ inviaCodiceDiConferma: mocks.invia }));
vi.mock('@/lib/gdpr/registration-self-service', () => ({
  cancellaIscrizione: mocks.cancella,
}));

import { emettiCodice } from '@/lib/gdpr/confirmation-code';
import { registraEmissione } from '@/lib/gdpr/confirmation-store';
import { issueGdprToken } from '@/lib/gdpr/request-token';

import { POST } from './route';

const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
let ip = 0;
let hash = '';

function chiama(corpo: Record<string, unknown>) {
  ip += 1;
  return POST(
    new Request('http://localhost/api/gdpr/registrations/cancel', {
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
});
async function codiceMandato() {
  const res = await chiama(corpo());
  expect(res.status).toBe(202);
  const { issuedAt } = (await res.json()) as { issuedAt: number };
  return { codice: mocks.invia.mock.calls.at(-1)![0].codice, issuedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_SECRET', 'segreto-delle-prove-della-cancellazione-abbastanza-lungo');
  hash = randomBytes(32).toString('hex');
  mocks.findFirst.mockResolvedValue({
    id: ISCRIZIONE,
    eventId: 'e1',
    email: 'cifrata',
    locale: 'fr',
    event: { title: { it: 'Riunione', fr: 'Réunion' } },
  });
  mocks.cancella.mockResolvedValue({ registrations: 1, consentProofsKept: 2 });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/gdpr/registrations/cancel', () => {
  it('senza codice lo manda, nella lingua dell’iscrizione se la pagina non la dice', async () => {
    const res = await chiama(corpo());
    expect(res.status).toBe(202);
    expect(mocks.invia).toHaveBeenCalledWith(
      expect.objectContaining({ azione: 'cancel', locale: 'fr', eventTitle: 'Réunion' })
    );
    expect(mocks.cancella).not.toHaveBeenCalled();
  });

  it('con il codice mandato per questa iscrizione cancella, e dice quante prove restano', async () => {
    const { codice, issuedAt } = await codiceMandato();
    const res = await chiama({ ...corpo(), code: codice, issuedAt });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1, consentProofsKept: 2 });
    expect(mocks.cancella).toHaveBeenCalledWith(hash, ISCRIZIONE);
  });

  it('un codice di correzione non cancella, anche se e’ stato mandato', async () => {
    const correzione = {
      azione: 'edit' as const,
      emailHash: hash,
      oggetto: ISCRIZIONE,
      impronta: '',
    };
    const { codice, emessoIl } = emettiCodice(correzione);
    await registraEmissione(correzione, emessoIl);
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      403
    );
    expect(mocks.cancella).not.toHaveBeenCalled();
  });

  it('un’iscrizione gia’ cancellata risponde 404', async () => {
    mocks.cancella.mockResolvedValue(null);
    const { codice, issuedAt } = await codiceMandato();
    expect((await chiama({ ...corpo(), code: codice, issuedAt })).status).toBe(404);
  });

  it('dopo dieci verifiche in un’ora per lo stesso indirizzo risponde 429', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await chiama({ ...corpo(), code: '000000', issuedAt: 1 })).status).toBe(
        403
      );
    }
    expect((await chiama({ ...corpo(), code: '000000', issuedAt: 1 })).status).toBe(429);
  });

  it('senza il token della pagina non manda niente', async () => {
    expect(
      (await chiama({ ...corpo(), token: issueGdprToken('erasure', hash) })).status
    ).toBe(401);
    expect(mocks.invia).not.toHaveBeenCalled();
  });
});
