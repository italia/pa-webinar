// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getRecordingsStorage: vi.fn((): unknown => null) }));
vi.mock('./index', () => ({
  getRecordingsStorage: storage.getRecordingsStorage,
  recordingsProviderLabel: () => 'not-configured',
}));
const db = vi.hoisted(() => ({
  recording: { findMany: vi.fn() },
  event: { findMany: vi.fn() },
  callSession: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  appartenenzaChiave,
  assertVideoDellEvento,
  assertVideoNelloStorage,
  generateRecordingSasUrl,
} from './recordings';
import type { StorageProvider } from './provider';

const FILE = 'https://storage.example.com/recordings/sala.mp4';
const ESTERNO = 'https://altro.example.com/video.mp4';
const conStorage = () =>
  storage.getRecordingsStorage.mockReturnValue({
    keyFromUrl: (url: string) => (url === FILE ? 'recordings/sala.mp4' : null),
  });

beforeEach(() => {
  storage.getRecordingsStorage.mockReturnValue(null);
  db.recording.findMany.mockResolvedValue([]);
  db.event.findMany.mockResolvedValue([]);
  db.callSession.findMany.mockResolvedValue([]);
});

describe('assertVideoNelloStorage', () => {
  it('su un evento riservato un indirizzo esterno nuovo si rifiuta', () => {
    conStorage();
    expect(() => assertVideoNelloStorage('REGISTRANTS', null, ESTERNO)).toThrow(
      expect.objectContaining({
        statusCode: 409,
        code: 'RECORDING_DESTINATION_NOT_COVERED',
      })
    );
  });

  it('un file dello storage passa', () => {
    conStorage();
    expect(() => assertVideoNelloStorage('REGISTRANTS', null, FILE)).not.toThrow();
  });

  it('lo stesso indirizzo di prima non si rifiuta: restringere non produce 409', () => {
    conStorage();
    expect(() => assertVideoNelloStorage('REGISTRANTS', ESTERNO, ESTERNO)).not.toThrow();
  });

  it.each([null, undefined])('togliere il video non si rifiuta (%s)', (dopo) => {
    conStorage();
    expect(() => assertVideoNelloStorage('REGISTRANTS', ESTERNO, dopo)).not.toThrow();
  });

  it.each(['PUBLIC', null] as const)('con destinazione %s non guarda', (destinazione) => {
    conStorage();
    expect(() => assertVideoNelloStorage(destinazione, null, ESTERNO)).not.toThrow();
  });

  it('senza storage configurato l’indirizzo vale com’e’', () => {
    expect(() => assertVideoNelloStorage('REGISTRANTS', null, ESTERNO)).not.toThrow();
  });
});

describe('di chi e’ un file dello storage', () => {
  const EVENTO = '11111111-1111-4111-8111-111111111111';
  const ALTRO = '22222222-2222-4222-8222-222222222222';
  // Due forme dello stesso oggetto: path-style e virtual-host.
  const fornitore = {
    keyFromUrl: (url: string) => {
      const u = new URL(url);
      return u.hostname.startsWith('bucket.')
        ? u.pathname.slice(1)
        : u.pathname.split('/').slice(2).join('/');
    },
    getDownloadUrl: vi.fn(async (key: string) => `https://firmato.test/${key}`),
  } as unknown as StorageProvider;

  it('il nome che porta un evento decide da solo', async () => {
    expect(
      await appartenenzaChiave(fornitore, `postprod/${EVENTO}/r/mix.mp4`, EVENTO)
    ).toBe('dell-evento');
    expect(
      await appartenenzaChiave(
        fornitore,
        `recordings/multitrack/${ALTRO}/r/a.ogg`,
        EVENTO
      )
    ).toBe('altrui');
    expect(db.recording.findMany).not.toHaveBeenCalled();
  });

  it('il file di una registrazione, di un evento o di una sessione altrui e’ altrui, in ogni forma dell’indirizzo', async () => {
    db.recording.findMany.mockResolvedValueOnce([{ eventId: ALTRO }]);
    expect(await appartenenzaChiave(fornitore, 'recordings/sala.mp4', EVENTO)).toBe(
      'altrui'
    );
    db.event.findMany.mockResolvedValueOnce([
      { recordingUrl: 'https://bucket.s3.test/recordings/sala.mp4' },
    ]);
    expect(await appartenenzaChiave(fornitore, 'recordings/sala.mp4', EVENTO)).toBe(
      'altrui'
    );
    db.callSession.findMany.mockResolvedValueOnce([
      { recordingUrl: 'https://s3.test/bucket/recordings/sala.mp4' },
    ]);
    expect(await appartenenzaChiave(fornitore, 'recordings/sala.mp4', EVENTO)).toBe(
      'altrui'
    );
  });

  it('una chiave ambigua non e’ di nessuno: non si firma ne’ si aggancia', async () => {
    for (const key of [
      `recordings/multitrack/${EVENTO}/..%2F..%2F..%2Fpostprod/${ALTRO}/r/mix.mp4`,
      `recordings/multitrack/${EVENTO}/../../postprod/${ALTRO}/mix.mp4`,
      `postprod/${EVENTO}//mix.mp4`,
      `postprod/${EVENTO}/%2e%2e/mix.mp4`,
      'publications\\2026\\x.mp4',
    ]) {
      expect(await appartenenzaChiave(fornitore, key, EVENTO), key).toBe('altrui');
    }
    expect(db.recording.findMany).not.toHaveBeenCalled();
  });

  it('il recupero in diretta di un altro evento e’ suo', async () => {
    db.event.findMany.mockResolvedValueOnce([
      {
        recordingUrl: null,
        tempRecordingUrl: 'https://s3.test/bucket/publications/2026/x.mp4',
      },
    ]);
    expect(await appartenenzaChiave(fornitore, 'publications/2026/x.mp4', EVENTO)).toBe(
      'altrui'
    );
  });

  it('un indirizzo che contiene la chiave ma e’ un altro file non conta', async () => {
    db.event.findMany.mockResolvedValueOnce([
      { recordingUrl: 'https://s3.test/bucket/recordings/sala.mp4.vecchio' },
    ]);
    expect(await appartenenzaChiave(fornitore, 'recordings/sala.mp4', EVENTO)).toBe(
      'dell-evento'
    );
  });

  it('un caricamento che nessun altro evento usa e’ dell’evento', async () => {
    db.recording.findMany.mockResolvedValueOnce([{ eventId: EVENTO }]);
    expect(await appartenenzaChiave(fornitore, 'publications/2026/x.mp4', EVENTO)).toBe(
      'dell-evento'
    );
  });

  it('la firma: solo per i file dell’evento', async () => {
    storage.getRecordingsStorage.mockReturnValue(fornitore);
    const avviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await generateRecordingSasUrl(
        `https://s3.test/bucket/postprod/${ALTRO}/r/mix.mp4`,
        60,
        EVENTO
      )
    ).toBeNull();
    expect(
      await generateRecordingSasUrl(
        `https://s3.test/bucket/postprod/${EVENTO}/r/mix.mp4`,
        60,
        EVENTO
      )
    ).toBe(`https://firmato.test/postprod/${EVENTO}/r/mix.mp4`);
    avviso.mockRestore();
  });

  it('agganciare un file altrui e’ 422; un indirizzo esterno passa com’e’', async () => {
    storage.getRecordingsStorage.mockReturnValue(fornitore);
    await expect(
      assertVideoDellEvento(EVENTO, `https://s3.test/bucket/postprod/${ALTRO}/r/mix.mp4`)
    ).rejects.toMatchObject({ statusCode: 422, code: 'RECORDING_URL_NOT_OWNED' });
    await expect(
      assertVideoDellEvento(EVENTO, 'https://s3.test/bucket/publications/2026/x.mp4')
    ).resolves.toBeUndefined();
    storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => null });
    await expect(
      assertVideoDellEvento(EVENTO, 'https://altro.example.com/v.mp4')
    ).resolves.toBeUndefined();
  });
});
