import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  constantTimeEqual,
  isEventModerator,
  isEventModeratorCached,
  invalidateModeratorCache,
  verifyModeratorToken,
} from './moderator';

vi.mock('@/lib/db', () => ({
  prisma: {
    eventModerator: { findUnique: vi.fn() },
    event: { findUnique: vi.fn() },
  },
}));

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });

  it('returns false for strings of the same length that differ', () => {
    expect(constantTimeEqual('abcd', 'abce')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('handles multi-byte unicode safely', () => {
    expect(constantTimeEqual('café', 'café')).toBe(true);
    expect(constantTimeEqual('café', 'cafe')).toBe(false);
  });
});

describe('isEventModerator', () => {
  const event = { id: 'evt1', moderatorToken: 'PRIMARY-TOKEN' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accetta il token primario senza interrogare il DB', async () => {
    const { prisma } = await import('@/lib/db');
    expect(await isEventModerator(event, 'PRIMARY-TOKEN')).toBe(true);
    expect(prisma.eventModerator.findUnique).not.toHaveBeenCalled();
  });

  it('accetta un co-moderatore MODERATOR non revocato dello stesso evento', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt1',
      revokedAt: null,
      role: 'MODERATOR',
    } as never);
    expect(await isEventModerator(event, 'comod-token')).toBe(true);
  });

  it('rifiuta un co-moderatore revocato', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt1',
      revokedAt: new Date('2026-01-01'),
      role: 'MODERATOR',
    } as never);
    expect(await isEventModerator(event, 'comod-token')).toBe(false);
  });

  it('rifiuta un grant SPEAKER (nessuna autorita di moderazione)', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt1',
      revokedAt: null,
      role: 'SPEAKER',
    } as never);
    expect(await isEventModerator(event, 'speaker-token')).toBe(false);
  });

  it('rifiuta un co-moderatore di un altro evento', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'altro-evento',
      revokedAt: null,
      role: 'MODERATOR',
    } as never);
    expect(await isEventModerator(event, 'comod-token')).toBe(false);
  });

  it('rifiuta un token sconosciuto e un token nullo', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue(null as never);
    expect(await isEventModerator(event, 'ignoto')).toBe(false);
    expect(await isEventModerator(event, null)).toBe(false);
  });
});

describe('isEventModeratorCached', () => {
  // NB: la cache TTL è condivisa a livello di modulo — ogni test usa un
  // event.id/token proprio per non leggere le entry dei test precedenti.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('il token primario non tocca mai DB né cache', async () => {
    const { prisma } = await import('@/lib/db');
    const event = { id: 'evt-cache-1', moderatorToken: 'PRIMARY' };
    expect(await isEventModeratorCached(event, 'PRIMARY')).toBe(true);
    expect(await isEventModeratorCached(event, 'PRIMARY')).toBe(true);
    expect(prisma.eventModerator.findUnique).not.toHaveBeenCalled();
  });

  it('cachea il miss del partecipante: 1 sola lookup DB entro il TTL', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue(null as never);
    const event = { id: 'evt-cache-2', moderatorToken: 'PRIMARY' };
    expect(await isEventModeratorCached(event, 'partecipante-x')).toBe(false);
    expect(await isEventModeratorCached(event, 'partecipante-x')).toBe(false);
    expect(await isEventModeratorCached(event, 'partecipante-x')).toBe(false);
    expect(prisma.eventModerator.findUnique).toHaveBeenCalledTimes(1);
  });

  it('cachea anche l\'esito positivo del co-moderatore', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt-cache-3',
      revokedAt: null,
      role: 'MODERATOR',
    } as never);
    const event = { id: 'evt-cache-3', moderatorToken: 'PRIMARY' };
    expect(await isEventModeratorCached(event, 'comod-y')).toBe(true);
    expect(await isEventModeratorCached(event, 'comod-y')).toBe(true);
    expect(prisma.eventModerator.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidateModeratorCache rende la revoca immediata (niente attesa TTL)', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt-cache-4',
      revokedAt: null,
      role: 'MODERATOR',
    } as never);
    const event = { id: 'evt-cache-4', moderatorToken: 'PRIMARY' };
    expect(await isEventModeratorCached(event, 'comod-z')).toBe(true);
    // Revoca: il DB ora dice revocato e l'endpoint invalida la chiave.
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt-cache-4',
      revokedAt: new Date('2026-07-06'),
      role: 'MODERATOR',
    } as never);
    invalidateModeratorCache('evt-cache-4', 'comod-z');
    expect(await isEventModeratorCached(event, 'comod-z')).toBe(false);
  });
});

describe('verifyModeratorToken (delega a isEventModerator)', () => {
  const eventRow = { id: 'evt9', moderatorToken: 'PRIMARY-TOKEN' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accetta il token primario e ritorna l\'evento', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow as never);
    expect(await verifyModeratorToken('evt-slug', 'PRIMARY-TOKEN')).toBe(eventRow);
  });

  it('rifiuta un grant SPEAKER come il resto della catena', async () => {
    const { prisma } = await import('@/lib/db');
    vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow as never);
    vi.mocked(prisma.eventModerator.findUnique).mockResolvedValue({
      eventId: 'evt9',
      revokedAt: null,
      role: 'SPEAKER',
    } as never);
    expect(await verifyModeratorToken('evt-slug', 'speaker-token')).toBeNull();
  });
});
