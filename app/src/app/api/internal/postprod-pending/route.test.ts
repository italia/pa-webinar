// @vitest-environment node
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { siteSetting: { findUnique: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));

import { prisma } from '@/lib/db';

import { GET } from './route';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const call = () =>
  GET(new Request('http://localhost/api/internal/postprod-pending') as never, { params: Promise.resolve({}) } as never);
/** La query mandata al database, ricomposta con i suoi frammenti. */
const query = () => {
  const [testi, ...valori] = fn(prisma.$queryRaw).mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(testi, ...valori);
};
const MOTORE = 'http://pa-webinar-mt.pa-webinar.svc.cluster.local:8080/v1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AI_MT_BASE_URL', MOTORE);
  fn(prisma.siteSetting.findUnique).mockResolvedValue({ aiPipelineEnabled: true, aiMaxConcurrentJobs: 2 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/internal/postprod-pending', () => {
  it('separa il lavoro per il worker con la GPU (trascrizione) da quello senza', async () => {
    // 3 pronti + 1 preso; fra questi una trascrizione pronta.
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 3n, claimed: 1n, running: 1n, gpu_runnable: 1n, gpu_claimed: 0n },
    ]);
    const body = await (await call()).json();
    // Il tetto (2) resta complessivo: uno alla trascrizione, uno al resto.
    expect(body).toMatchObject({ desired: 2, desiredGpu: 1, desiredCpu: 1, maxConcurrent: 2 });
    // La query conta la classe GPU con l'elenco dei suoi tipi.
    const params = fn(prisma.$queryRaw).mock.calls[0]!.slice(1);
    expect(params).toContainEqual(['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK', 'DUB']);
  });

  it('con un solo posto passa prima la trascrizione', async () => {
    fn(prisma.siteSetting.findUnique).mockResolvedValue({ aiPipelineEnabled: true, aiMaxConcurrentJobs: 1 });
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 2n, claimed: 0n, running: 0n, gpu_runnable: 1n, gpu_claimed: 0n },
    ]);
    expect(await (await call()).json()).toMatchObject({ desired: 1, desiredGpu: 1, desiredCpu: 0 });
  });

  it('solo una sintesi in coda: nessun worker con la GPU', async () => {
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 1n, claimed: 0n, running: 0n, gpu_runnable: 0n, gpu_claimed: 0n },
    ]);
    expect(await (await call()).json()).toMatchObject({ desiredGpu: 0, desiredCpu: 1 });
  });

  it('quale motore tenere acceso: vLLM solo per i lavori che lo usano, il motore su CPU per la traduzione dei testi', async () => {
    // Una traduzione dei testi in esecuzione e nient'altro: vLLM resta spento.
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 0n, claimed: 0n, running: 1n, gpu_runnable: 0n, gpu_claimed: 0n, llm_work: 0n, mt_work: 1n },
    ]);
    expect(await (await call()).json()).toMatchObject({ desired: 0, desiredLlm: 0, desiredMt: 1 });
    const params = fn(prisma.$queryRaw).mock.calls[0]!.slice(1);
    expect(params).toContainEqual(['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK', 'SUMMARIZE', 'TRANSLATE', 'REPORT']);
    expect(params).toContainEqual(['TRANSLATE_TEXT']);
    // La traduzione dei testi non e' mai fra i lavori di vLLM.
    const llm = params.find((p) => Array.isArray(p) && p.includes('SUMMARIZE')) as string[];
    expect(llm).not.toContain('TRANSLATE_TEXT');
    expect(llm).not.toContain('DUB');
    expect(llm).not.toContain('ARCHIVE');
  });

  it('per il worker con la GPU che fa tutto, la traduzione dei testi non conta', async () => {
    // Due traduzioni dei testi e una trascrizione pronte, due posti: senza
    // worker CPU il worker con la GPU serve solo alla trascrizione, e il
    // tetto non le toglie il posto.
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 3n, claimed: 0n, running: 0n, gpu_runnable: 1n, gpu_claimed: 0n, llm_work: 1n, mt_work: 2n, mt_queued: 2n },
    ]);
    expect(await (await call()).json()).toMatchObject({ desired: 2, desiredMt: 2, desiredWithoutMt: 1 });
    // Solo traduzioni dei testi: nessun worker con la GPU.
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 1n, claimed: 1n, running: 0n, gpu_runnable: 0n, gpu_claimed: 0n, llm_work: 0n, mt_work: 2n, mt_queued: 2n },
    ]);
    expect(await (await call()).json()).toMatchObject({ desired: 2, desiredCpu: 2, desiredWithoutMt: 0 });
    // Con il motore configurato la coda si conta tutta.
    expect(query().sql).not.toContain('<> ALL');
  });

  it('senza motore di traduzione i suoi lavori non contano: nessun worker li prenderebbe', async () => {
    vi.stubEnv('AI_MT_BASE_URL', '');
    fn(prisma.$queryRaw).mockResolvedValue([
      { runnable: 0n, claimed: 0n, running: 0n, gpu_runnable: 0n, gpu_claimed: 0n, llm_work: 0n, mt_work: 0n, mt_queued: 0n },
    ]);
    expect(await (await call()).json()).toMatchObject({
      desired: 0,
      desiredGpu: 0,
      desiredCpu: 0,
      desiredMt: 0,
      desiredWithoutMt: 0,
    });
    // Il filtro e' sull'intera coda: pronti, presi, in esecuzione, motori.
    const q = query();
    expect(q.sql.trimEnd()).toMatch(/FROM postprod_jobs j\s+WHERE j\.kind::text <> ALL\(\?::text\[\]\)$/);
    expect(q.values.at(-1)).toEqual(['TRANSLATE_TEXT']);
  });

  it('pipeline spenta: tutto a zero', async () => {
    fn(prisma.siteSetting.findUnique).mockResolvedValue({ aiPipelineEnabled: false, aiMaxConcurrentJobs: 2 });
    expect(await (await call()).json()).toMatchObject({
      desired: 0,
      desiredGpu: 0,
      desiredCpu: 0,
      desiredLlm: 0,
      desiredMt: 0,
      desiredWithoutMt: 0,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
