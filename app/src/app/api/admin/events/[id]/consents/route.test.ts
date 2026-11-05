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
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("il CSV porta i nomi, nella lingua chiesta, e l'esportazione resta nel registro GDPR", async () => {
    const res = await chiedi('?format=csv&locale=it');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const testo = await res.text();
    expect(testo).toContain('Mario Rossi');
    expect(testo).toContain('Registrazione;sala;ospite');
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
        holder: 'posto:g',
      },
    ]);
    const testo = await (await chiedi('?format=csv&locale=it-IT')).text();
    expect(testo).toContain('(nome non leggibile)');
  });
});
