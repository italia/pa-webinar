// @vitest-environment node
import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    profilePhoto: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
// Il cookie del browser che si e' iscritto porta il token ISCRITTO e la prova
// dell'email.
const accesso = vi.hoisted(() => ({
  valore: { token: 'ISCRITTO', emailVerified: true } as { token: string; emailVerified: boolean } | null,
}));
vi.mock('@/lib/event-session', () => ({
  readOwnedEventAccess: vi.fn(async () => accesso.valore),
}));
vi.mock('@/lib/profile-photo', async (importOriginal) => {
  const vero = await importOriginal<typeof Foto>();
  return {
    ...vero,
    resolvePhotoOwner: vi.fn(
      async (_e: string, token: string | null, a: { token: string; emailVerified: boolean } | null) => {
        if (token !== 'ISCRITTO' || a?.token !== token) return null;
        return a.emailVerified ? { kind: 'owner', emailHash: 'h1' } : { kind: 'needsEmailProof' };
      },
    ),
  };
});

import { prisma } from '@/lib/db';
import type * as Foto from '@/lib/profile-photo';

import { DELETE, GET, POST } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });
let PNG: Uint8Array;
const req = (method: string, body?: Uint8Array | ReadableStream, token = 'ISCRITTO') =>
  new Request('https://webinar.gov.it/api/events/evento/profile-photo', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    ...(body && { body: body as unknown as BodyInit, duplex: 'half' }),
  } as RequestInit) as unknown as NextRequest;
const create = prisma.profilePhoto.create as unknown as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  PNG = new Uint8Array(
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0066cc' } }).png().toBuffer(),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  accesso.valore = { token: 'ISCRITTO', emailVerified: true };
  (prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'e1' });
  create.mockResolvedValue({ id: 'p2' });
  (prisma.profilePhoto.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  (prisma.profilePhoto.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe('/api/events/[slug]/profile-photo', () => {
  it("l'iscritto carica una foto: si ricodifica in JPEG e prende un id nuovo", async () => {
    const res = await POST(req('POST', PNG), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ photo: { url: '/api/avatar/photo/p2' } });
    // La vecchia va via nella stessa transazione: il suo indirizzo non mostra la nuova.
    expect(prisma.profilePhoto.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h1' } });
    const data = create.mock.calls[0]?.[0].data as { emailHash: string; contentType: string; bytes: Uint8Array };
    expect(data.emailHash).toBe('h1');
    expect(data.contentType).toBe('image/jpeg');
    const meta = await sharp(data.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 256, 256]);
  });

  it("un file che non e' un'immagine non passa, anche se lo dichiara", async () => {
    const res = await POST(req('POST', new TextEncoder().encode('<svg onload=x>')), ctx());
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it('troppo grande: 413, anche senza Content-Length (corpo a pezzi)', async () => {
    const grande = new Uint8Array(200_000);
    grande.set([0xff, 0xd8, 0xff]);
    expect((await POST(req('POST', grande), ctx())).status).toBe(413);

    let inviati = 0;
    const flusso = new ReadableStream<Uint8Array>({
      pull(controller) {
        inviati += 1;
        if (inviati > 100) controller.close();
        else controller.enqueue(new Uint8Array(64_000));
      },
    });
    const res = await POST(req('POST', flusso), ctx());
    expect(res.status).toBe(413);
    // Si ferma appena oltre il tetto, senza leggere tutto.
    expect(inviati).toBeLessThan(10);
    expect(create).not.toHaveBeenCalled();
  });

  it("senza un'email dietro al token (ospite, link principale): niente foto", async () => {
    expect((await POST(req('POST', PNG, 'ALTRO'), ctx())).status).toBe(403);
    expect(await (await GET(req('GET', undefined, 'ALTRO'), ctx())).json()).toEqual({
      canUpload: false,
      needsEmailProof: false,
      photo: null,
    });
  });

  it("iscritto dal modulo senza aver aperto l'email: la sala lo invita ad aprirla", async () => {
    accesso.valore = { token: 'ISCRITTO', emailVerified: false };
    expect(await (await GET(req('GET'), ctx())).json()).toEqual({
      canUpload: false,
      needsEmailProof: true,
      photo: null,
    });
    expect((await POST(req('POST', PNG), ctx())).status).toBe(403);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(prisma.profilePhoto.deleteMany).not.toHaveBeenCalled();
  });

  it('il link inoltrato (cookie di un altro token) non cambia la foto', async () => {
    accesso.valore = { token: 'UN-ALTRO', emailVerified: true };
    expect((await POST(req('POST', PNG), ctx())).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("togliere cancella la foto di quell'email", async () => {
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(204);
    expect(prisma.profilePhoto.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h1' } });
  });
});
