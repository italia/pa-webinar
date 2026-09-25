import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchMaterials, materialsListKey } from './material-request';

/**
 * Chi manda il token con l'elenco dei materiali della sala.
 *
 * Il server allarga l'elenco solo per un token moderatore
 * (lib/events/material-access). Il pannello deve mandarlo solo quando conduce:
 * per iscritti e relatori la risposta non cambierebbe, e ogni loro giro di
 * polling costerebbe una lookup nel DB.
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
  it('l’iscritto non manda il proprio token', async () => {
    const key = materialsListKey(SLUG, 'TOKEN_DI_UN_ISCRITTO', false);
    expect(key).toEqual([`/api/events/${SLUG}/materials`, '']);
    await fetchMaterials(key);
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, undefined);
  });

  it('il moderatore lo manda come Bearer', async () => {
    const key = materialsListKey(SLUG, 'TOKEN_MODERATORE', true);
    await fetchMaterials(key);
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, {
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
  });

  it('un moderatore senza token non manda un `Bearer ` vuoto', async () => {
    await fetchMaterials(materialsListKey(SLUG, '', true));
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${SLUG}/materials`, undefined);
  });

  it('il pannello usa questa richiesta e mostra i contrassegni solo al moderatore', () => {
    // Guardia sul sorgente: il componente importa design-react-kit, che sotto
    // vitest non si risolve.
    const src = readFileSync(path.join(__dirname, 'material-panel.tsx'), 'utf8');
    expect(src).toContain('materialsListKey(eventSlug, token, isModerator)');
    expect(src).toContain('fetchMaterials');
    expect(src).toMatch(/isModerator && visibilityLabel\(m\.visibility\)/);
  });
});
