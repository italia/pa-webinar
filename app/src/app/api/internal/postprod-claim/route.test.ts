// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
    postprodJob: { update: vi.fn() },
    siteSetting: { findUnique: vi.fn(async () => ({ aiLlmProvider: 'vllm' })) },
    recording: { findUnique: vi.fn() },
    speaker: { findMany: vi.fn(async () => []) },
    postprodArtifact: { findFirst: vi.fn(async () => null) },
    recordingTrack: { findMany: vi.fn(async () => []) },
  },
}));
const ritirati = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock('@/lib/captions/room', () => ({ endpointRitirati: ritirati }));
const ingressi = vi.hoisted(() => ({
  trascrizione: vi.fn(async () => ({ downloadUrl: 'https://archivio/trascrizione', blobKey: 'postprod/e/r/001/transcript.raw.json' })),
  sottotitoli: vi.fn(async () => null),
}));
vi.mock('@/lib/ai/transcript-input', () => ({
  trascrizionePerIlWorker: ingressi.trascrizione,
  sottotitoliPerIlWorker: ingressi.sottotitoli,
}));
vi.mock('@/lib/storage/postprod', () => ({
  presignArtifactUpload: vi.fn(async ({ blobKey }: { blobKey: string }) => ({ uploadUrl: `https://su/${blobKey}` })),
  presignArtifactDownload: vi.fn(async ({ blobKey }: { blobKey: string }) => `https://giu/${blobKey}`),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
const r = vi.hoisted(() => ({
  valutazioni: vi.fn(async () => ({ items: [], responses: [], legacy: { count: 0 } })),
  metriche: vi.fn(async () => ({ version: 1, durationSec: 3600 })),
  ingresso: vi.fn(async () => ({ title: 'Evento', transcript: { lines: [] } })),
}));
vi.mock('@/lib/feedback/event-feedback-report', () => ({ buildEventFeedbackReport: r.valutazioni }));
vi.mock('@/lib/report/metrics', () => ({ metricheResoconto: r.metriche }));
vi.mock('@/lib/report/input', () => ({ ingressoResoconto: r.ingresso }));
const scrivi = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/report/job', () => ({ scriviNumeriResoconto: scrivi }));
vi.mock('@/lib/ai/glossary', () => ({ glossaryForEvent: vi.fn(async () => []), glossaryHints: () => [] }));

import { prisma } from '@/lib/db';

import { POST } from './route';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const claim = (body: unknown) =>
  POST(
    new Request('http://localhost/api/internal/postprod-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({}) } as never,
  );

/** Il testo SQL di una query con template di Prisma (frammenti compresi). */
function sqlOf(call: unknown[]): string {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    const v = values[i];
    if (v && typeof v === 'object' && 'strings' in (v as object)) out += (v as { strings: string[] }).strings.join('?');
    else if (i < values.length) out += '?';
  });
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Niente da prendere: la rotta risponde 204 senza leggere altro.
  fn(prisma.$queryRaw).mockResolvedValue([]);
});

describe('POST /api/internal/postprod-claim', () => {
  it('con `kinds` prende solo quei tipi di job', async () => {
    const res = await claim({ workerId: 'w-cpu', kinds: ['SUMMARIZE', 'TRANSLATE'] });
    expect(res.status).toBe(204);
    const call = fn(prisma.$queryRaw).mock.calls[0]!;
    expect(sqlOf(call)).toContain('j.kind::text = ANY(');
    // I tipi viaggiano come parametro del frammento, mai nel testo SQL.
    expect(JSON.stringify(call)).toContain('["SUMMARIZE","TRANSLATE"]');
  });

  it('senza `kinds` prende ogni tipo, come prima', async () => {
    await claim({ workerId: 'w-gpu' });
    expect(sqlOf(fn(prisma.$queryRaw).mock.calls[0]!)).not.toContain('ANY(');
  });

  it('un tipo sconosciuto e’ rifiutato', async () => {
    const res = await claim({ workerId: 'w', kinds: ['NONSENSE'] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("il resoconto dell'evento: nessuna registrazione, gli ingressi e i numeri salvati nel lavoro", async () => {
    const eventId = '11111111-2222-4333-8444-555555555555';
    fn(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: '66666666-7777-4888-8999-000000000000',
        recording_id: null,
        kind: 'REPORT',
        payload: { eventId, sourceLanguage: 'it', targetLanguages: ['en'] },
        attempts: 1,
        next_attempt_at: new Date(),
        depends_on_id: null,
      },
    ]);
    const res = await claim({ workerId: 'w-cpu', kinds: ['REPORT'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      recordingId: null,
      kind: 'REPORT',
      payload: { eventId, sourceLanguage: 'it', targetLanguages: ['en'] },
      reportInput: { title: 'Evento' },
      inputs: [],
    });
    // Le valutazioni si leggono una volta e servono a numeri e testo.
    expect(r.valutazioni).toHaveBeenCalledOnce();
    expect(scrivi).toHaveBeenCalledWith('66666666-7777-4888-8999-000000000000', 1, { version: 1, durationSec: 3600 });
  });

  it('un lavoro preso nel frattempo da un claim successivo (o cancellato) non si rifa\'', async () => {
    fn(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: '66666666-7777-4888-8999-000000000000',
        recording_id: null,
        kind: 'REPORT',
        payload: { eventId: '11111111-2222-4333-8444-555555555555', sourceLanguage: 'it', targetLanguages: [] },
        attempts: 2,
        next_attempt_at: new Date(),
        depends_on_id: null,
      },
    ]);
    scrivi.mockResolvedValueOnce(false);
    expect((await claim({ workerId: 'w-cpu', kinds: ['REPORT'] })).status).toBe(204);
  });

  it('la sintesi riceve la trascrizione dal modulo che la allinea all archivio', async () => {
    const recordingId = '22222222-3333-4444-8555-666666666666';
    fn(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: '66666666-7777-4888-8999-000000000001',
        recording_id: recordingId,
        kind: 'SUMMARIZE',
        payload: { runId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb', sourceLanguage: 'it' },
        attempts: 1,
        next_attempt_at: new Date(),
        depends_on_id: null,
      },
    ]);
    const registrazione = {
      id: recordingId,
      eventId: '11111111-2222-4333-8444-555555555555',
      runCount: 1,
      sourceLanguage: 'it',
      blobKey: 'recordings/x.mp4',
      event: { id: '11111111-2222-4333-8444-555555555555', slug: 'e', aiTargetLocales: [], title: { it: 'E' }, organizerName: null, speakersInfo: null, expectedSpeakers: null, agendaItems: [] },
      callSession: null,
      _count: { tracks: 0 },
    };
    fn(prisma.recording.findUnique).mockResolvedValueOnce(registrazione);
    const res = await claim({ workerId: 'w-cpu', kinds: ['SUMMARIZE'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inputs: Array<{ role: string; downloadUrl: string }> };
    expect(ingressi.trascrizione).toHaveBeenCalledWith(expect.objectContaining({ id: recordingId, runCount: 1 }), expect.any(Number));
    expect(body.inputs).toContainEqual(expect.objectContaining({ role: 'transcript', downloadUrl: 'https://archivio/trascrizione' }));
  });

  it('le tracce di chi ha ritirato il consenso alla trascrizione non passano al worker', async () => {
    const recordingId = '22222222-3333-4444-8555-666666666667';
    const eventId = '11111111-2222-4333-8444-555555555555';
    fn(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: '66666666-7777-4888-8999-000000000002',
        recording_id: recordingId,
        kind: 'TRANSCRIBE_MULTITRACK',
        payload: { runId: '77777777-8888-4999-8aaa-bbbbbbbbbbbc', sourceLanguage: 'it' },
        attempts: 1,
        next_attempt_at: new Date(),
        depends_on_id: null,
      },
    ]);
    fn(prisma.recording.findUnique).mockResolvedValueOnce({
      id: recordingId,
      eventId,
      runCount: 1,
      sourceLanguage: 'it',
      blobKey: 'recordings/y.mp4',
      event: { id: eventId, slug: 'e', aiTargetLocales: [], title: { it: 'E' }, organizerName: null, speakersInfo: null, expectedSpeakers: null, agendaItems: [] },
      callSession: null,
      _count: { tracks: 2 },
    });
    fn(prisma.recordingTrack.findMany).mockResolvedValueOnce([
      { participantId: 'ep-resta', displayName: null, blobKey: 'tracce/ep-resta-1.ogg', startOffsetMs: 0 },
      { participantId: 'ep-ritirato', displayName: null, blobKey: 'tracce/ep-ritirato-1.ogg', startOffsetMs: 10 },
    ]);
    ritirati.mockResolvedValueOnce(new Set(['ep-ritirato']));
    const res = await claim({ workerId: 'w-gpu', kinds: ['TRANSCRIBE_MULTITRACK'] });
    expect(res.status).toBe(200);
    expect(ritirati).toHaveBeenCalledWith(eventId, ['ep-resta', 'ep-ritirato']);
    const body = (await res.json()) as { inputs: Array<{ role: string; participantId?: string }> };
    const tracce = body.inputs.filter((i) => i.role === 'track').map((i) => i.participantId);
    expect(tracce).toEqual(['ep-resta']);
  });

  describe('traduzione di titolo e descrizione (TRANSLATE_TEXT)', () => {
    const eventId = '11111111-2222-4333-8444-555555555555';
    const riga = {
      id: '66666666-7777-4888-8999-000000000000',
      recording_id: null,
      kind: 'TRANSLATE_TEXT',
      payload: {
        eventId,
        sourceLanguage: 'it',
        targetLanguages: ['de', 'en'],
        title: 'Ciclo | Titolo',
        description: '# Testo',
        sourceHash: 'a'.repeat(64),
      },
      attempts: 1,
      next_attempt_at: new Date(),
      depends_on_id: null,
    };
    const ambiente = { ...process.env };
    afterEach(() => {
      process.env = { ...ambiente };
    });

    it('il testo, il motore su CPU e nessun indirizzo di vLLM', async () => {
      process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
      process.env.AI_MT_MODEL_ID = 'modello-mt';
      fn(prisma.$queryRaw).mockResolvedValueOnce([riga]);
      const res = await claim({ workerId: 'w-cpu', kinds: ['TRANSLATE_TEXT'] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { providerHints: Record<string, unknown> } & Record<string, unknown>;
      expect(body).toMatchObject({
        recordingId: null,
        kind: 'TRANSLATE_TEXT',
        textInput: { sourceLanguage: 'it', targetLanguages: ['de', 'en'], title: 'Ciclo | Titolo', description: '# Testo' },
        uploadTargets: {},
        inputs: [],
      });
      // Il testo viaggia una volta sola, in textInput.
      expect(body.payload).not.toHaveProperty('title');
      expect(body.providerHints).toMatchObject({ mtBaseUrl: 'http://videocall-pa-webinar-mt:8080/v1', mtModelId: 'modello-mt' });
      expect(body.providerHints).not.toHaveProperty('llmBaseUrl');
    });

    it('senza motore il lavoro si chiude come fallito invece di tornare in coda', async () => {
      delete process.env.AI_MT_BASE_URL;
      fn(prisma.$queryRaw).mockResolvedValueOnce([riga]);
      const res = await claim({ workerId: 'w-cpu', kinds: ['TRANSLATE_TEXT'] });
      expect(res.status).toBe(204);
      const sql = sqlOf(fn(prisma.$executeRaw).mock.calls[0]!);
      expect(sql).toContain("status = 'FAILED'");
      expect(sql).toContain("status = 'CLAIMED' AND attempts = ?");
    });
  });

});
