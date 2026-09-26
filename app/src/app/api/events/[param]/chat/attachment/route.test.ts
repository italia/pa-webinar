// @vitest-environment node
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Allegare un file in chat su un'installazione senza storage per i file: e'
 * una configurazione ammessa, non un guasto. Il client riceve 503 con il
 * codice STORAGE_UNAVAILABLE, che traduce nella lingua della sala; il log
 * della richiesta resta a livello `warn`.
 */

vi.mock('@/lib/db', () => ({
  prisma: { event: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/chat/sender', () => ({
  resolveTokenSender: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => null }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }),
}));

import type * as RateLimitModule from '@/lib/rate-limit';
import { resolveTokenSender } from '@/lib/chat/sender';
import { prisma } from '@/lib/db';

import { POST } from './route';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ctx = () => ({ params: Promise.resolve({ param: EVENT_ID }) });

function upload(): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/events/${EVENT_ID}/chat/attachment`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-di-sala', 'content-length': '100' },
    body: 'x'.repeat(100),
  }) as unknown as NextRequest;
}

function livelloDelLog(spia: { mock: { calls: unknown[][] } }): string | undefined {
  for (const [riga] of spia.mock.calls) {
    if (typeof riga !== 'string') continue;
    try {
      const j = JSON.parse(riga) as { level?: string; path?: string };
      if (j.path?.endsWith('/chat/attachment')) return j.level;
    } catch {
      /* non e' la riga della richiesta */
    }
  }
  return undefined;
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: EVENT_ID,
    moderatorToken: 'token-primario',
    moderatorName: null,
  } as never);
  vi.mocked(resolveTokenSender).mockResolvedValue({ senderId: 'reg-1' } as never);
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/events/[param]/chat/attachment — senza storage', () => {
  it('503 STORAGE_UNAVAILABLE, registrato come warn', async () => {
    const res = await POST(upload(), ctx());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('STORAGE_UNAVAILABLE');
    expect(livelloDelLog(log)).toBe('warn');
  });
});
