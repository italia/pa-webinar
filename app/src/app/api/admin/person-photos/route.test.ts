// @vitest-environment node
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il caricamento della foto di una persona dell'evento dal wizard: solo lo
 * staff, il corpo è l'immagine, il server la ricodifica e la salva.
 */
const { staff, audit } = vi.hoisted(() => ({
  staff: { ok: true },
  audit: vi.fn(async () => undefined),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/auth/staff-session', async () => {
  const { UnauthorizedError } = await import('@/lib/errors');
  return {
    requireStaff: vi.fn(async () => {
      if (!staff.ok) throw new UnauthorizedError();
      return { role: 'organizer', accountId: 'acc-1' };
    }),
  };
});
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: audit }));
vi.mock('@/lib/db', () => ({
  prisma: { eventPersonPhoto: { create: vi.fn() } },
}));
// Il limite per minuto è in memoria e sopravvive fra i test: qui non è l'oggetto.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }),
}));

import { prisma } from '@/lib/db';
import { MAX_PERSON_PHOTO_BYTES } from '@/lib/events/person-photo';
import type * as RateLimitModule from '@/lib/rate-limit';

import { POST } from './route';

const create = prisma.eventPersonPhoto.create as unknown as ReturnType<typeof vi.fn>;
const ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({}) };

function richiesta(body: Uint8Array, tipo = 'image/jpeg'): Request {
  return new Request('https://webinar.example.gov.it/api/admin/person-photos', {
    method: 'POST',
    headers: { 'content-type': tipo, 'content-length': String(body.byteLength) },
    body: new Uint8Array(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  staff.ok = true;
  create.mockResolvedValue({ id: ID });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('POST /api/admin/person-photos', () => {
  it('senza sessione dello staff: 401, niente salvato', async () => {
    staff.ok = false;
    const res = await POST(
      richiesta(new Uint8Array([0xff, 0xd8, 0xff])) as never,
      ctx as never
    );
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('una foto vera: 201 con id e indirizzo, ricodificata in JPEG 400x400', async () => {
    const png = await sharp({
      create: { width: 300, height: 500, channels: 3, background: '#0066cc' },
    })
      .png()
      .toBuffer();
    const res = await POST(
      richiesta(new Uint8Array(png), 'image/png') as never,
      ctx as never
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID, url: `/api/avatar/person/${ID}` });
    const salvata = create.mock.calls[0]![0] as {
      data: { contentType: string; bytes: Uint8Array };
    };
    expect(salvata.data.contentType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(salvata.data.bytes)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 400, 400]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PERSON_PHOTO_UPLOAD', target: ID })
    );
  });

  it('un file che non è una foto: 422 PHOTO_INVALID', async () => {
    const res = await POST(
      richiesta(new TextEncoder().encode('<svg onload="x">'), 'image/svg+xml') as never,
      ctx as never
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('PHOTO_INVALID');
    expect(create).not.toHaveBeenCalled();
  });

  it('un corpo vuoto: 422', async () => {
    const res = await POST(richiesta(new Uint8Array()) as never, ctx as never);
    expect(res.status).toBe(422);
  });

  it('oltre il tetto: 413 PHOTO_TOO_LARGE, senza leggerla', async () => {
    const res = await POST(
      richiesta(new Uint8Array(MAX_PERSON_PHOTO_BYTES + 1)) as never,
      ctx as never
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PHOTO_TOO_LARGE');
    expect(create).not.toHaveBeenCalled();
  });
});
