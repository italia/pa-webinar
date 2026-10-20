// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    eventPersonPhoto: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import {
  MAX_PERSON_PHOTO_BYTES,
  PERSON_PHOTO_SIDE,
  personPhotoPath,
} from './person-photo';
import {
  deleteUnreferencedPersonPhotos,
  normalizePersonPhoto,
  usablePersonPhotoId,
} from './person-photo-store';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  eventPersonPhoto: { findFirst: Mock; deleteMany: Mock; create: Mock };
};

const FOTO = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const SENZA_RIFERIMENTI = { leadOf: { none: {} }, grants: { none: {} } };

beforeEach(() => {
  vi.clearAllMocks();
  db.eventPersonPhoto.findFirst.mockResolvedValue(null);
  db.eventPersonPhoto.deleteMany.mockResolvedValue({ count: 0 });
});

describe('personPhotoPath', () => {
  it("l'indirizzo dipende solo dall'id, che cambia a ogni foto", () => {
    expect(personPhotoPath(FOTO)).toBe(`/api/avatar/person/${FOTO}`);
  });
});

describe('normalizePersonPhoto', () => {
  it('ricodifica in un JPEG quadrato di 400 pixel, senza metadati', async () => {
    const png = await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: { r: 0, g: 102, b: 204 },
      },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'luogo-segreto' } } })
      .toBuffer();
    const out = await normalizePersonPhoto(new Uint8Array(png));
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([PERSON_PHOTO_SIDE, PERSON_PHOTO_SIDE]);
    expect(meta.exif).toBeUndefined();
    // Piccola per costruzione: sta comoda nel database.
    expect(out!.byteLength).toBeLessThan(MAX_PERSON_PHOTO_BYTES);
  });

  it('un file che non è una foto: null', async () => {
    expect(
      await normalizePersonPhoto(new TextEncoder().encode('<svg onload="x">'))
    ).toBeNull();
  });
});

describe('usablePersonPhotoId', () => {
  it('assente resta assente, vuoto o malformato è nessuna foto, senza leggere il database', async () => {
    expect(await usablePersonPhotoId(undefined, EVENTO, 'staff')).toBeUndefined();
    expect(await usablePersonPhotoId(null, EVENTO, 'staff')).toBeNull();
    expect(await usablePersonPhotoId('', EVENTO, 'staff')).toBeNull();
    expect(await usablePersonPhotoId('../altro', EVENTO, 'link')).toBeNull();
    expect(db.eventPersonPhoto.findFirst).not.toHaveBeenCalled();
  });

  it('una foto che non c’è più (o di un altro evento) si lascia cadere', async () => {
    db.eventPersonPhoto.findFirst.mockResolvedValue(null);
    expect(await usablePersonPhotoId(FOTO, EVENTO, 'staff')).toBeNull();
  });

  it('una foto usabile torna con il suo id', async () => {
    db.eventPersonPhoto.findFirst.mockResolvedValue({ id: FOTO });
    expect(await usablePersonPhotoId(FOTO, EVENTO, 'staff')).toBe(FOTO);
  });

  it('lo staff, su un evento: una foto che nessuno usa, o già usata da questo evento', async () => {
    await usablePersonPhotoId(FOTO, EVENTO, 'staff');
    expect(db.eventPersonPhoto.findFirst).toHaveBeenCalledWith({
      where: {
        id: FOTO,
        OR: [
          SENZA_RIFERIMENTI,
          { leadOf: { some: { id: EVENTO } } },
          { grants: { some: { eventId: EVENTO } } },
        ],
      },
      select: { id: true },
    });
  });

  it('con il solo link: solo una foto già usata da questo evento, mai una che nessuno usa', async () => {
    // Una foto tolta da un altro evento (o rimasta da un evento cancellato)
    // non la usa nessuno, e il suo indirizzo era pubblico: il link non la
    // aggancia al proprio evento.
    await usablePersonPhotoId(FOTO, EVENTO, 'link');
    expect(db.eventPersonPhoto.findFirst).toHaveBeenCalledWith({
      where: {
        id: FOTO,
        OR: [{ leadOf: { some: { id: EVENTO } } }, { grants: { some: { eventId: EVENTO } } }],
      },
      select: { id: true },
    });
  });

  it('alla creazione dell’evento (lo staff): solo una foto che nessuno usa', async () => {
    await usablePersonPhotoId(FOTO, null, 'staff');
    expect(db.eventPersonPhoto.findFirst).toHaveBeenCalledWith({
      where: { id: FOTO, OR: [SENZA_RIFERIMENTI] },
      select: { id: true },
    });
  });

  it('senza evento e senza staff non c’è foto da accettare: nessuna, senza leggere', async () => {
    expect(await usablePersonPhotoId(FOTO, null, 'link')).toBeNull();
    expect(db.eventPersonPhoto.findFirst).not.toHaveBeenCalled();
  });
});

describe('deleteUnreferencedPersonPhotos', () => {
  it('senza un filtro, o con un elenco vuoto, non cancella niente', async () => {
    expect(await deleteUnreferencedPersonPhotos(prisma, {})).toBe(0);
    expect(await deleteUnreferencedPersonPhotos(prisma, { ids: [] })).toBe(0);
    expect(db.eventPersonPhoto.deleteMany).not.toHaveBeenCalled();
  });

  it('le foto indicate, una volta sola, se nessuno le usa', async () => {
    db.eventPersonPhoto.deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteUnreferencedPersonPhotos(prisma, { ids: [FOTO, FOTO] })).toBe(1);
    expect(db.eventPersonPhoto.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [FOTO] }, ...SENZA_RIFERIMENTI },
    });
  });

  it('quelle caricate prima di una data, se nessuno le usa', async () => {
    const prima = new Date('2026-10-01T00:00:00Z');
    await deleteUnreferencedPersonPhotos(prisma, { olderThan: prima });
    expect(db.eventPersonPhoto.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: prima }, ...SENZA_RIFERIMENTI },
    });
  });
});

describe('cancellare una foto', () => {
  it('passa sempre dal controllo dei riferimenti', () => {
    // Una foto può servire più eventi (la copia di un evento la condivide):
    // una deleteMany senza controllo la toglierebbe anche a chi la usa ancora.
    const src = path.resolve(__dirname, '../..');
    const fuori = (readdirSync(src, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => f !== 'lib/events/person-photo-store.ts')
      .filter((f) =>
        /eventPersonPhoto\.delete/.test(readFileSync(path.join(src, f), 'utf-8'))
      );
    expect(fuori).toEqual([]);
  });
});
