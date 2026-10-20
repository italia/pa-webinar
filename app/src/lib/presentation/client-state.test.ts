import { describe, expect, it } from 'vitest';

import { clampPage, newerPointer, newerState, presentationView } from './client-state';
import type { PresentationState } from './types';

/**
 * Tre fonti in qualsiasi ordine (stato completo, puntatore del canale,
 * risposta alle proprie mutazioni): vince la versione più alta. Il difetto che
 * si evita è la pagina che torna indietro quando una lettura lenta arriva dopo
 * una pagina girata.
 */

const SLUG = 'evento-di-prova';
const M1 = '55555555-5555-4555-8555-555555555555';
const M2 = '66666666-6666-4666-8666-666666666666';

function stato(version: number, materialId: string | null, page = 1): PresentationState {
  return {
    version,
    presentation: materialId
      ? {
          materialId,
          page,
          pageCount: 10,
          title: `Documento ${materialId.slice(0, 2)}`,
          presenterName: null,
          presenterRole: 'MODERATOR',
          yours: false,
          startedAt: '2026-10-08T09:00:00.000Z',
          fileUrl: `/api/events/${SLUG}/presentation/file?m=${materialId}`,
        }
      : null,
  };
}

describe('newerState / newerPointer', () => {
  it('vince la versione più alta, in qualsiasi ordine', () => {
    const vecchio = stato(3, M1, 2);
    const nuovo = stato(4, M1, 3);
    expect(newerState(vecchio, nuovo)).toBe(nuovo);
    expect(newerState(nuovo, vecchio)).toBe(nuovo);
    expect(
      newerPointer(
        { materialId: M1, page: 2, version: 3 },
        { materialId: M1, page: 3, version: 4 }
      )?.page
    ).toBe(3);
    expect(
      newerPointer(
        { materialId: M1, page: 3, version: 4 },
        { materialId: M1, page: 2, version: 3 }
      )?.page
    ).toBe(3);
  });

  it('a parità di versione vince l’ultimo arrivato; un lato assente non conta', () => {
    const a = stato(4, M1, 3);
    const b = stato(4, null);
    expect(newerState(a, b)).toBe(b);
    expect(newerState(null, a)).toBe(a);
    expect(newerState(a, undefined)).toBe(a);
    expect(newerPointer(null, null)).toBeNull();
  });
});

describe('presentationView', () => {
  it('il puntatore del canale più recente sposta la pagina, i dettagli restano', () => {
    const v = presentationView(SLUG, stato(4, M1, 3), {
      materialId: M1,
      page: 5,
      version: 5,
    });
    expect(v).toMatchObject({ version: 5, materialId: M1, page: 5, stale: false });
    expect(v.info).toMatchObject({ title: 'Documento 55', page: 5 });
    expect(v.fileUrl).toBe(`/api/events/${SLUG}/presentation/file?m=${M1}`);
  });

  it('una lettura lenta non riporta indietro la pagina', () => {
    const v = presentationView(SLUG, stato(4, M1, 3), {
      materialId: M1,
      page: 6,
      version: 6,
    });
    expect(v.page).toBe(6);
    const w = presentationView(SLUG, stato(7, M1, 7), {
      materialId: M1,
      page: 6,
      version: 6,
    });
    expect(w.page).toBe(7);
  });

  it('un documento nuovo dal canale: da rileggere, ma il file si può già chiedere', () => {
    const v = presentationView(SLUG, stato(4, M1, 3), {
      materialId: M2,
      page: 1,
      version: 5,
    });
    expect(v).toMatchObject({ materialId: M2, page: 1, stale: true, info: null });
    expect(v.fileUrl).toBe(`/api/events/${SLUG}/presentation/file?m=${M2}`);
  });

  it('stesso documento, altra persona che presenta («Presenta tu»): da rileggere, il documento resta', () => {
    const v = presentationView(SLUG, stato(4, M1, 3), {
      materialId: M1,
      page: 3,
      version: 5,
      startedAt: '2026-10-08T09:30:00.000Z',
    });
    expect(v).toMatchObject({ materialId: M1, page: 3, stale: true, info: null });
    expect(v.fileUrl).toBe(`/api/events/${SLUG}/presentation/file?m=${M1}`);
  });

  it('stesso turno, o un puntatore senza turno (replica precedente): niente da rileggere', () => {
    const turno = '2026-10-08T09:00:00.000Z';
    expect(
      presentationView(SLUG, stato(4, M1, 3), {
        materialId: M1,
        page: 4,
        version: 5,
        startedAt: turno,
      }).stale
    ).toBe(false);
    expect(
      presentationView(SLUG, stato(4, M1, 3), { materialId: M1, page: 4, version: 5 })
        .stale
    ).toBe(false);
  });

  it('chiusa dal canale: niente da mostrare, anche se lo stato completo è indietro', () => {
    const v = presentationView(SLUG, stato(4, M1, 3), {
      materialId: null,
      page: 1,
      version: 5,
    });
    expect(v).toEqual({
      version: 5,
      materialId: null,
      page: 1,
      info: null,
      fileUrl: null,
      stale: false,
    });
  });

  it('niente stato e niente puntatore: nessuna presentazione', () => {
    expect(presentationView(SLUG, null, null)).toMatchObject({
      materialId: null,
      version: 0,
    });
  });
});

describe('clampPage', () => {
  it('resta fra la prima e l’ultima pagina', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(4, 10)).toBe(4);
    expect(clampPage(400, null)).toBe(400);
    expect(clampPage(Number.NaN, 10)).toBe(1);
  });
});
