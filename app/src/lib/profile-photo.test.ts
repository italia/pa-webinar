// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  hashEmail: (e: string) => `hash:${e}`,
  tryDecryptPII: (v: string) => (v.startsWith('cifrato:') ? v.slice(8) : null),
}));

import sharp from 'sharp';

import { prisma } from '@/lib/db';

import {
  PHOTO_SIDE,
  normalizePhoto,
  profilePhotoPath,
  resolvePhotoOwner,
  sniffImageType,
} from './profile-photo';

const reg = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;
const grant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  reg.mockResolvedValue(null);
  grant.mockResolvedValue(null);
});

describe('sniffImageType', () => {
  it('riconosce JPEG, PNG e WebP dai primi byte', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(
      sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe('image/webp');
  });

  it('un SVG, un testo o un file troppo corto non sono una foto', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg onload="x">'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('normalizePhoto', () => {
  it('ricodifica in JPEG quadrato, senza metadati, qualunque cosa arrivi', async () => {
    const png = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 0, g: 102, b: 204 } },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'luogo-segreto' } } })
      .toBuffer();
    const out = await normalizePhoto(new Uint8Array(png));
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([PHOTO_SIDE, PHOTO_SIDE]);
    expect(meta.exif).toBeUndefined();
  });

  it('un formato non ammesso o un file rotto: null', async () => {
    expect(await normalizePhoto(new TextEncoder().encode('<svg onload="x">'))).toBeNull();
    expect(await normalizePhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBeNull();
  });

  it('un PNG piccolo che dichiara troppi pixel non si decodifica', async () => {
    const enorme = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(enorme.length).toBeLessThan(150_000);
    expect(await normalizePhoto(new Uint8Array(enorme))).toBeNull();
  });
});

describe('profilePhotoPath', () => {
  it("l'indirizzo dipende solo dall'id, che cambia a ogni foto", () => {
    expect(profilePhotoPath({ id: 'p1' })).toBe('/api/avatar/photo/p1');
  });
});

const PROVATO = { token: 'tok', emailVerified: true };
const NON_PROVATO = { token: 'tok', emailVerified: false };

describe('resolvePhotoOwner', () => {
  it("l'iscritto, dal browser che ha aperto il link dell'email", async () => {
    reg.mockResolvedValue({ eventId: 'e1', emailHash: 'h1' });
    expect(await resolvePhotoOwner('e1', 'tok', PROVATO)).toEqual({ kind: 'owner', emailHash: 'h1' });
  });

  it("iscritto dal modulo senza aver aperto l'email: serve la prova dell'indirizzo", async () => {
    reg.mockResolvedValue({ eventId: 'e1', emailHash: 'h1' });
    expect(await resolvePhotoOwner('e1', 'tok', NON_PROVATO)).toEqual({ kind: 'needsEmailProof' });
  });

  it("un link d'iscrizione inoltrato non fa agire come la persona iscritta", async () => {
    reg.mockResolvedValue({ eventId: 'e1', emailHash: 'h1' });
    expect(await resolvePhotoOwner('e1', 'tok', null)).toBeNull();
    expect(await resolvePhotoOwner('e1', 'tok', { token: 'altro', emailVerified: true })).toBeNull();
    // E non ricade sulle concessioni.
    expect(grant).not.toHaveBeenCalled();
  });

  it("un'iscrizione di un altro evento non vale", async () => {
    reg.mockResolvedValue({ eventId: 'altro', emailHash: 'h1' });
    expect(await resolvePhotoOwner('e1', 'tok', PROVATO)).toBeNull();
  });

  it("una concessione nominale o un token senza iscrizione: niente foto", async () => {
    grant.mockResolvedValue({ eventId: 'e1', email: 'cifrato:relatore@ente.it', revokedAt: null });
    expect(await resolvePhotoOwner('e1', 'tok', PROVATO)).toBeNull();
    expect(await resolvePhotoOwner('e1', null, null)).toBeNull();
  });
});
