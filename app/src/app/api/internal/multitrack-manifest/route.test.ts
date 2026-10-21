/**
 * Il manifest del registratore: con l'ora del primo fotogramma, la
 * registrazione sa dove cade lo zero dei tempi della trascrizione.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    recording: { update: vi.fn(), findUnique: vi.fn() },
    recordingTrack: { upsert: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({ encryptPIIOrNull: (v: string | null) => v }));
vi.mock('@/lib/ai/enqueue', () => ({
  enqueuePostprodForRecording: vi.fn(async () => ({ enqueued: 1, skippedExisting: 0, jobIds: ['j1'] })),
}));

import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { prisma } from '@/lib/db';

import { POST } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const REC_ID = '66666666-6666-4666-8666-666666666666';
const track = {
  participantId: 'p1',
  displayName: 'Relatore 1',
  blobKey: `recordings/multitrack/${EVENT_ID}/${REC_ID}/p1.ogg`,
  sizeBytes: 5_000_000,
  startOffsetMs: 0,
  durationMs: 600_000,
};
const ctx = () => ({ params: Promise.resolve({}) });
const post = (body: unknown) =>
  new Request('https://webinar.gov.it/api/internal/multitrack-manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.recording.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: REC_ID,
    eventId: EVENT_ID,
    event: { aiTranscriptEnabled: true, status: 'ENDED' },
  });
  tx.recording.findUnique.mockResolvedValue({ mediaStartedAt: null });
  tx.recordingTrack.count.mockResolvedValue(0);
  tx.recordingTrack.findMany.mockResolvedValue([{ sizeBytes: BigInt(track.sizeBytes), durationMs: track.durationMs }]);
});

describe('POST /api/internal/multitrack-manifest', () => {
  it('salva l’ora del primo fotogramma come inizio del media', async () => {
    const t0 = Date.parse('2026-10-08T10:00:03.250Z');
    const res = await POST(
      post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], recordingStartedAtMs: t0 }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(tx.recording.update).toHaveBeenCalledWith({
      where: { id: REC_ID },
      data: { mediaStartedAt: new Date(t0) },
    });
    expect(tx.recordingTrack.upsert).toHaveBeenCalledTimes(1);
  });

  it('un valore senza senso si ignora, il manifest no', async () => {
    const res = await POST(
      post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], recordingStartedAtMs: 0 }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(tx.recording.update).not.toHaveBeenCalled();
    expect(tx.recordingTrack.upsert).toHaveBeenCalledTimes(1);
  });

  it('un registratore che non la manda: niente da salvare, il resto come prima', async () => {
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track] }), ctx());
    expect(res.status).toBe(200);
    expect(tx.recording.update).not.toHaveBeenCalled();
    expect(tx.recordingTrack.upsert).toHaveBeenCalledTimes(1);
  });

  it('una seconda esecuzione del recorder tiene lo zero della prima e sposta le sue tracce', async () => {
    const primo = Date.parse('2026-10-08T10:00:00.000Z');
    const secondo = primo + 25 * 60_000;
    tx.recording.findUnique.mockResolvedValue({ mediaStartedAt: new Date(primo) });
    tx.recordingTrack.count.mockResolvedValue(4);
    const res = await POST(
      post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [{ ...track, startOffsetMs: 1_000 }], recordingStartedAtMs: secondo }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(tx.recording.update).toHaveBeenCalledWith({
      where: { id: REC_ID },
      data: { mediaStartedAt: new Date(primo) },
    });
    expect(tx.recordingTrack.updateMany).not.toHaveBeenCalled();
    const upsert = tx.recordingTrack.upsert.mock.calls[0]?.[0] as { create: { startOffsetMs: number } };
    expect(upsert.create.startOffsetMs).toBe(25 * 60_000 + 1_000);
  });

  it('un manifest con uno zero piu vecchio sposta in avanti le tracce gia salvate', async () => {
    const salvato = Date.parse('2026-10-08T10:10:00.000Z');
    const arrivo = salvato - 60_000;
    tx.recording.findUnique.mockResolvedValue({ mediaStartedAt: new Date(salvato) });
    tx.recordingTrack.count.mockResolvedValue(2);
    await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], recordingStartedAtMs: arrivo }), ctx());
    expect(tx.recordingTrack.updateMany).toHaveBeenCalledWith({
      where: { recordingId: REC_ID },
      data: { startOffsetMs: { increment: 60_000 } },
    });
    expect(tx.recording.update).toHaveBeenCalledWith({
      where: { id: REC_ID },
      data: { mediaStartedAt: new Date(arrivo) },
    });
  });

  it('una cattura fermata a diretta in corso salva le tracce senza avviare la trascrizione', async () => {
    (prisma.recording.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: REC_ID,
      eventId: EVENT_ID,
      event: { aiTranscriptEnabled: true, status: 'LIVE' },
    });
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], interrupted: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enqueued: 0, partial: true });
    expect(tx.recordingTrack.upsert).toHaveBeenCalledTimes(1);
    expect(enqueuePostprodForRecording).not.toHaveBeenCalled();
  });

  it('fermata a evento gia finito: la trascrizione parte comunque', async () => {
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], interrupted: true }), ctx());
    expect(await res.json()).toMatchObject({ enqueued: 1, partial: false });
    expect(enqueuePostprodForRecording).toHaveBeenCalledTimes(1);
  });

  it('anche in pausa (IDLE) l\'evento e\' aperto: una cattura fermata non avvia la trascrizione', async () => {
    (prisma.recording.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: REC_ID,
      eventId: EVENT_ID,
      event: { aiTranscriptEnabled: true, status: 'IDLE' },
    });
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [track], interrupted: true }), ctx());
    expect(await res.json()).toMatchObject({ enqueued: 0, partial: true });
    expect(enqueuePostprodForRecording).not.toHaveBeenCalled();
  });

  it('il silenzio si giudica su tutte le tracce: una seconda esecuzione muta non butta la prima', async () => {
    const muta = { ...track, blobKey: `recordings/multitrack/${EVENT_ID}/${REC_ID}/b-p1-0.ogg`, sizeBytes: 100, durationMs: 60_000 };
    tx.recordingTrack.findMany.mockResolvedValue([
      { sizeBytes: BigInt(5_000_000), durationMs: 600_000 },
      { sizeBytes: BigInt(100), durationMs: 60_000 },
    ]);
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [muta] }), ctx());
    expect(await res.json()).toMatchObject({ silent: false, enqueued: 1 });
    expect(tx.recording.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'POSTPROD_FAILED' } }));
  });

  it('tutte le tracce della registrazione mute: registrazione segnata fallita, niente pipeline', async () => {
    tx.recordingTrack.findMany.mockResolvedValue([{ sizeBytes: BigInt(100), durationMs: 60_000 }]);
    const res = await POST(post({ eventId: EVENT_ID, recordingId: REC_ID, tracks: [{ ...track, sizeBytes: 100, durationMs: 60_000 }] }), ctx());
    expect(await res.json()).toMatchObject({ silent: true, enqueued: 0 });
    expect(tx.recording.update).toHaveBeenCalledWith({ where: { id: REC_ID }, data: { status: 'POSTPROD_FAILED' } });
    expect(enqueuePostprodForRecording).not.toHaveBeenCalled();
  });
});
