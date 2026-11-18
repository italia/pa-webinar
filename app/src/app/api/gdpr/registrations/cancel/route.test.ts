// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  invia: vi.fn(async () => undefined),
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
import { issueGdprToken } from '@/lib/gdpr/request-token';

import { POST } from './route';

const HASH = 'b'.repeat(64);
const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
let ip = 0;

function chiama(corpo: Record<string, unknown>) {
  ip += 1;
  return POST(
    new Request('http://localhost/api/gdpr/registrations/cancel', {
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
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_SECRET', 'segreto-delle-prove-della-cancellazione-abbastanza-lungo');
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

  it('con il codice di questa iscrizione cancella, e dice quante prove restano', async () => {
    const { codice, emessoIl } = emettiCodice({
      azione: 'cancel',
      emailHash: HASH,
      oggetto: ISCRIZIONE,
      impronta: '',
    });
    const res = await chiama({ ...corpo(), code: codice, issuedAt: emessoIl });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1, consentProofsKept: 2 });
    expect(mocks.cancella).toHaveBeenCalledWith(HASH, ISCRIZIONE);
  });

  it('un codice di correzione non cancella', async () => {
    const { codice, emessoIl } = emettiCodice({
      azione: 'edit',
      emailHash: HASH,
      oggetto: ISCRIZIONE,
      impronta: '',
    });
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      403
    );
    expect(mocks.cancella).not.toHaveBeenCalled();
  });

  it('un’iscrizione gia’ cancellata risponde 404', async () => {
    mocks.cancella.mockResolvedValue(null);
    const { codice, emessoIl } = emettiCodice({
      azione: 'cancel',
      emailHash: HASH,
      oggetto: ISCRIZIONE,
      impronta: '',
    });
    expect((await chiama({ ...corpo(), code: codice, issuedAt: emessoIl })).status).toBe(
      404
    );
  });

  it('dopo dieci verifiche in un’ora per lo stesso indirizzo risponde 429', async () => {
    const altro = 'c'.repeat(64);
    const conToken = { ...corpo(), token: issueGdprToken('consents', altro) };
    for (let i = 0; i < 10; i++) {
      expect((await chiama({ ...conToken, code: '000000', issuedAt: 1 })).status).toBe(
        403
      );
    }
    expect((await chiama({ ...conToken, code: '000000', issuedAt: 1 })).status).toBe(429);
  });

  it('senza il token della pagina non manda niente', async () => {
    expect(
      (await chiama({ ...corpo(), token: issueGdprToken('erasure', HASH) })).status
    ).toBe(401);
    expect(mocks.invia).not.toHaveBeenCalled();
  });
});
