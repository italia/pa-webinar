/**
 * Il manifest del registratore: con l'ora del primo fotogramma, la
 * registrazione sa dove cade lo zero dei tempi della trascrizione.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    recording: { update: vi.fn() },
    recordingTrack: { upsert: vi.fn() },
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
    event: { aiTranscriptEnabled: true },
  });
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
});
