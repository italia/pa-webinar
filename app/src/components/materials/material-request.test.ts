import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MATERIAL_FILE_MAX_BYTES, MATERIAL_FILE_MIME_TYPES } from '@/lib/validation/materials';

import {
  checkMaterialFile,
  fetchMaterials,
  materialsListKey,
  uploadErrorFromStatus,
  uploadMaterialFile,
} from './material-request';

/**
 * Chi manda il token con l'elenco dei materiali della sala.
 *
 * Il server allarga l'elenco solo per un token moderatore
 * (lib/events/material-access), ma per un evento protetto da password il token
 * dell'iscritto o del relatore è la prova che sta nella stanza: il pannello lo
 * manda sempre, quando c'è.
 */
const SLUG = 'evento-di-prova';
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ materials: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('elenco dei materiali della sala — il token', () => {
  it('l’iscritto manda il proprio token come Bearer', async () => {
    const key = materialsListKey(SLUG, 'TOKEN_DI_UN_ISCRITTO');
    expect(key).toEqual([`/api/events/${SLUG}/materials`, 'TOKEN_DI_UN_ISCRITTO']);
    await fetchMaterials(key);
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, {
      headers: { Authorization: 'Bearer TOKEN_DI_UN_ISCRITTO' },
    });
  });

  it('il moderatore lo manda come Bearer', async () => {
    const key = materialsListKey(SLUG, 'TOKEN_MODERATORE');
    await fetchMaterials(key);
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, {
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
  });

  it('l’ospite, senza token, non manda un `Bearer ` vuoto', async () => {
    await fetchMaterials(materialsListKey(SLUG, ''));
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, undefined);
  });

  it('il pannello usa questa richiesta e mostra i contrassegni solo al moderatore', () => {
    // Guardia sul sorgente: il componente importa design-react-kit, che sotto
    // vitest non si risolve.
    const src = readFileSync(path.join(__dirname, 'material-panel.tsx'), 'utf8');
    expect(src).toContain('materialsListKey(eventSlug, token)');
    expect(src).toContain('fetchMaterials');
    expect(src).toMatch(/isModerator && visibilityLabel\(m\.visibility\)/);
  });
});

describe('caricamento di un file dal pannello', () => {
  const PDF = 'application/pdf';

  it('il controllo nel browser segue la regola del server', () => {
    expect(checkMaterialFile({ type: PDF, size: 1024 }, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES)).toBeNull();
    expect(
      checkMaterialFile({ type: 'image/png', size: 1024 }, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES),
    ).toBe('fileType');
    // Un tipo che il browser non sa riconoscere arriva vuoto: il server lo
    // rifiuterebbe, meglio dirlo prima di spedire.
    expect(checkMaterialFile({ type: '', size: 10 }, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES)).toBe(
      'fileType',
    );
    expect(
      checkMaterialFile({ type: PDF, size: MATERIAL_FILE_MAX_BYTES + 1 }, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES),
    ).toBe('fileTooLarge');
  });

  it('ogni rifiuto del server ha il suo messaggio', () => {
    expect(uploadErrorFromStatus(413, 'PAYLOAD_TOO_LARGE')).toBe('fileTooLarge');
    // Un 413 senza il codice dell'app viene da un proxy con un limite più
    // basso: il limite dei materiali non va citato.
    expect(uploadErrorFromStatus(413)).toBe('fileTooLargeForServer');
    expect(uploadErrorFromStatus(415)).toBe('fileType');
    expect(uploadErrorFromStatus(503)).toBe('uploadUnavailable');
    // Il tetto dei file dell'evento ha il suo codice; un altro 409 no.
    expect(uploadErrorFromStatus(409, 'MATERIALS_QUOTA_EXCEEDED')).toBe('quotaExceeded');
    expect(uploadErrorFromStatus(409)).toBe('generic');
    // Limite per minuto o server già occupato a ricevere: si riprova.
    expect(uploadErrorFromStatus(429, 'RATE_LIMIT')).toBe('uploadBusy');
    expect(uploadErrorFromStatus(403)).toBe('generic');
    expect(uploadErrorFromStatus(500)).toBe('generic');
  });

  it('spedisce file, titolo e descrizione con il token come Bearer', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const file = new File(['%PDF-1.7'], 'slide.pdf', { type: PDF });
    const esito = await uploadMaterialFile(SLUG, 'TOKEN_MODERATORE', {
      file,
      title: 'Slide',
      description: '',
    });
    expect(esito).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/events/${SLUG}/materials/upload`);
    expect(init.method).toBe('POST');
    // Il Content-Type multipart, con il separatore, lo mette il browser.
    expect(init.headers).toEqual({ Authorization: 'Bearer TOKEN_MODERATORE' });
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('slide.pdf');
    expect(form.get('title')).toBe('Slide');
    // Un campo vuoto non parte: il server lo tratterebbe come assente comunque.
    expect(form.has('description')).toBe(false);
  });

  it('un rifiuto del server diventa l’errore da mostrare', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ code: 'PAYLOAD_TOO_LARGE' }),
    });
    const big = new File(['x'], 'a.pdf', { type: PDF });
    expect(await uploadMaterialFile(SLUG, 'T', { file: big, title: '', description: '' })).toBe(
      'fileTooLarge',
    );
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => {
        throw new SyntaxError('<html>');
      },
    });
    expect(await uploadMaterialFile(SLUG, 'T', { file: big, title: '', description: '' })).toBe(
      'fileTooLargeForServer',
    );
    fetchMock.mockResolvedValue({ ok: false, status: 415, json: async () => ({}) });
    const file = new File(['x'], 'a.pdf', { type: PDF });
    expect(await uploadMaterialFile(SLUG, 'T', { file, title: '', description: '' })).toBe('fileType');
  });

  it('il pannello offre il caricamento solo con lo storage e con la stessa regola', () => {
    const src = readFileSync(path.join(__dirname, 'material-panel.tsx'), 'utf8');
    expect(src).toContain('data?.uploadsEnabled === true');
    expect(src).toContain('uploadMaterialFile(eventSlug, token');
    expect(src).toContain('accept={MATERIAL_FILE_MIME_TYPES.join');
    expect(src).toMatch(/checkMaterialFile\(file, MATERIAL_FILE_MIME_TYPES, MATERIAL_FILE_MAX_BYTES\)/);
  });
});
