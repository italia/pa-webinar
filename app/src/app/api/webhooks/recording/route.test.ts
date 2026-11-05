// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * La notifica di fine registrazione: chi la manda deve provare di conoscere i
 * segreti, i partecipanti si cifrano prima di arrivare al database, e il lavoro
 * AI parte solo per gli eventi che lo chiedono.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, enqueuePostprodForRecording } = vi.hoisted(() => {
  const tx = {
    event: { update: vi.fn() },
    recording: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    callSession: { create: vi.fn(), update: vi.fn() },
  };
  return {
    tx,
    prisma: {
      event: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
    enqueuePostprodForRecording: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/ai/enqueue', () => ({ enqueuePostprodForRecording }));

import { tryDecryptJSON } from '@/lib/crypto/pii';
import { signWebhookBody } from '@/lib/auth/webhook-signature';

import { POST } from './route';

const CHIAVE = 'chiave-cron-di-prova';
const SEGRETO = 'segreto-webhook-di-prova';
const CORPO = {
  roomName: 'stanza-1',
  recordingUrl: 'https://s3.example.it/bucket/recordings/mix.mp4',
  filename: 'mix.mp4',
  duration: 120,
  fileSize: 2048,
  participants: [{ name: 'Anna Bianchi' }],
};

function manda(corpo: unknown, headers: Record<string, string> = {}) {
  const testo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const request = new Request('http://localhost:3000/api/webhooks/recording', {
    method: 'POST',
    headers: { authorization: `Bearer ${CHIAVE}`, ...headers },
    body: testo,
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.CRON_API_KEY = CHIAVE;
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.RECORDING_WEBHOOK_SECRET;
  prisma.event.findUnique.mockResolvedValue({
    id: 'ev-1',
    slug: 'evento',
    startsAt: new Date('2026-11-04T10:00:00Z'),
    peakParticipants: 7,
    aiTranscriptEnabled: false,
  });
  tx.event.update.mockResolvedValue({ id: 'ev-1' });
  tx.recording.findFirst.mockResolvedValue(null);
  tx.callSession.create.mockResolvedValue({ id: 'sess-1' });
  tx.recording.create.mockResolvedValue({ id: 'rec-1' });
  tx.recording.update.mockResolvedValue({ id: 'rec-segnaposto' });
  enqueuePostprodForRecording.mockResolvedValue({
    enqueued: 3,
    skippedExisting: 0,
    jobIds: ['j1'],
  });
});

describe('chi puo’ notificare', () => {
  it('senza la chiave giusta non si scrive niente', async () => {
    expect((await manda(CORPO, { authorization: 'Bearer sbagliata' })).status).toBe(401);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('senza CRON_API_KEY configurata non passa nessuno', async () => {
    delete process.env.CRON_API_KEY;
    expect((await manda(CORPO, { authorization: 'Bearer ' })).status).toBe(401);
  });

  it('senza segreto configurato basta la chiave', async () => {
    expect((await manda(CORPO)).status).toBe(200);
  });

  it('con il segreto servono entrambi, sulla firma del corpo esatto', async () => {
    process.env.RECORDING_WEBHOOK_SECRET = SEGRETO;
    const firma = signWebhookBody(JSON.stringify(CORPO), SEGRETO);
    expect((await manda(CORPO)).status).toBe(401);
    expect(
      (await manda(CORPO, { 'x-webhook-signature': 'sha256=' + '0'.repeat(64) })).status
    ).toBe(401);
    expect(
      (await manda({ ...CORPO, duration: 1 }, { 'x-webhook-signature': firma })).status
    ).toBe(401);
    expect(
      (
        await manda(CORPO, {
          'x-webhook-signature': firma,
          authorization: 'Bearer sbagliata',
        })
      ).status
    ).toBe(401);
    expect((await manda(CORPO, { 'x-webhook-signature': firma })).status).toBe(200);
  });
});

describe('il contenuto', () => {
  it('un corpo che non e’ JSON e’ 400, senza campi obbligatori 422', async () => {
    expect((await manda('non json')).status).toBe(400);
    expect((await manda({ roomName: 'stanza-1' })).status).toBe(422);
    expect((await manda({ recordingUrl: 'x' })).status).toBe(422);
  });

  it('una stanza sconosciuta e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await manda(CORPO)).status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('i partecipanti arrivano al database cifrati', async () => {
    await manda(CORPO);
    const { participants } = tx.callSession.create.mock.calls[0]![0].data as {
      participants: unknown;
    };
    expect(JSON.stringify(participants)).not.toContain('Anna');
    expect(tryDecryptJSON(participants)).toEqual(CORPO.participants);
  });

  it('non si salvano piu’ di 500 partecipanti', async () => {
    const tanti = Array.from({ length: 800 }, (_, i) => ({ name: `p${i}` }));
    await manda({ ...CORPO, participants: tanti });
    const { participants } = tx.callSession.create.mock.calls[0]![0].data as {
      participants: unknown;
    };
    expect(tryDecryptJSON<unknown[]>(participants)).toHaveLength(500);
  });

  it('la chiave del file viene dal nome, o dall’indirizzo senza il bucket', async () => {
    await manda(CORPO);
    expect(tx.recording.create.mock.calls[0]![0].data.blobKey).toBe('recordings/mix.mp4');
    vi.clearAllMocks();
    tx.callSession.create.mockResolvedValue({ id: 's' });
    tx.recording.create.mockResolvedValue({ id: 'r' });
    tx.recording.findFirst.mockResolvedValue(null);
    tx.event.update.mockResolvedValue({ id: 'ev-1' });
    await manda({ ...CORPO, filename: '' });
    expect(tx.recording.create.mock.calls[0]![0].data.blobKey).toBe('recordings/mix.mp4');
  });

  it('la risposta dice cosa e’ stato creato', async () => {
    const r = await manda(CORPO);
    await expect(r.json()).resolves.toMatchObject({
      success: true,
      eventId: 'ev-1',
      slug: 'evento',
      sessionId: 'sess-1',
      recordingId: 'rec-1',
      postprodEnqueued: 0,
    });
  });
});

describe('il seguito della registrazione', () => {
  it('senza trascrizione AI non parte nessun lavoro', async () => {
    await manda(CORPO);
    expect(enqueuePostprodForRecording).not.toHaveBeenCalled();
  });

  it('con la trascrizione AI parte, ma non scavalca il consenso voce per voce', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'ev-1',
      slug: 'evento',
      startsAt: new Date(),
      peakParticipants: 1,
      aiTranscriptEnabled: true,
    });
    const r = await manda(CORPO);
    expect(enqueuePostprodForRecording).toHaveBeenCalledWith(tx, {
      recordingId: 'rec-1',
      seServeConferma: 'salta',
    });
    await expect(r.json()).resolves.toMatchObject({
      postprodEnqueued: 3,
      postprodAwaitsVoiceConsent: false,
    });
  });

  it('se il consenso va confermato lo dice, nel log e nella risposta', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'ev-1',
      slug: 'evento',
      startsAt: new Date(),
      peakParticipants: 1,
      aiTranscriptEnabled: true,
    });
    enqueuePostprodForRecording.mockResolvedValue({
      enqueued: 0,
      skippedExisting: 0,
      jobIds: [],
      voiceConsentRequired: true,
    });
    const r = await manda(CORPO);
    await expect(r.json()).resolves.toMatchObject({ postprodAwaitsVoiceConsent: true });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('per-voice consent')
    );
  });

  it('con una registrazione per tracce si arricchisce quella, senza crearne un’altra', async () => {
    tx.recording.findFirst.mockResolvedValue({
      id: 'rec-segnaposto',
      callSessionId: 'sess-9',
    });
    const r = await manda(CORPO);
    expect(tx.callSession.create).not.toHaveBeenCalled();
    expect(tx.recording.create).not.toHaveBeenCalled();
    expect(enqueuePostprodForRecording).not.toHaveBeenCalled();
    const { participants } = tx.callSession.update.mock.calls[0]![0].data as {
      participants: unknown;
    };
    expect(JSON.stringify(participants)).not.toContain('Anna');
    await expect(r.json()).resolves.toMatchObject({
      sessionId: 'sess-9',
      recordingId: 'rec-segnaposto',
    });
  });
});
