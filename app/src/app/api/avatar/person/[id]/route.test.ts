import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { eventPersonPhoto: { findUnique: vi.fn() } },
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const find = prisma.eventPersonPhoto.findUnique as unknown as ReturnType<typeof vi.fn>;
const get = (id: string) =>
  GET(new Request(`https://webinar.gov.it/api/avatar/person/${id}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/avatar/person/[id]', () => {
  it('serve l’immagine col suo tipo, senza poter eseguire niente', async () => {
    find.mockResolvedValue({
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
    });
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    // Solo nel browser, e per un'ora: una foto tolta smette presto di vedersi.
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff])
    );
  });

  it('tolta, o con un id che non è un UUID: 404', async () => {
    find.mockResolvedValue(null);
    const tolta = await get(ID);
    expect(tolta.status).toBe(404);
    expect(tolta.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await get('../segreto')).status).toBe(404);
    expect(find).toHaveBeenCalledTimes(1);
  });
});
