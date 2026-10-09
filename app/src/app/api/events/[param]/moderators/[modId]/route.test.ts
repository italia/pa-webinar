import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il profilo di una persona dell'evento (ente, logo, organizzatore, pagina
 * pubblica) si cambia senza toccare il suo link, e solo con il link
 * principale.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => v,
}));
vi.mock('@/lib/auth/moderator', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateModeratorCache: vi.fn(),
}));

import { prisma } from '@/lib/db';

import { PATCH } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const MOD_ID = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PRIMARY = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';

let ip = 0;
function patch(body: Record<string, unknown>, token = PRIMARY): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/events/${EVENT_ID}/moderators/${MOD_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-forwarded-for': `198.51.100.${ip}`,
    },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ param: EVENT_ID, modId: MOD_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY });
  db.eventModerator.findUnique.mockResolvedValue({ id: MOD_ID, eventId: EVENT_ID, role: 'SPEAKER' });
  db.eventModerator.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: MOD_ID,
    name: 'Relatore 1',
    role: 'SPEAKER',
    organizer: false,
    organization: null,
    organizationLogoUrl: null,
    publicListed: false,
    ...data,
  }));
});

describe('PATCH /api/events/[param]/moderators/[modId]', () => {
  it("aggiorna solo i campi del profilo mandati", async () => {
    const res = await PATCH(
      patch({ organization: 'Ente di esempio', publicListed: true }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(db.eventModerator.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOD_ID },
        data: { organization: 'Ente di esempio', publicListed: true },
      }),
    );
    expect(await res.json()).toMatchObject({ organization: 'Ente di esempio', publicListed: true });
  });

  it("un ente vuoto si toglie", async () => {
    await PATCH(patch({ organization: '' }) as never, ctx as never);
    expect(db.eventModerator.update.mock.calls[0]![0].data).toEqual({ organization: null });
  });

  it('un relatore non diventa organizzatore', async () => {
    const res = await PATCH(patch({ organizer: true }) as never, ctx as never);
    expect(res.status).toBe(422);
    expect(db.eventModerator.update).not.toHaveBeenCalled();
  });

  it('serve il link principale', async () => {
    const res = await PATCH(
      patch({ publicListed: true }, '00000000-0000-4000-8000-000000000000') as never,
      ctx as never,
    );
    expect(res.status).toBe(403);
    expect(db.eventModerator.update).not.toHaveBeenCalled();
  });

  it("una persona di un altro evento non si tocca", async () => {
    db.eventModerator.findUnique.mockResolvedValue({ id: MOD_ID, eventId: 'altro', role: 'SPEAKER' });
    const res = await PATCH(patch({ publicListed: true }) as never, ctx as never);
    expect(res.status).toBe(404);
  });
});
