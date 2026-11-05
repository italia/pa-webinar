// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Avvio a mano della post-produzione di un evento: lo fa chi gestisce l’evento,
 * mai con l’interruttore del sito spento, e sempre sulla registrazione che ha
 * un file. Una trascrizione corretta a mano non si sostituisce, e la conferma
 * sulle voci si da’ con un booleano, non con qualcosa che gli somiglia.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, accoda, sessione } = vi.hoisted(() => {
  const tx = {
    recording: { findFirst: vi.fn() },
    postprodArtifact: { findFirst: vi.fn() },
    event: { update: vi.fn() },
  };
  return {
    tx,
    accoda: vi.fn(),
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      event: { count: vi.fn() },
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

function avvia(corpo?: unknown, id = EVENTO) {
  const request = new Request(`http://localhost/api/admin/events/${id}/generate-ai`, {
    method: 'POST',
    ...(corpo !== undefined
      ? { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
      : {}),
  });
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

const nienteAvviato = () => {
  expect(tx.event.update).not.toHaveBeenCalled();
  expect(accoda).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-dell-avvio-della-pipeline-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.siteSetting.findUnique.mockResolvedValue({ aiPipelineEnabled: true });
  tx.recording.findFirst.mockResolvedValue({
    id: REGISTRAZIONE,
    blobKey: 'recordings/sala.mp4',
  });
  tx.postprodArtifact.findFirst.mockResolvedValue(null);
  accoda.mockResolvedValue({
    enqueued: 3,
    skippedExisting: 1,
    jobIds: ['j1', 'j2', 'j3'],
  });
});

describe('chi puo’ avviare', () => {
  it('senza sessione e’ 401, e non si legge niente', async () => {
    sessione.cookie = undefined;
    expect((await avvia()).status).toBe(401);
    expect(prisma.siteSetting.findUnique).not.toHaveBeenCalled();
    nienteAvviato();
  });

  it('un identificativo malformato e’ 400', async () => {
    expect((await avvia(undefined, 'non-un-uuid')).status).toBe(400);
    nienteAvviato();
  });

  it('l’evento di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await avvia()).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteAvviato();
  });

  it('chi organizza avvia il proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await avvia()).status).toBe(200);
    expect(accoda).toHaveBeenCalledTimes(1);
  });
});

describe('l’interruttore del sito', () => {
  it('spento: 422 prima di toccare qualunque cosa', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue({ aiPipelineEnabled: false });
    const r = await avvia({ summary: true, allVoicesConsented: true });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe('AI_PIPELINE_DISABLED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteAvviato();
  });

  it('senza la riga delle impostazioni vale come spento', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue(null);
    expect((await avvia()).status).toBe(422);
    nienteAvviato();
  });
});

describe('su quale registrazione', () => {
  it('sceglie la piu’ recente con un file', async () => {
    await avvia();
    expect(tx.recording.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { eventId: EVENTO, blobKey: { not: '' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(accoda.mock.calls[0]![0]).toBe(tx);
    expect(accoda.mock.calls[0]![1]).toMatchObject({ recordingId: REGISTRAZIONE });
  });

  it('senza nessuna registrazione e’ 404', async () => {
    tx.recording.findFirst.mockResolvedValue(null);
    expect((await avvia()).status).toBe(404);
    nienteAvviato();
  });

  it('con i soli sottotitoli lo dice, invece di «nessuna registrazione»', async () => {
    tx.recording.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: REGISTRAZIONE });
    const r = await avvia();
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe('RECORDING_WITHOUT_MEDIA');
    nienteAvviato();
  });

  it('una registrazione senza file non si trascrive', async () => {
    tx.recording.findFirst.mockResolvedValue({ id: REGISTRAZIONE, blobKey: '' });
    const r = await avvia();
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe('RECORDING_WITHOUT_MEDIA');
    nienteAvviato();
  });

  it('una trascrizione dai sottotitoli corretta a mano non si sostituisce', async () => {
    tx.postprodArtifact.findFirst.mockResolvedValue({ id: 'corretta' });
    const r = await avvia();
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe('TRANSCRIPT_CORRECTED');
    expect(tx.postprodArtifact.findFirst.mock.calls[0]![0].where).toMatchObject({
      recordingId: REGISTRAZIONE,
      revisedAt: { not: null },
    });
    nienteAvviato();
  });
});

describe('l’avvio', () => {
  it('senza corpo accende la sola trascrizione', async () => {
    const r = await avvia();
    expect(r.status).toBe(200);
    expect(tx.event.update.mock.calls[0]![0]).toEqual({
      where: { id: EVENTO },
      data: { aiTranscriptEnabled: true },
    });
    expect(accoda.mock.calls[0]![1]).toEqual({
      recordingId: REGISTRAZIONE,
      allVoicesConsented: false,
    });
    expect(await r.json()).toEqual({
      ok: true,
      enqueued: 3,
      skippedExisting: 1,
      jobIds: ['j1', 'j2', 'j3'],
    });
  });

  it('un corpo che non e’ JSON vale come vuoto', async () => {
    expect((await avvia('non-json')).status).toBe(200);
    expect(tx.event.update.mock.calls[0]![0].data).toEqual({ aiTranscriptEnabled: true });
  });

  it('la sintesi si accende solo con true', async () => {
    await avvia({ summary: true });
    expect(tx.event.update.mock.calls[0]![0].data).toEqual({
      aiTranscriptEnabled: true,
      aiSummaryEnabled: true,
    });

    tx.event.update.mockClear();
    await avvia({ summary: 'true' });
    expect(tx.event.update.mock.calls[0]![0].data).toEqual({ aiTranscriptEnabled: true });
  });

  it('accende il flag prima di accodare: la coda legge il flag dalla transazione', async () => {
    await avvia();
    expect(tx.event.update.mock.invocationCallOrder[0]!).toBeLessThan(
      accoda.mock.invocationCallOrder[0]!
    );
  });

  it('passa alla coda la conferma sulle voci', async () => {
    await avvia({ allVoicesConsented: true });
    expect(accoda.mock.calls[0]![1]).toMatchObject({ allVoicesConsented: true });
  });

  it('una conferma che non e’ un booleano e’ 422, e non parte niente', async () => {
    expect((await avvia({ allVoicesConsented: 'true' })).status).toBe(422);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    nienteAvviato();
  });

  it('se la coda chiede la conferma il 409 arriva a chi chiama, senza traccia', async () => {
    accoda.mockRejectedValue(erroreConfermaVoci());
    const r = await avvia();
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe(erroreConfermaVoci().code);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('lascia traccia di cosa e’ partito', async () => {
    await avvia({ allVoicesConsented: true });
    const riga = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      target: string;
      details: string;
    };
    expect(riga).toMatchObject({ action: 'POSTPROD_RERUN', target: EVENTO });
    expect(JSON.parse(riga.details)).toEqual({
      source: 'generate-ai',
      allVoicesConsented: true,
      enqueued: 3,
      skipped: 1,
    });
  });
});
