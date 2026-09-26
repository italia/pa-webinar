import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /chat` dice alla sala se gli allegati possono funzionare.
 *
 * Senza uno storage per i file il caricamento risponde 503 a ogni tentativo:
 * offrire la graffetta vorrebbe dire chiedere di riprovare qualcosa che non
 * riuscira' mai. La regola e' la stessa di `uploadsEnabled` nei materiali.
 * L'autorizzazione alla lettura gira davvero; DB, cifratura e storage no.
 */
const { filesStorage } = vi.hoisted(() => ({ filesStorage: { current: null as null | object } }));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn(), findUnique: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => v,
  tryDecryptPII: (v: string) => v,
}));
vi.mock('@/lib/chat/pubsub', () => ({ publishChat: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(async () => false) }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({ guestAccessEnabled: true }) }));
vi.mock('@/lib/event-session', () => ({ readOwnedEventAccessToken: vi.fn(async () => null) }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  getFilesStorage: () => filesStorage.current,
}));

import { prisma } from '@/lib/db';
import type * as StorageModule from '@/lib/storage';

import { GET } from './route';

const mockedFindFirst = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedFindUnique = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedMessages = prisma.chatMessage.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

function eventRow() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: SLUG,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Segreteria',
    joinPasswordHash: null,
  };
}

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function get(): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/chat`, {
    headers: { authorization: `Bearer ${PRIMARY_TOKEN}` },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  filesStorage.current = null;
  mockedFindFirst.mockResolvedValue(eventRow());
  mockedFindUnique.mockResolvedValue(eventRow());
  mockedMessages.mockResolvedValue([]);
  mockedGrant.mockResolvedValue(null);
});

describe('GET /api/events/[param]/chat — attachmentsEnabled', () => {
  it('senza storage per i file: false', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ attachmentsEnabled: false });
  });

  it('con lo storage configurato: true', async () => {
    filesStorage.current = {};
    const res = await GET(get(), ctx());
    expect(await res.json()).toMatchObject({ attachmentsEnabled: true });
  });
});
