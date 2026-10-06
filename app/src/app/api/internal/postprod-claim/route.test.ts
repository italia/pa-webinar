// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));

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
});
