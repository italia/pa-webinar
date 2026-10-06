/**
 * Il timer del moderatore: cosa finisce nella cronologia della sala. Lo stato
 * del conto alla rovescia vive nella cache in memoria (vera, qui), il resto si
 * stubba.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { event: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'MOD'),
}));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

import { deleteCache } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';

import { POST } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const SLUG = 'evento-di-prova';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });
let ipSeq = 0;
const post = (body: unknown, token = 'MOD') =>
  new Request(`https://webinar.gov.it/api/events/${SLUG}/timer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Un indirizzo per richiesta: il tetto per IP non e' l'oggetto di questi test.
      'x-forwarded-for': `192.0.2.${++ipSeq % 250}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  deleteCache(`timer:${EVENT_ID}`);
  mockedEvent.mockResolvedValue({ id: EVENT_ID });
});

describe('POST /api/events/[slug]/timer — cronologia', () => {
  it('avviare registra la durata in secondi', async () => {
    const res = await POST(post({ action: 'start', duration: 120 }), ctx());
    expect(res.status).toBe(200);
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'timer.started',
      actor: 'moderator',
      data: { durationSec: 120 },
    });
  });

  it('fermare un timer che corre registra lo stop, una volta sola', async () => {
    await POST(post({ action: 'start', duration: 120 }), ctx());
    vi.mocked(recordLiveAction).mockClear();

    await POST(post({ action: 'pause' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'timer.stopped',
      actor: 'moderator',
    });

    // Gia' in pausa: azzerarlo non ferma niente di nuovo.
    vi.mocked(recordLiveAction).mockClear();
    await POST(post({ action: 'reset' }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('azzerare un timer che corre registra lo stop', async () => {
    await POST(post({ action: 'start', duration: 60 }), ctx());
    vi.mocked(recordLiveAction).mockClear();
    await POST(post({ action: 'reset' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timer.stopped' }),
    );
  });

  it('azzerare un timer mai partito, o cambiarne la visibilita’, non registra niente', async () => {
    await POST(post({ action: 'reset' }), ctx());
    await POST(post({ action: 'visibility', visible: false }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('senza moderazione: niente', async () => {
    const res = await POST(post({ action: 'start', duration: 60 }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});
