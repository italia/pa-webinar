// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Rifare la post-produzione di una registrazione: mai con l’interruttore del
 * sito spento, mai su una trascrizione corretta a mano o su una registrazione
 * senza file, e mai lasciando la registrazione in coda senza lavori.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, accoda, sessione } = vi.hoisted(() => {
  const tx = {
    recording: { findUnique: vi.fn(), update: vi.fn() },
    postprodArtifact: { findFirst: vi.fn() },
  };
  return {
    tx,
    accoda: vi.fn(),
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      event: { count: vi.fn() },
      recording: { findUnique: vi.fn() },
      siteSetting: { findUnique: vi.fn() },
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
vi.mock('@/lib/ai/enqueue', () => ({ enqueuePostprodForRecording: accoda }));

import { erroreConfermaVoci } from '@/lib/ai/voice-consent';
import { signStaffSession } from '@/lib/auth/staff-session';

import { POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const REGISTRAZIONE = '33333333-3333-4333-8333-333333333333';

function rifai(corpo?: unknown, id = REGISTRAZIONE) {
  const request = new Request(
    `http://localhost/api/admin/postprod/recordings/${id}/rerun`,
    {
      method: 'POST',
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
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

const registrazione = (extra: Record<string, unknown> = {}) => ({
  id: REGISTRAZIONE,
  runCount: 1,
  eventId: EVENTO,
  blobKey: 'recordings/sala.mp4',
  event: { aiTranscriptEnabled: true },
  ...extra,
});

const nienteRifatto = () => {
  expect(tx.recording.update).not.toHaveBeenCalled();
  expect(accoda).not.toHaveBeenCalled();
};

const codice = async (r: Response) => ((await r.json()) as { code: string }).code;

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-della-post-produzione-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.recording.findUnique.mockResolvedValue({ eventId: EVENTO });
  prisma.siteSetting.findUnique.mockResolvedValue({ aiPipelineEnabled: true });
  tx.recording.findUnique.mockResolvedValue(registrazione());
  tx.postprodArtifact.findFirst.mockResolvedValue(null);
  accoda.mockResolvedValue({ enqueued: 2, skippedExisting: 0, jobIds: ['j1', 'j2'] });
});

describe('chi puo’ rifare', () => {
  it('senza sessione e’ 401, e non si legge niente', async () => {
    sessione.cookie = undefined;
    expect((await rifai()).status).toBe(401);
    expect(prisma.siteSetting.findUnique).not.toHaveBeenCalled();
    nienteRifatto();
  });

  it('la registrazione di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await rifai()).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteRifatto();
  });

  it('chi organizza rifa’ la registrazione di un proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await rifai()).status).toBe(200);
    expect(accoda).toHaveBeenCalledTimes(1);
  });
});

describe('quando non si puo’', () => {
  it('con l’interruttore del sito spento: 422, prima di ogni modifica', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue({ aiPipelineEnabled: false });
    const r = await rifai({ allVoicesConsented: true });
    expect(r.status).toBe(422);
    expect(await codice(r)).toBe('AI_PIPELINE_DISABLED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteRifatto();
  });

  it('senza la riga delle impostazioni vale come spento', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue(null);
    expect((await rifai()).status).toBe(422);
    nienteRifatto();
  });

  it('una registrazione inesistente e’ 404', async () => {
    tx.recording.findUnique.mockResolvedValue(null);
    expect((await rifai()).status).toBe(404);
    nienteRifatto();
  });

  it('una trascrizione dai sottotitoli corretta a mano non si sostituisce', async () => {
    tx.postprodArtifact.findFirst.mockResolvedValue({ id: 'corretta' });
    const r = await rifai();
    expect(r.status).toBe(409);
    expect(await codice(r)).toBe('TRANSCRIPT_CORRECTED');
    nienteRifatto();
  });

  it('una registrazione senza file non si trascrive', async () => {
    tx.recording.findUnique.mockResolvedValue(registrazione({ blobKey: '' }));
    const r = await rifai();
    expect(r.status).toBe(422);
    expect(await codice(r)).toBe('RECORDING_WITHOUT_MEDIA');
    nienteRifatto();
  });

  it('con la trascrizione spenta sull’evento la registrazione resta dov’e’', async () => {
    tx.recording.findUnique.mockResolvedValue(
      registrazione({ event: { aiTranscriptEnabled: false } })
    );
    const r = await rifai();
    expect(r.status).toBe(422);
    expect(await codice(r)).toBe('AI_DISABLED_FOR_EVENT');
    nienteRifatto();
  });
});

describe('il nuovo giro', () => {
  it('conta un’esecuzione in piu’ e rimette in coda, prima di accodare', async () => {
    const r = await rifai();
    expect(r.status).toBe(200);
    expect(tx.recording.update.mock.calls[0]![0]).toEqual({
      where: { id: REGISTRAZIONE },
      data: { runCount: { increment: 1 }, status: 'POSTPROD_QUEUED' },
    });
    expect(tx.recording.update.mock.invocationCallOrder[0]!).toBeLessThan(
      accoda.mock.invocationCallOrder[0]!
    );
    expect(accoda.mock.calls[0]![0]).toBe(tx);
    expect(accoda.mock.calls[0]![1]).toEqual({
      recordingId: REGISTRAZIONE,
      allVoicesConsented: false,
    });
    expect(await r.json()).toEqual({
      ok: true,
      enqueued: 2,
      skippedExisting: 0,
      jobIds: ['j1', 'j2'],
    });
  });

  it('passa alla coda la conferma sulle voci', async () => {
    await rifai({ allVoicesConsented: true });
    expect(accoda.mock.calls[0]![1]).toMatchObject({ allVoicesConsented: true });
  });

  it('una conferma a false non conferma', async () => {
    await rifai({ allVoicesConsented: false });
    expect(accoda.mock.calls[0]![1]).toMatchObject({ allVoicesConsented: false });
  });

  it('una conferma che non e’ un booleano e’ 422, e non parte niente', async () => {
    expect((await rifai({ allVoicesConsented: 'true' })).status).toBe(422);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteRifatto();
  });

  it('se la coda chiede la conferma il 409 arriva a chi chiama, senza traccia', async () => {
    accoda.mockRejectedValue(erroreConfermaVoci());
    const r = await rifai();
    expect(r.status).toBe(409);
    expect(await codice(r)).toBe(erroreConfermaVoci().code);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('lascia traccia di cosa e’ partito', async () => {
    await rifai({ allVoicesConsented: true });
    const riga = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      target: string;
      details: string;
    };
    expect(riga).toMatchObject({ action: 'POSTPROD_RERUN', target: REGISTRAZIONE });
    expect(JSON.parse(riga.details)).toEqual({
      allVoicesConsented: true,
      enqueued: 2,
      skipped: 0,
    });
  });
});
