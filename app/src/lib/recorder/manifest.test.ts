import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { recordingTrack: { groupBy: vi.fn() } },
}));

import { prisma } from '@/lib/db';

import { cancellaManifesto, cancellaManifestiSenzaTracce } from './manifest';

const groupBy = prisma.recordingTrack.groupBy as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(n).toEqual({ cancellati: 1, falliti: 0 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('recordings/multitrack/ev-1/r-finita/tracks.json');
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: { recordingId: { in: ['r-finita', 'r-aperta'] }, audioPurgedAt: null },
    });
  });

  it('counts only manifests actually deleted, and the failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    expect(n).toEqual({ cancellati: 0, falliti: 1 });
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty set, and counts every manifest as failed when the lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const del = vi.fn(async () => true);
    expect(await cancellaManifestiSenzaTracce({ delete: del }, new Map())).toEqual({
      cancellati: 0,
      falliti: 0,
    });
    expect(groupBy).not.toHaveBeenCalled();
    groupBy.mockRejectedValue(new Error('db giù'));
    expect(
      await cancellaManifestiSenzaTracce({ delete: del }, new Map([['r', 'e']]))
    ).toEqual({ cancellati: 0, falliti: 1 });
    expect(del).not.toHaveBeenCalled();
  });
});

describe('cancellaManifesto', () => {
  it('tells deleted, absent and failed apart, without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const del = vi
      .fn<(key: string) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('storage giù'));
    expect(await cancellaManifesto({ delete: del }, 'ev-1', 'r-1')).toBe('cancellato');
    expect(await cancellaManifesto({ delete: del }, 'ev-1', 'r-1')).toBe('assente');
    expect(await cancellaManifesto({ delete: del }, 'ev-1', 'r-1')).toBe('fallito');
    expect(del).toHaveBeenCalledWith('recordings/multitrack/ev-1/r-1/tracks.json');
  });
});
