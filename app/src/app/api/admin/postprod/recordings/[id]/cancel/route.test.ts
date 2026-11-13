// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Fermare la post-produzione di una registrazione: lo fa chi gestisce l’evento
 * della registrazione, e tocca soltanto i lavori ancora aperti di quella
 * registrazione, cosi’ da non cambiare l’esito di quelli gia’ finiti.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sessione } = vi.hoisted(() => {
  const tx = {
    postprodJob: { updateMany: vi.fn() },
    recording: { updateMany: vi.fn() },
  };
  return {
    tx,
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      event: { count: vi.fn() },
      recording: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';

import { POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const REGISTRAZIONE = '33333333-3333-4333-8333-333333333333';

function ferma(id = REGISTRAZIONE) {
  const request = new Request(
    `http://localhost/api/admin/postprod/recordings/${id}/cancel`,
    {
      method: 'POST',
    }
  );
  return POST(request as never, { params: Promise.resolve({ id }) });
}

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const nessunaScrittura = () => {
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(tx.postprodJob.updateMany).not.toHaveBeenCalled();
  expect(tx.recording.updateMany).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-della-post-produzione-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.recording.findUnique.mockResolvedValue({ id: REGISTRAZIONE, eventId: EVENTO });
  tx.postprodJob.updateMany.mockResolvedValue({ count: 2 });
});

describe('chi puo’ fermare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await ferma()).status).toBe(401);
    nessunaScrittura();
  });

  it('la registrazione di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await ferma()).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    nessunaScrittura();
  });

  it('per chi organizza, una registrazione inesistente risponde come una altrui', async () => {
    await entra('ORGANIZER');
    prisma.recording.findUnique.mockResolvedValue(null);
    expect((await ferma()).status).toBe(403);
    nessunaScrittura();
  });

  it('chi organizza ferma la registrazione di un proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await ferma()).status).toBe(200);
    expect(tx.postprodJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it('per l’amministrazione una registrazione inesistente e’ 404', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);
    expect((await ferma()).status).toBe(404);
    nessunaScrittura();
  });
});

describe('cosa si ferma', () => {
  it('una registrazione ferma in coda esce anche senza lavori aperti', async () => {
    tx.postprodJob.updateMany.mockResolvedValue({ count: 0 });
    expect((await ferma()).status).toBe(200);
    expect(tx.recording.updateMany).toHaveBeenCalledTimes(1);
  });

  it('fallisce solo cio’ che e’ ancora in coda: una registrazione pronta resta pronta', async () => {
    await ferma();
    expect(tx.recording.updateMany.mock.calls[0]![0].where).toEqual({
      id: REGISTRAZIONE,
      status: { in: ['POSTPROD_QUEUED', 'POSTPROD_RUNNING'] },
    });
  });

  it('solo i lavori aperti di questa registrazione', async () => {
    await ferma();
    const { where, data } = tx.postprodJob.updateMany.mock.calls[0]![0];
    expect(where).toEqual({
      recordingId: REGISTRAZIONE,
      status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
    });
    expect(data).toMatchObject({ status: 'FAILED', lastError: expect.any(String) });
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('con lavori fermati la registrazione risulta fallita', async () => {
    const r = await ferma();
    expect(tx.recording.updateMany.mock.calls[0]![0].data).toEqual({
      status: 'POSTPROD_FAILED',
    });
    expect(await r.json()).toEqual({ ok: true, cancelled: 2 });
  });

  it('lascia traccia di quanti lavori ha fermato', async () => {
    await ferma();
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'POSTPROD_CANCEL',
      target: REGISTRAZIONE,
      details: JSON.stringify({ cancelled: 2 }),
    });
  });
});
