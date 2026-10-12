// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { siteSetting: { findUnique: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));

import { prisma } from '@/lib/db';

import { GET } from './route';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const call = () =>
  GET(new Request('http://localhost/api/internal/postprod-pending') as never, { params: Promise.resolve({}) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.siteSetting.findUnique).mockResolvedValue({ aiPipelineEnabled: true, aiMaxConcurrentJobs: 2 });
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

  it('pipeline spenta: tutto a zero', async () => {
    fn(prisma.siteSetting.findUnique).mockResolvedValue({ aiPipelineEnabled: false, aiMaxConcurrentJobs: 2 });
    expect(await (await call()).json()).toMatchObject({ desired: 0, desiredGpu: 0, desiredCpu: 0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
