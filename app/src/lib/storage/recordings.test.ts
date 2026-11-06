// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getRecordingsStorage: vi.fn((): unknown => null) }));
vi.mock('./index', () => ({
  getRecordingsStorage: storage.getRecordingsStorage,
  recordingsProviderLabel: () => 'not-configured',
}));

import { assertVideoNelloStorage } from './recordings';

const FILE = 'https://storage.example.com/recordings/sala.mp4';
const ESTERNO = 'https://altro.example.com/video.mp4';
const conStorage = () =>
  storage.getRecordingsStorage.mockReturnValue({
    keyFromUrl: (url: string) => (url === FILE ? 'recordings/sala.mp4' : null),
  });

beforeEach(() => storage.getRecordingsStorage.mockReturnValue(null));

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
