import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Aggiungere un co-moderatore o un relatore con un indirizzo fa partire il
 * suo link personale per email: e' quello che il wizard e il pannello
 * promettono. Senza indirizzo non parte nulla.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { create: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => v,
  encryptPIIOrNull: (v: string | null | undefined) => v ?? null,
  tryDecryptPII: (v: string | null) => v,
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it' })),
}));
vi.mock('@/lib/email/moderator-link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendGrantModeratorLink: vi.fn(async () => true),
}));

import { prisma } from '@/lib/db';
import { sendGrantModeratorLink } from '@/lib/email/moderator-link';

import { POST } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { create: ReturnType<typeof vi.fn> };
};

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const PRIMARY = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';

let ip = 0;
function post(body: Record<string, unknown>, referer?: string): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/events/${EVENT_ID}/moderators`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PRIMARY}`,
      'x-forwarded-for': `198.51.100.${ip}`,
      ...(referer ? { referer } : {}),
    },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ param: EVENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY });
  db.eventModerator.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'grant-9',
    createdAt: new Date(),
    revokedAt: null,
    ...data,
  }));
});

describe('POST /api/events/[param]/moderators — link by email', () => {
  it('queues the personal link of a speaker added with an address', async () => {
    const res = await POST(
      post(
        { name: 'Relatore 1', email: 'relatore@example.test', role: 'SPEAKER' },
        'https://portale.example.test/en/admin/events/new',
      ) as never,
      ctx as never,
    );
    expect(res.status).toBe(201);
    expect(sendGrantModeratorLink).toHaveBeenCalledWith('grant-9', { locale: 'en' });
  });

  it('queues nothing for a grant without an address', async () => {
    const res = await POST(post({ name: 'Relatore 1', role: 'MODERATOR' }) as never, ctx as never);
    expect(res.status).toBe(201);
    expect(sendGrantModeratorLink).not.toHaveBeenCalled();
  });
});
