import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { recordingTrack: { groupBy: vi.fn() } },
}));

import { prisma } from '@/lib/db';

import { cancellaManifestiSenzaTracce } from './manifest';

const groupBy = prisma.recordingTrack.groupBy as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancellaManifestiSenzaTracce', () => {
  it('deletes the manifest only of recordings with no track left', async () => {
    groupBy.mockResolvedValue([{ recordingId: 'r-aperta' }]);
    const del = vi.fn(async () => true);
    const n = await cancellaManifestiSenzaTracce(
      { delete: del },
      new Map([
        ['r-finita', 'ev-1'],
        ['r-aperta', 'ev-1'],
      ])
    );
    expect(n).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('recordings/multitrack/ev-1/r-finita/tracks.json');
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: { recordingId: { in: ['r-finita', 'r-aperta'] }, audioPurgedAt: null },
    });
  });

  it('counts only manifests actually deleted, and survives storage errors', async () => {
    groupBy.mockResolvedValue([]);
    const del = vi
      .fn<(key: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('storage giù'));
    const n = await cancellaManifestiSenzaTracce(
      { delete: del },
      new Map([
        ['r-1', 'ev-1'],
        ['r-2', 'ev-1'],
      ])
    );
    expect(n).toBe(0);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty set, and nothing when the count fails', async () => {
    const del = vi.fn(async () => true);
    expect(await cancellaManifestiSenzaTracce({ delete: del }, new Map())).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
    groupBy.mockRejectedValue(new Error('db giù'));
    expect(
      await cancellaManifestiSenzaTracce({ delete: del }, new Map([['r', 'e']]))
    ).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});
