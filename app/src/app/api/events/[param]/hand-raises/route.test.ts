/**
 * Le alzate di mano: nel log della sessione come prima (endpoint e stato),
 * e nella cronologia della sala all'ora del server, senza l'endpoint.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    callSession: { findFirst: vi.fn() },
    liveAction: { count: vi.fn(async () => 0) },
    $executeRaw: vi.fn(async () => 1),
  },
}));
vi.mock('@/lib/live/actions', async (importOriginal) => {
  const vero = await importOriginal<typeof Actions>();
  return { ...vero, recordLiveActions: vi.fn() };
});

import { prisma } from '@/lib/db';
import type * as Actions from '@/lib/live/actions';
import { recordLiveActions } from '@/lib/live/actions';

import { POST } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });
let ip = 10;
/** La cronologia si scrive dopo la risposta: si aspetta un giro. */
const dopo = () => new Promise((r) => setTimeout(r, 0));
const post = (body: unknown) =>
  new Request('https://webinar.gov.it/api/events/evento/hand-raises', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `203.0.113.${ip++}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: EVENT_ID });
  (prisma.callSession.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
});

describe('POST /api/events/[slug]/hand-raises', () => {
  it('scrive la cronologia all’ora del server, senza l’endpoint', async () => {
    const adesso = Date.now();
    const res = await POST(
      post({
        // Il browser e' avanti di 60 s: l'alzata e' di 5 s fa sull'orologio del server.
        events: [{ participantId: 'ep1', raised: true, atEpochMs: adesso + 55_000 }],
        sentAt: adesso + 60_000,
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    await dopo();
    const righe = vi.mocked(recordLiveActions).mock.calls[0]?.[0] ?? [];
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ eventId: EVENT_ID, kind: 'hand.raised', actor: 'participant' });
    expect(righe[0]).not.toHaveProperty('data');
    const scarto = Math.abs((righe[0]?.at as Date).getTime() - (adesso - 5_000));
    expect(scarto).toBeLessThan(1_000);
  });

  it('il log della sessione resta com’era; le mani abbassate non vanno in cronologia', async () => {
    await POST(post({ events: [{ participantId: 'ep1', raised: false, atEpochMs: Date.now() }] }), ctx());
    const valori = (prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.slice(1) ?? [];
    const json = valori.find((v) => typeof v === 'string' && v.startsWith('[')) as string;
    expect(JSON.parse(json)).toEqual([{ participantId: 'ep1', raised: false }]);
    expect(recordLiveActions).not.toHaveBeenCalled();
  });

  it('una mano per persona a lotto, al massimo venti, e niente oltre il tetto per evento', async () => {
    const tante = Array.from({ length: 60 }, (_, i) => ({ participantId: `ep${i % 30}`, raised: true }));
    await POST(post({ events: tante }), ctx());
    await dopo();
    expect(vi.mocked(recordLiveActions).mock.calls[0]?.[0]).toHaveLength(20);

    vi.mocked(recordLiveActions).mockClear();
    (prisma.liveAction.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(5000);
    await POST(post({ events: [{ participantId: 'ep1', raised: true }] }), ctx());
    await dopo();
    expect(recordLiveActions).not.toHaveBeenCalled();
  });

  it('da un solo indirizzo, al massimo sessanta alzate ogni cinque minuti', async () => {
    const stesso = (body: unknown) =>
      new Request('https://webinar.gov.it/api/events/evento/hand-raises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
        body: JSON.stringify(body),
      }) as unknown as NextRequest;
    let scritte = 0;
    for (let lotto = 0; lotto < 5; lotto++) {
      const ev = Array.from({ length: 20 }, (_, i) => ({ participantId: `l${lotto}-${i}`, raised: true }));
      await POST(stesso({ events: ev }), ctx());
      await dopo();
    }
    for (const c of vi.mocked(recordLiveActions).mock.calls) scritte += c[0].length;
    expect(scritte).toBe(60);
  });

  it('un client precedente, senza le ore: l’ora di arrivo', async () => {
    const prima = Date.now();
    await POST(post({ events: [{ participantId: 'ep1', raised: true }] }), ctx());
    await dopo();
    const at = (vi.mocked(recordLiveActions).mock.calls[0]?.[0]?.[0]?.at as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(prima);
  });
});
