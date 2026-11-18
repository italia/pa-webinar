// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    recordingRedactionRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    gdprAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { encryptPII } from '@/lib/crypto/pii';

const chiavePrima = process.env.PII_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'b'.repeat(64);
});
afterAll(() => {
  if (chiavePrima === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = chiavePrima;
});

import {
  leggiRichiesta,
  respingi,
  richiesteDellaPersona,
  vistaRichiesta,
} from './requests';

const ID = '11111111-1111-4111-8111-111111111111';

function riga(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'OPEN',
    source: 'admin',
    displayName: encryptPII('Anna Bianchi'),
    note: encryptPII('Arrivata per email'),
    emailHash: 'h'.repeat(64),
    registrationId: null,
    seatIds: ['guest-1', 'guest-2'],
    endpointIds: ['ep-1'],
    proposedIntervals: [{ start: 1, end: 2, source: 'presence' }, { start: 'x' }],
    intervals: null,
    jobId: null,
    job: null,
    lastError: null,
    createdAt: new Date('2026-11-10T10:00:00Z'),
    startedAt: null,
    submittedAt: null,
    closedAt: null,
    eventId: 'e',
    recordingId: 'r',
    event: {
      id: 'e',
      title: { it: 'Incontro' },
      startsAt: new Date('2026-11-09T10:00:00Z'),
      youtubeUrl: 'https://www.youtube.com/watch?v=x',
      recordingUrl: 'https://s/b/recordings/altro.mp4',
      recordingPublished: true,
    },
    recording: {
      id: 'r',
      blobKey: 'recordings/sala.mp4',
      durationSec: 600,
      mediaStartedAt: null,
      createdAt: new Date(),
      status: 'READY',
      _count: { tracks: 2 },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('la richiesta come la vede lo staff', () => {
  it('decifra nome e nota, scarta le proposte malformate e dice cosa la rimozione non raggiunge', () => {
    const vista = vistaRichiesta(riga() as never, {
      pipelineEnabled: false,
      storageConfigured: true,
      chiavePubblicata: 'recordings/altro.mp4',
    });
    expect(vista).toMatchObject({
      name: 'Anna Bianchi',
      note: 'Arrivata per email',
      seats: 2,
      proposedIntervals: [{ start: 1, end: 2, source: 'presence' }],
      intervals: [],
      recording: { hasVideo: true, tracks: 2, durationSec: 600 },
      externalCopy: true,
      publishedElsewhere: true,
      pipelineEnabled: false,
    });
    // Nessun identificativo della sala, nessuna impronta.
    expect(JSON.stringify(vista)).not.toContain('guest-1');
    expect(JSON.stringify(vista)).not.toContain('hhhh');
  });

  it('il video pubblicato e’ lo stesso file: niente avviso', () => {
    const vista = vistaRichiesta(riga() as never, {
      pipelineEnabled: true,
      storageConfigured: true,
      chiavePubblicata: 'recordings/sala.mp4',
    });
    expect(vista.publishedElsewhere).toBe(false);
  });

  it('una richiesta in elaborazione con il lavoro fallito torna in lavorazione con l’errore', async () => {
    db.recordingRedactionRequest.findUnique.mockResolvedValue(
      riga({
        status: 'PROCESSING',
        jobId: 'j',
        job: {
          status: 'FAILED',
          lastError: 'ffmpeg exited 1',
          attempts: 5,
          updatedAt: new Date(),
        },
      })
    );
    db.recordingRedactionRequest.updateMany.mockResolvedValue({ count: 1 });
    const r = await leggiRichiesta(ID);
    expect(r).toMatchObject({ status: 'IN_PROGRESS', lastError: 'ffmpeg exited 1' });
    expect(db.recordingRedactionRequest.updateMany).toHaveBeenCalledWith({
      where: { id: ID, status: 'PROCESSING', jobId: 'j' },
      data: { status: 'IN_PROGRESS', lastError: 'ffmpeg exited 1' },
    });
  });

  it('una richiesta che non c’e’ e’ un 404', async () => {
    db.recordingRedactionRequest.findUnique.mockResolvedValue(null);
    await expect(leggiRichiesta(ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('le altre azioni', () => {
  it('non si respinge una richiesta in elaborazione o gia’ chiusa', async () => {
    db.recordingRedactionRequest.findUnique.mockResolvedValue({
      status: 'PROCESSING',
      eventId: 'e',
      recordingId: 'r',
      source: 'admin',
    });
    await expect(respingi(ID, 'motivo')).rejects.toMatchObject({ statusCode: 409 });
    db.recordingRedactionRequest.findUnique.mockResolvedValue({
      status: 'CLOSED',
      eventId: 'e',
      recordingId: 'r',
      source: 'admin',
    });
    await expect(respingi(ID, 'motivo')).rejects.toMatchObject({ statusCode: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('per la persona, solo stato e date', async () => {
    db.recordingRedactionRequest.findMany.mockResolvedValue([
      {
        registrationId: 'reg',
        status: 'OPEN',
        createdAt: new Date('2026-11-10T10:00:00Z'),
        closedAt: null,
      },
    ]);
    expect(await richiesteDellaPersona('h')).toEqual([
      {
        registrationId: 'reg',
        status: 'OPEN',
        createdAt: '2026-11-10T10:00:00.000Z',
        closedAt: null,
      },
    ]);
  });
});
