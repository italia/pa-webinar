// @vitest-environment node
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il caricamento di un file dall'area admin su un'installazione senza storage
 * per i file: e' una configurazione ammessa (installazioni di prova, cluster
 * senza object storage), non un guasto. Il client riceve 503 con il codice
 * STORAGE_UNAVAILABLE, che traduce nella lingua della pagina; il log della
 * richiesta resta a livello `warn`. Un errore vero dello storage resta `error`.
 */
const { storage } = vi.hoisted(() => ({
  storage: { current: null as null | { put: ReturnType<typeof vi.fn> } },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireStaff: vi.fn(async () => ({ role: 'ADMIN' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => storage.current }));
// Il limite per minuto e' in memoria e sopravvive fra i test: qui non e' l'oggetto.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }),
}));

import type * as RateLimitModule from '@/lib/rate-limit';

import { POST } from './route';

const ORIGIN = 'https://webinar.example.gov.it';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ctx = { params: Promise.resolve({}) };

async function upload(): Promise<NextRequest> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(PNG)], 'logo.png', { type: 'image/png' }));
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  return new Request(`${ORIGIN}/api/admin/assets/upload-url?type=image`, {
    method: 'POST',
    headers: {
      'content-type': encoded.headers.get('content-type') ?? '',
      'content-length': String(body.byteLength),
    },
    body,
  }) as unknown as NextRequest;
}

/** Il livello della riga di log della richiesta scritta da withErrorHandling. */
function livelloDelLog(spia: ReturnType<typeof vi.spyOn>): string | undefined {
  for (const [riga] of spia.mock.calls as unknown[][]) {
    if (typeof riga !== 'string') continue;
    try {
      const j = JSON.parse(riga) as { level?: string; path?: string };
      if (j.path === '/api/admin/assets/upload-url') return j.level;
    } catch {
      /* non e' la riga della richiesta */
    }
  }
  return undefined;
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  storage.current = null;
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/admin/assets/upload-url', () => {
  it('senza storage: 503 STORAGE_UNAVAILABLE, registrato come warn', async () => {
    const res = await POST(await upload(), ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('STORAGE_UNAVAILABLE');
    expect(livelloDelLog(log)).toBe('warn');
  });

  it('con lo storage che non scrive: 502, registrato come error', async () => {
    storage.current = { put: vi.fn(async () => { throw new Error('boom'); }) };
    const res = await POST(await upload(), ctx);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code?: string }).code).toBe('STORAGE_WRITE_FAILED');
    expect(livelloDelLog(log)).toBe('error');
  });

  it('con lo storage: carica e restituisce l’indirizzo servito dall’app', async () => {
    const put = vi.fn(async () => undefined);
    storage.current = { put };
    const res = await POST(await upload(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string };
    expect(put).toHaveBeenCalledOnce();
    expect(body.key).toMatch(/^assets\/image\//);
    expect(body.url).toContain('/api/assets/image/');
    expect(livelloDelLog(log)).toBe('info');
  });
});
