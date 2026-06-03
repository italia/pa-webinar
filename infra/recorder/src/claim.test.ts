import { describe, it, expect } from 'vitest';

import { claimWorkOrder } from './claim';

describe('claimWorkOrder', () => {
  it('POST a recorder-claim con x-api-key e ritorna il work-order', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          recordingId: 'rec1',
          eventId: 'evt1',
          roomName: 'room-uuid',
          jwt: 'jwt-token',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const wo = await claimWorkOrder({
      portalUrl: 'https://app/',
      cronApiKey: 'k',
      recordingId: 'rec1',
      fetchImpl: fakeFetch,
    });

    expect(wo).toEqual({
      recordingId: 'rec1',
      eventId: 'evt1',
      roomName: 'room-uuid',
      jwt: 'jwt-token',
    });
    expect(calls[0]!.url).toBe('https://app/api/internal/recorder-claim');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(String(calls[0]!.init?.body)).toContain('rec1');
  });

  it('lancia se il claim non è ok', async () => {
    const fakeFetch = (async () =>
      new Response(null, { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(
      claimWorkOrder({ portalUrl: 'https://app', cronApiKey: 'k', recordingId: 'r', fetchImpl: fakeFetch }),
    ).rejects.toThrow(/404/);
  });
});
