// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  registrazione: vi.fn(),
  riscrivi: vi.fn(),
  aggiornaArtefatto: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireRecordingManager: vi.fn(async () => ({ role: 'admin' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (s: string) => s,
  tryDecryptPII: (s: string | null) => s,
}));
vi.mock('@/lib/ai/original-body', () => ({
  conservaOriginali: vi.fn(),
  applicaRedazione: vi.fn(() => 0),
}));
vi.mock('@/lib/storage/postprod', () => ({ rewritePostprodBlob: m.riscrivi }));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findUnique: m.registrazione },
    adminAuditLog: { count: vi.fn(async () => 0) },
    postprodOriginalBody: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        postprodArtifact: { update: m.aggiornaArtefatto },
        postprodOriginalBody: { findMany: vi.fn(async () => []), update: vi.fn() },
        speaker: { update: vi.fn() },
      })
    ),
  },
}));

import { PUT } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const trascrizione = {
  language: 'it',
  segments: [
    { start: 0, end: 2, text: 'Il comune di Bobbio Verde', speaker: 'S0' },
    { start: 2, end: 4, text: 'Buongiorno', speaker: 'S1' },
  ],
};

function registrazione(blobKey: string) {
  const artefatto = (type: string, language: string | null, body: string) => ({
    id: `${type}-id`,
    type,
    language,
    inlineBody: body,
    contentHash: 'h',
    sizeBytes: BigInt(1),
    modelId: 'm',
    modelVersion: '1',
    revisedAt: null,
    recordingId: ID,
    blobKey: blobKey ? `${blobKey}/${type}` : '',
    mimeType: type === 'TRANSCRIPT_VTT' ? 'text/vtt' : 'application/json',
  });
  return {
    id: ID,
    blobKey: 'recordings/x.mp4',
    eventId: 'evt',
    sourceLanguage: 'it',
    durationSec: 4,
    speakers: [
      { id: 'a', diarLabel: 'S0', displayName: 'Chiara', totalSpeechSec: 2 },
      { id: 'b', diarLabel: 'S1', displayName: 'Laura', totalSpeechSec: 2 },
    ],
    // La trascrizione dai sottotitoli live ha solo il JSON, senza file.
    artifacts: blobKey
      ? [
          artefatto('TRANSCRIPT_JSON', null, JSON.stringify(trascrizione)),
          artefatto('TRANSCRIPT_VTT', 'it', 'WEBVTT'),
          artefatto('TRANSCRIPT_TXT', 'it', '[00:00:00] S0: Il comune di Bobbio Verde'),
        ]
      : [artefatto('TRANSCRIPT_JSON', null, JSON.stringify(trascrizione))],
  };
}

const salva = (edits: unknown[], redactOriginal = false) =>
  PUT(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/transcript`, {
      method: 'PUT',
      body: JSON.stringify({ edits, redactOriginal }),
    }) as never,
    { params: Promise.resolve({ id: ID }) } as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.riscrivi.mockResolvedValue(true);
  m.registrazione.mockResolvedValue(registrazione('postprod/run'));
});

describe('PUT transcript: correzioni e cancellazioni', () => {
  it('una correzione ordinaria non scrive nell archivio: ci pensa la presa in carico del lavoro', async () => {
    const res = await salva([{ index: 0, text: 'Il comune di Borgo Verde' }]);
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ textChanges: 1 });
    expect(corpo).not.toHaveProperty('archivioAggiornato');
    expect(m.riscrivi).not.toHaveBeenCalled();
    // Nella banca dati la versione corretta c'e', segnata come rivista.
    const json = m.aggiornaArtefatto.mock.calls.find(
      ([a]) => a.where.id === 'TRANSCRIPT_JSON-id'
    );
    expect(json?.[0].data.revisedAt).toBeInstanceOf(Date);
  });

  it('una cancellazione riscrive nell archivio JSON, sottotitoli e testo semplice', async () => {
    const res = await salva([{ index: 0, text: '' }], true);
    expect(await res.json()).toMatchObject({ archivioAggiornato: true });
    const scritti = m.riscrivi.mock.calls.map(([key, body]) => [
      String(key).split('/').pop(),
      String(body),
    ]);
    expect(scritti.map(([k]) => k).sort()).toEqual([
      'TRANSCRIPT_JSON',
      'TRANSCRIPT_TXT',
      'TRANSCRIPT_VTT',
    ]);
    for (const [, body] of scritti) expect(body).not.toContain('Bobbio');
    // Il testo semplice tiene i nomi di chi parla, come il file del worker.
    expect(scritti.find(([k]) => k === 'TRANSCRIPT_TXT')?.[1]).toBe(
      '[00:00:02] Laura: Buongiorno'
    );
    // Anche il testo semplice nella banca dati.
    expect(
      m.aggiornaArtefatto.mock.calls.some(([a]) => a.where.id === 'TRANSCRIPT_TXT-id')
    ).toBe(true);
  });

  it('ripetere una cancellazione riscrive l archivio anche se nella banca dati non c e piu niente da togliere', async () => {
    m.registrazione.mockResolvedValue({
      ...registrazione('postprod/run'),
      artifacts: registrazione('postprod/run').artifacts.map((a) =>
        a.type === 'TRANSCRIPT_JSON'
          ? {
              ...a,
              inlineBody: JSON.stringify({
                ...trascrizione,
                segments: [
                  { ...trascrizione.segments[0], text: '' },
                  trascrizione.segments[1],
                ],
              }),
            }
          : a
      ),
    });
    const res = await salva([{ index: 0, text: '' }], true);
    expect(await res.json()).toMatchObject({ textChanges: 0, archivioAggiornato: true });
    expect(m.riscrivi).toHaveBeenCalledTimes(3);
  });

  it('se l archivio non risponde la cancellazione lo dice', async () => {
    m.riscrivi.mockResolvedValue(false);
    const res = await salva([{ index: 0, text: '' }], true);
    expect(await res.json()).toMatchObject({ archivioAggiornato: false });
  });

  it('una trascrizione dai sottotitoli, senza file, non tocca l archivio', async () => {
    m.registrazione.mockResolvedValue(registrazione(''));
    const res = await salva([{ index: 1, text: '' }], true);
    expect(await res.json()).toMatchObject({ archivioAggiornato: true });
    expect(m.riscrivi).not.toHaveBeenCalled();
  });
});
