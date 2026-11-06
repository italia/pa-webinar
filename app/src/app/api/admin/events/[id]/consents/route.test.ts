// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

import type * as ProveConsenso from '@/lib/gdpr/consent-proofs';

const m = vi.hoisted(() => ({
  manager: vi.fn(),
  prove: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
// I testi veri dell'italiano, letti per chiave puntata come next-intl.
vi.mock('next-intl/server', async () => {
  const it = (await import('@/i18n/messages/it.json')).default;
  return {
    getTranslations: vi.fn(
      async () => (key: string) =>
        key
          .split('.')
          .reduce<unknown>(
            (o, k) => (o as Record<string, unknown>)[k],
            it.admin.consentProofs.csv
          )
    ),
  };
});
vi.mock('@/lib/auth/staff-session', () => ({ requireEventManager: m.manager }));
vi.mock('@/lib/db', () => ({ prisma: { gdprAuditLog: { create: m.audit } } }));
vi.mock('@/lib/gdpr/consent-proofs', async (orig) => ({
  ...(await orig<typeof ProveConsenso>()),
  proveConsensoEvento: m.prove,
}));

import { GET } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const chiedi = (query = '', id = ID) =>
  GET(
    new Request(
      `http://localhost/api/admin/events/${id}/consents${query}`
    ) as unknown as NextRequest,
    {
      params: Promise.resolve({ id }),
    }
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.prove.mockResolvedValue([
    {
      kind: 'recording',
      source: 'room',
      role: 'guest',
      name: 'Mario Rossi',
      givenAt: '2026-11-01T10:00:00.000Z',
      withdrawnAt: null,
      textVersion: null,
      destination: 'PUBLIC',
      nomeRimosso: false,
      conservata: false,
      holder: 'ospite',
    },
  ]);
});

describe('GET admin/events/[id]/consents', () => {
  it("in JSON solo il riepilogo, senza nomi; solo per chi gestisce l'evento", async () => {
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect(m.manager).toHaveBeenCalledWith(expect.anything(), ID);
    // Per il riepilogo i nomi non si decifrano.
    expect(m.prove).toHaveBeenCalledWith(ID, { nomi: false });
    const testo = await res.text();
    expect(testo).not.toContain('Mario');
    expect(JSON.parse(testo)).toEqual({
      summary: {
        recording: { given: 1, withdrawn: 0 },
        transcription: { given: 0, withdrawn: 0 },
      },
      total: 1,
      retained: 0,
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("il CSV porta i nomi, nella lingua chiesta, e l'esportazione resta nel registro GDPR", async () => {
    const res = await chiedi('?format=csv&locale=it');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const testo = await res.text();
    expect(testo).toContain('Mario Rossi');
    expect(testo).toContain('Registrazione;sala;ospite');
    expect(testo.split('\n')[0]).toContain(';Destinazione');
    expect(testo).toContain(';Pubblica');
    expect(m.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: ID,
        action: 'DATA_EXPORTED',
        recordCount: 1,
      }),
    });
  });

  it("senza gestione dell'evento non legge niente", async () => {
    m.manager.mockRejectedValueOnce(Object.assign(new Error('no'), { statusCode: 403 }));
    await chiedi().catch(() => null);
    expect(m.prove).not.toHaveBeenCalled();
  });

  it('un nome che non si decifra si dice nel CSV', async () => {
    m.prove.mockResolvedValueOnce([
      {
        kind: 'transcription',
        source: 'room',
        role: 'guest',
        name: null,
        givenAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: null,
        textVersion: 2,
        destination: null,
        nomeRimosso: false,
        conservata: false,
        holder: 'posto:g',
      },
    ]);
    const testo = await (await chiedi('?format=csv&locale=it-IT')).text();
    expect(testo).toContain('(nome non leggibile)');
  });

  it('un nome tolto su richiesta si dice per quello che e’', async () => {
    m.prove.mockResolvedValueOnce([
      {
        kind: 'recording',
        source: 'registration',
        role: 'registrant',
        name: null,
        givenAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: '2026-11-02T10:00:00.000Z',
        textVersion: null,
        destination: null,
        nomeRimosso: true,
        conservata: true,
        holder: 'impronta',
      },
    ]);
    const testo = await (await chiedi('?format=csv&locale=it')).text();
    expect(testo).toContain('(nome rimosso su richiesta)');
    expect(testo).not.toContain('(nome non leggibile)');
    expect(testo).toContain(';Non indicata');
  });

  it('la destinazione si dice solo per la registrazione', async () => {
    m.prove.mockResolvedValueOnce([
      {
        kind: 'transcription',
        source: 'room',
        role: 'guest',
        name: 'Mario Rossi',
        givenAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: null,
        textVersion: 2,
        destination: null,
        nomeRimosso: false,
        conservata: false,
        holder: 'posto:g',
      },
    ]);
    const testo = await (await chiedi('?format=csv&locale=it')).text();
    expect(testo).not.toContain('Non indicata');
  });

  describe('un periodo sostituito, poi il ritiro', () => {
    const periodo = {
      kind: 'recording',
      source: 'room',
      role: 'registrant',
      name: 'Anna Bianchi',
      textVersion: 1,
      nomeRimosso: false,
      conservata: false,
      holder: 'iscritta',
    };
    const RITIRO = '2026-11-03T10:00:00.000Z';
    beforeEach(() => {
      m.prove.mockResolvedValueOnce([
        {
          ...periodo,
          givenAt: '2026-11-01T10:00:00.000Z',
          withdrawnAt: null,
          destination: 'REGISTRANTS',
          superata: true,
        },
        {
          ...periodo,
          givenAt: '2026-11-02T10:00:00.000Z',
          withdrawnAt: RITIRO,
          destination: 'PUBLIC',
          superata: false,
        },
      ]);
    });

    it('il riepilogo conta il ritiro; le prove restano due', async () => {
      expect(await (await chiedi()).json()).toMatchObject({
        total: 2,
        summary: { recording: { given: 0, withdrawn: 1 } },
      });
    });

    it('il CSV distingue il periodo sostituito dal ritiro', async () => {
      const testo = await (await chiedi('?format=csv&locale=it')).text();
      const [intestazione, sostituito, ritirato] = testo.trim().split('\n');
      expect(intestazione).toContain(';Ritirato il;');
      expect(intestazione!.trim().endsWith(';Sostituito')).toBe(true);
      // Senza ora del ritiro, e con la colonna che dice perche'.
      expect(sostituito!.trim().endsWith(';;1;Riservata;Da un consenso successivo')).toBe(
        true
      );
      expect(ritirato!.trim().endsWith(`;${RITIRO};1;Pubblica;`)).toBe(true);
    });
  });

  it('il riepilogo comprende le prove conservate, e dice quante sono', async () => {
    m.prove.mockResolvedValueOnce([
      {
        kind: 'recording',
        source: 'room',
        role: 'registrant',
        name: null,
        givenAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: null,
        textVersion: null,
        destination: null,
        nomeRimosso: false,
        conservata: true,
        holder: 'impronta',
      },
    ]);
    expect(await (await chiedi()).json()).toMatchObject({ total: 1, retained: 1 });
  });
});
