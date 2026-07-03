import { describe, it, expect, vi, beforeEach } from 'vitest';

import { constantTimeEqual, isEventModerator } from './moderator';

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
