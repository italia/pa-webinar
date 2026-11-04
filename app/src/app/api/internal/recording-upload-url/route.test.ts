// @vitest-environment node
/**
 * Questa rotta consegna un permesso di scrittura sullo storage: lo ottiene solo
 * chi ha la chiave interna, vale per un solo file nella cartella delle
 * registrazioni e per trenta minuti. Nei casi rifiutati l'unica cosa che conta
 * e' che lo storage non venga mai interpellato.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { provider, magazzino } = vi.hoisted(() => {
  const provider = { getUploadUrl: vi.fn() };
  return { provider, magazzino: { configurato: true } };
});

vi.mock('@/lib/storage/index', () => ({
  getRecordingsStorage: () => (magazzino.configurato ? provider : null),
  recordingsProviderLabel: () => 'di prova',
}));

import { POST } from './route';

const CHIAVE = 'chiave-interna-di-prova';
const NOME = 'call-stanza_2026-11-04_10-00.mp4';
const CORPO = { roomName: 'call-stanza', filename: NOME };
const URL_FIRMATO = 'https://storage.example.com/recordings/file.mp4?firma=permesso';
const URL_PUBBLICO = 'https://storage.example.com/recordings/file.mp4';
const log = vi.spyOn(console, 'log');

function chiedi(
  corpo: unknown,
  headers: Record<string, string> = { 'x-api-key': CHIAVE }
) {
  const request = new Request('http://localhost:3000/api/internal/recording-upload-url', {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  log.mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.CRON_API_KEY = CHIAVE;
  magazzino.configurato = true;
  provider.getUploadUrl.mockResolvedValue({
    uploadUrl: URL_FIRMATO,
    publicUrl: URL_PUBBLICO,
  });
});

describe('chi puo’ chiedere', () => {
  it('senza la chiave giusta non si firma niente', async () => {
    expect((await chiedi(CORPO, {})).status).toBe(401);
    expect((await chiedi(CORPO, { 'x-api-key': 'sbagliata' })).status).toBe(401);
    expect((await chiedi(CORPO, { 'x-api-key': `${CHIAVE}x` })).status).toBe(401);
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });

  it('la chiave vale solo nel suo header', async () => {
    expect((await chiedi(CORPO, { authorization: `Bearer ${CHIAVE}` })).status).toBe(401);
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });

  it('senza CRON_API_KEY configurata non passa nessuno, nemmeno con la chiave vuota', async () => {
    delete process.env.CRON_API_KEY;
    expect((await chiedi(CORPO, { 'x-api-key': '' })).status).toBe(401);
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });
});

describe('il nome del file', () => {
  it('senza stanza o senza nome e’ 422', async () => {
    for (const corpo of [
      {},
      { roomName: 'call-stanza' },
      { filename: NOME },
      { roomName: '', filename: NOME },
      { roomName: 'call-stanza', filename: '' },
      { roomName: 42, filename: NOME },
      { roomName: 'call-stanza', filename: ['file.mp4'] },
    ]) {
      expect((await chiedi(corpo)).status).toBe(422);
    }
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });

  it('un nome con un percorso non si firma', async () => {
    for (const filename of [
      '../pubblicazioni/file.mp4',
      'cartella/file.mp4',
      '/recordings/file.mp4',
      'recordings/file.mp4',
      '..',
      '.',
      'file..mp4',
      'a\nb.mp4',
      'a\\b.mp4',
    ]) {
      expect((await chiedi({ ...CORPO, filename })).status).toBe(422);
    }
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await chiedi(null)).status).toBe(422);
    expect((await chiedi('non json')).status).toBe(400);
    expect(provider.getUploadUrl).not.toHaveBeenCalled();
  });
});

describe('il permesso di scrittura', () => {
  it('vale per quel file, nella cartella delle registrazioni, per trenta minuti', async () => {
    const r = await chiedi(CORPO);
    expect(r.status).toBe(200);
    expect(provider.getUploadUrl).toHaveBeenCalledTimes(1);
    expect(provider.getUploadUrl).toHaveBeenCalledWith(`recordings/${NOME}`, {
      expiresInMinutes: 30,
      contentType: 'video/mp4',
    });
    await expect(r.json()).resolves.toEqual({
      uploadUrl: URL_FIRMATO,
      recordingUrl: URL_PUBBLICO,
      expiresInMinutes: 30,
    });
  });

  it('l’indirizzo da conservare non porta la firma', async () => {
    const corpo = (await (await chiedi(CORPO)).json()) as { recordingUrl: string };
    expect(corpo.recordingUrl).not.toContain('firma');
  });

  it('il permesso non finisce nei log', async () => {
    await chiedi(CORPO);
    const scritto = JSON.stringify(log.mock.calls);
    expect(scritto).not.toContain('firma=permesso');
    expect(scritto).not.toContain(CHIAVE);
  });

  it('senza storage configurato e’ 503, non un guasto', async () => {
    magazzino.configurato = false;
    const r = await chiedi(CORPO);
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({
      error: 'recording storage is not configured',
    });
  });

  it('un guasto dello storage non racconta le sue credenziali', async () => {
    provider.getUploadUrl.mockRejectedValue(
      new Error('connessione rifiutata: AccountKey=credenziale-dello-storage')
    );
    const r = await chiedi(CORPO);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('credenziale-dello-storage');
  });
});
