// @vitest-environment node
/**
 * POST /api/internal/postprod-artifact — quando la trascrizione AI prende il
 * posto di quella dai sottotitoli live, i parlanti di quella (con i nomi di
 * chi aveva acconsentito) se ne vanno prima di scrivere quelli della
 * diarization, che usa le stesse etichette.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  postprodArtifact: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
  },
  postprodOriginalBody: { deleteMany: vi.fn() },
  speaker: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn(async () => []) },
  postprodJob: { update: vi.fn(), count: vi.fn(async () => 1) },
  recording: { update: vi.fn(), deleteMany: vi.fn() },
  $executeRaw: vi.fn(async () => 0),
}));

vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({ encryptPII: (s: string) => `cif:${s}` }));
vi.mock('@/lib/db', () => ({
  prisma: {
    postprodJob: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

import { artifactPath } from '@/lib/ai';
import { prisma } from '@/lib/db';

import { POST } from './route';

const JOB = '11111111-2222-4333-8444-555555555555';
const REC = { id: 'rec-1', eventId: 'ev-1', runCount: 1, sourceLanguage: 'it' };

function invia() {
  const body = {
    jobId: JOB,
    type: 'TRANSCRIPT_JSON',
    language: null,
    blobKey: artifactPath({ eventId: REC.eventId, recordingId: REC.id, runCount: REC.runCount }, 'TRANSCRIPT_JSON', null),
    sizeBytes: 10,
    mimeType: 'application/json',
    contentHash: 'a'.repeat(64),
    inlineBody: '{"segments":[]}',
    modelId: 'whisperx',
    speakerMap: [{ diarLabel: 'SPEAKER_00', totalSpeechSec: 12 }],
  };
  return POST(
    new Request('http://x/api/internal/postprod-artifact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({}) } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.postprodJob.findUnique).mockResolvedValue({
    id: JOB,
    kind: 'TRANSCRIBE',
    payload: { runId: '99999999-8888-4777-8666-555555555555', sourceLanguage: 'it' },
    startedAt: new Date(),
    recording: REC,
  } as never);
});

describe('POST /api/internal/postprod-artifact — trascrizione AI dopo quella dai sottotitoli', () => {
  it('toglie i parlanti dei sottotitoli prima di scrivere quelli della diarization', async () => {
    tx.postprodArtifact.findFirst.mockResolvedValue({ id: 'art-1', modelId: 'live-captions' });
    const res = await invia();
    expect(res.status).toBeLessThan(300);
    expect(tx.speaker.deleteMany).toHaveBeenCalledWith({ where: { recordingId: 'rec-1' } });
    // In fila con la costruzione dai sottotitoli dello stesso evento.
    expect(tx.$executeRaw).toHaveBeenCalled();
    // Le registrazioni senza file con una trascrizione dai sottotitoli non
    // corretta se ne vanno: la oscurerebbero.
    expect(tx.recording.deleteMany).toHaveBeenCalledWith({
      where: {
        eventId: 'ev-1',
        blobKey: '',
        id: { not: 'rec-1' },
        artifacts: { none: { type: 'TRANSCRIPT_JSON', revisedAt: { not: null } } },
      },
    });
    const ordine = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(ordine(tx.speaker.deleteMany)).toBeLessThan(ordine(tx.speaker.upsert));
  });

  it('una nuova corsa della pipeline non tocca i nomi messi dallo staff', async () => {
    tx.postprodArtifact.findFirst.mockResolvedValue({ id: 'art-1', modelId: 'whisperx' });
    await invia();
    expect(tx.speaker.deleteMany).not.toHaveBeenCalled();
    expect(tx.speaker.upsert).toHaveBeenCalled();
  });
});
