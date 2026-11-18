// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trova, registra } = vi.hoisted(() => ({ trova: vi.fn(), registra: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: { recordingRedactionRequest: { findFirst: trova, findUnique: trova } },
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: registra }));

import {
  derogaPerRimozione,
  registraAccessoInDeroga,
  richiestaAperta,
  richiestaInDeroga,
} from './access';

const REC = '11111111-1111-4111-8111-111111111111';
const RICHIESTA = '22222222-2222-4222-8222-222222222222';
const ADMIN = {
  role: 'admin' as const,
  accountId: '33333333-3333-4333-8333-333333333333',
};

beforeEach(() => {
  trova.mockReset();
  registra.mockReset();
});

describe('la deroga per una richiesta di rimozione', () => {
  it('vale per un amministratore con un account e una richiesta aperta su quella registrazione', async () => {
    trova.mockResolvedValue({ id: RICHIESTA, recordingId: REC, eventId: 'e' });
    expect(await derogaPerRimozione(ADMIN, REC)).toEqual({
      requestId: RICHIESTA,
      recordingId: REC,
      eventId: 'e',
      accountId: ADMIN.accountId,
    });
    const filtro = trova.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(filtro.where).toMatchObject({
      recordingId: REC,
      status: { in: ['OPEN', 'IN_PROGRESS', 'PROCESSING'] },
    });
  });

  it('con la richiesta indicata, solo quella', async () => {
    trova.mockResolvedValue(null);
    expect(await derogaPerRimozione(ADMIN, REC, { requestId: RICHIESTA })).toBeNull();
    expect(
      (trova.mock.calls[0]![0] as { where: Record<string, unknown> }).where
    ).toMatchObject({ id: RICHIESTA });
  });

  it('mai alla chiave dell’istanza, a chi organizza o senza sessione: non si chiede nemmeno', async () => {
    expect(await derogaPerRimozione({ role: 'admin', accountId: null }, REC)).toBeNull();
    expect(
      await derogaPerRimozione({ role: 'organizer', accountId: 'x', emailHash: 'h' }, REC)
    ).toBeNull();
    expect(await derogaPerRimozione(null, REC)).toBeNull();
    expect(trova).not.toHaveBeenCalled();
  });

  it('gli stati aperti', () => {
    expect(richiestaAperta('OPEN')).toBe(true);
    expect(richiestaAperta('PROCESSING')).toBe(true);
    expect(richiestaAperta('CLOSED')).toBe(false);
    expect(richiestaAperta('REJECTED')).toBe(false);
  });
});

describe('le rotte dell’editor', () => {
  it('404 per una richiesta che non c’e’, 403 senza deroga', async () => {
    await expect(richiestaInDeroga(ADMIN, 'non-uuid')).rejects.toMatchObject({
      statusCode: 404,
    });
    trova.mockResolvedValueOnce(null);
    await expect(richiestaInDeroga(ADMIN, RICHIESTA)).rejects.toMatchObject({
      statusCode: 404,
    });
    trova.mockResolvedValueOnce({ recordingId: REC });
    await expect(
      richiestaInDeroga({ role: 'admin', accountId: null }, RICHIESTA)
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REDACTION_ACCESS_DENIED',
    });
  });

  it('ogni accesso va nel registro con l’account e senza dati della persona', async () => {
    await registraAccessoInDeroga(
      new Request('http://localhost/x'),
      {
        requestId: RICHIESTA,
        recordingId: REC,
        eventId: 'e',
        accountId: ADMIN.accountId,
      },
      'media'
    );
    expect(registra).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RECORDING_REDACTION_ACCESS',
        target: REC,
        details: { requestId: RICHIESTA, eventId: 'e', resource: 'media' },
        actor: `admin:${ADMIN.accountId}`,
      })
    );
  });
});
