// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    postprodJob: { update: vi.fn() },
    siteSetting: { findUnique: vi.fn(async () => ({ aiLlmProvider: 'vllm' })) },
  },
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
    expect(fn(prisma.postprodJob.update).mock.calls[0]![0].data.payload).toMatchObject({
      eventId,
      metrics: { version: 1, durationSec: 3600 },
    });
  });
});
