import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  event: { findUnique: vi.fn(), update: vi.fn() },
  siteSetting: { findUnique: vi.fn() },
  postprodJob: { findFirst: vi.fn(), create: vi.fn() },
  recording: { findFirst: vi.fn(), create: vi.fn() },
  postprodArtifact: { findUnique: vi.fn() },
  callSession: { create: vi.fn() },
  $executeRaw: vi.fn(),
  pubblica: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: m.event,
    siteSetting: m.siteSetting,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        postprodJob: m.postprodJob,
        recording: m.recording,
        postprodArtifact: m.postprodArtifact,
        callSession: m.callSession,
        $executeRaw: m.$executeRaw,
      })
    ),
  },
}));
vi.mock('@/lib/captions/transcript', () => ({
  registrazionePubblica: m.pubblica,
  conservazioneFinita: (e: { endsAt: Date; dataRetentionDays: number }, d: Date) =>
    e.endsAt.getTime() + e.dataRetentionDays * 86_400_000 < d.getTime(),
}));

vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string | null) => v }));

import { accodaResoconto, salvaResoconto } from './enqueue';

const evento = {
  id: 'ev-1',
  status: 'ENDED',
  endsAt: new Date(),
  dataRetentionDays: 30,
  aiTargetLocales: 'en,fr,it',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.event.findUnique.mockResolvedValue(evento);
  m.siteSetting.findUnique.mockResolvedValue({ aiPipelineEnabled: true });
  m.postprodJob.findFirst.mockResolvedValue(null);
  m.postprodJob.create.mockResolvedValue({ id: 'job-1' });
  m.recording.findFirst.mockResolvedValue({ sourceLanguage: 'it' });
  m.pubblica.mockResolvedValue('rec-1');
});

describe('accodaResoconto', () => {
  it("accoda un lavoro REPORT dell'evento, con le lingue dell'evento tranne la sua", async () => {
    expect(await accodaResoconto('ev-1')).toEqual({ stato: 'accodato', jobId: 'job-1' });
    // La lingua viene dalla registrazione mostrata nella pagina.
    expect(m.recording.findFirst.mock.calls[0]![0].where).toEqual({ id: 'rec-1' });
    expect(m.postprodJob.create.mock.calls[0]![0].data.recordingId).toBeUndefined();
    // I lavori chiusi lasciano la loro copia dei numeri.
    const sql = m.$executeRaw.mock.calls.map((c) => (c[0] as string[]).join('?')).join('\n');
    expect(sql).toContain("payload = payload - 'metrics'");
    expect(m.postprodJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: 'ev-1',
          kind: 'REPORT',
          status: 'PENDING',
          payload: {
            eventId: 'ev-1',
            sourceLanguage: 'it',
            targetLanguages: ['en', 'fr'],
          },
        }),
      })
    );
  });

  it("le lingue chieste dallo staff prendono il posto di quelle dell'evento", async () => {
    await accodaResoconto('ev-1', { targetLanguages: ['de', 'de', 'it'] });
    expect(m.postprodJob.create.mock.calls[0]![0].data.payload.targetLanguages).toEqual([
      'de',
    ]);
  });

  it('senza registrazioni il lavoro si accoda lo stesso, in italiano, senza creare niente', async () => {
    m.pubblica.mockResolvedValue(null);
    m.recording.findFirst.mockResolvedValue(null);
    expect(await accodaResoconto('ev-1')).toEqual({ stato: 'accodato', jobId: 'job-1' });
    expect(m.recording.create).not.toHaveBeenCalled();
    expect(m.callSession.create).not.toHaveBeenCalled();
    expect(m.postprodJob.create.mock.calls[0]![0].data).toMatchObject({
      eventId: 'ev-1',
      payload: { sourceLanguage: 'it' },
    });
  });

  it('senza lingua sulla registrazione vale quella rilevata nella trascrizione', async () => {
    m.recording.findFirst.mockResolvedValue({ sourceLanguage: null, artifacts: [{ id: 'art-1' }] });
    m.postprodArtifact.findUnique.mockResolvedValue({
      inlineBody: JSON.stringify({ language: 'en', segments: [] }),
    });
    await accodaResoconto('ev-1');
    expect(m.postprodJob.create.mock.calls[0]![0].data.payload).toMatchObject({
      sourceLanguage: 'en',
      targetLanguages: ['fr', 'it'],
    });
  });

  it('uno alla volta per evento', async () => {
    m.postprodJob.findFirst.mockResolvedValue({ id: 'job-0' });
    expect(await accodaResoconto('ev-1')).toEqual({ stato: 'in-corso', jobId: 'job-0' });
    expect(m.postprodJob.findFirst.mock.calls[0]![0].where).toMatchObject({ kind: 'REPORT', eventId: 'ev-1' });
    expect(m.postprodJob.create).not.toHaveBeenCalled();
  });

  it('rifiuta un evento non concluso, oltre la conservazione o con la pipeline spenta', async () => {
    m.event.findUnique.mockResolvedValueOnce({ ...evento, status: 'LIVE' });
    expect((await accodaResoconto('ev-1')).stato).toBe('non-concluso');
    m.event.findUnique.mockResolvedValueOnce({
      ...evento,
      endsAt: new Date(Date.now() - 40 * 86_400_000),
    });
    expect((await accodaResoconto('ev-1')).stato).toBe('scaduto');
    m.siteSetting.findUnique.mockResolvedValueOnce({ aiPipelineEnabled: false });
    expect((await accodaResoconto('ev-1')).stato).toBe('ai-spenta');
    m.event.findUnique.mockResolvedValueOnce(null);
    expect((await accodaResoconto('ev-1')).stato).toBe('evento-assente');
    expect(m.postprodJob.create).not.toHaveBeenCalled();
  });
});

describe('salvaResoconto', () => {
  it('congela il testo valido per lingua, non pubblicato', async () => {
    const r = await salvaResoconto({
      eventId: 'ev-1',
      sourceLanguage: 'it',
      metrics: null,
      narratives: { it: { abstract: 'Sintesi' }, en: {}, 'x<y': { abstract: 'no' } },
      modelId: 'm',
      modelVersion: null,
    });
    expect(Object.keys(r!.narratives)).toEqual(['it']);
    expect(m.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ev-1' },
        data: expect.objectContaining({ postEventReportPublished: false }),
      })
    );
  });

  it("senza testo nella lingua dell'evento non salva niente", async () => {
    const r = await salvaResoconto({
      eventId: 'ev-1',
      sourceLanguage: 'it',
      metrics: null,
      narratives: { en: { abstract: 'Only English' } },
      modelId: null,
      modelVersion: null,
    });
    expect(r).toBeNull();
    expect(m.event.update).not.toHaveBeenCalled();
  });
});
