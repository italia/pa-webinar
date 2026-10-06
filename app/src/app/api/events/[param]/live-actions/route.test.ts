import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(async () => 1),
    liveAction: { findFirst: vi.fn(), create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})) },
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'MOD'),
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });
const post = (body: unknown, token = 'MOD') =>
  new Request('https://webinar.gov.it/api/events/evento/live-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const ultima = tx.liveAction.findFirst;
const scritte = () => tx.liveAction.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: EVENT_ID });
  ultima.mockResolvedValue(null);
});

describe('POST /api/events/[slug]/live-actions', () => {
  it('l’avvio della registrazione va in cronologia all’ora del server', async () => {
    const adesso = Date.now();
    const res = await POST(
      post({ kind: 'recording.started', atEpochMs: adesso + 58_000, sentAt: adesso + 60_000 }),
      ctx(),
    );
    expect(res.status).toBe(204);
    const scritto = scritte()[0];
    expect(scritto).toMatchObject({ eventId: EVENT_ID, kind: 'recording.started', actor: 'moderator' });
    expect(Math.abs((scritto?.at as Date).getTime() - (adesso - 2_000))).toBeLessThan(1_000);
    // Controllo e scrittura dopo il lucchetto per evento.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(ultima.mock.invocationCallOrder[0]!);
  });

  it('lo stesso cambio da un secondo moderatore non si ripete', async () => {
    ultima.mockResolvedValue({ kind: 'recording.started', at: new Date(Date.now() - 20_000) });
    expect((await POST(post({ kind: 'recording.started' }), ctx())).status).toBe(204);
    expect(scritte()).toHaveLength(0);
    expect((await POST(post({ kind: 'recording.stopped' }), ctx())).status).toBe(204);
    expect(scritte()).toHaveLength(1);
  });

  it('un nuovo avvio molto dopo si scrive anche senza l’arresto in mezzo', async () => {
    ultima.mockResolvedValue({ kind: 'recording.started', at: new Date(Date.now() - 30 * 60_000) });
    await POST(post({ kind: 'recording.started' }), ctx());
    expect(scritte()).toHaveLength(1);
  });

  it('solo chi modera, e solo le azioni previste', async () => {
    expect((await POST(post({ kind: 'recording.started' }, 'ALTRO'), ctx())).status).toBe(403);
    expect((await POST(post({ kind: 'poll.opened' }), ctx())).status).toBeGreaterThanOrEqual(400);
    expect(scritte()).toHaveLength(0);
  });
});
