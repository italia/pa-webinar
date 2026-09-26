import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from '@/lib/db';

import { GET } from './route';

/**
 * La sonda che Kubernetes interroga, e l'unico punto da cui si legge dall'esterno
 * quale versione stia girando. Dichiarava un numero fisso — identico per ogni
 * versione mai rilasciata — perché leggeva `npm_package_version`, che esiste solo
 * se il processo parte da uno script npm: nel container il server parte diretto.
 */
const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

async function call() {
  const request = new Request('http://localhost/api/health');
  return GET(request as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({}),
  });
}

describe('GET /api/health', () => {
  const originali = {
    version: process.env.NEXT_PUBLIC_BUILD_VERSION,
    sha: process.env.NEXT_PUBLIC_BUILD_SHA,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    process.env.NEXT_PUBLIC_BUILD_VERSION = '9.9.9';
    process.env.NEXT_PUBLIC_BUILD_SHA = 'abc1234';
  });

  afterEach(() => {
    for (const [chiave, valore] of Object.entries({
      NEXT_PUBLIC_BUILD_VERSION: originali.version,
      NEXT_PUBLIC_BUILD_SHA: originali.sha,
    })) {
      if (valore === undefined) delete process.env[chiave];
      else process.env[chiave] = valore;
    }
  });

  it('dichiara la versione dell’immagine in esecuzione, non un numero fisso', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string; commit: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('9.9.9');
    expect(body.commit).toBe('abc1234');
  });

  it('risponde 503 quando il database non risponde', async () => {
    queryRaw.mockRejectedValue(new Error('connessione rifiutata'));
    const res = await call();
    expect(res.status).toBe(503);
  });
});
