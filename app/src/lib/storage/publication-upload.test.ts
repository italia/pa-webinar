import { describe, it, expect } from 'vitest';

import {
  PUBLICATION_OBJECT_NAME_RE,
  planPublicationObject,
} from './publication-upload';

const UUID = '0b8e7a52-3c1d-4f7e-9a3b-5d6e7f8a9b0c';
const at = { now: new Date('2026-03-01T00:00:00Z'), uuid: UUID };

describe('planPublicationObject', () => {
  it.each([
    ['riunione.mp4', 'video/mp4', 'mp4', 'video/mp4'],
    ['clip.WEBM', 'video/webm', 'webm', 'video/webm'],
    ['export.mov', 'video/quicktime', 'mov', 'video/quicktime'],
    ['export.m4v', 'video/x-m4v', 'm4v', 'video/x-m4v'],
  ])('%s (%s) → .%s, %s', (name, declared, ext, type) => {
    expect(planPublicationObject(name, declared, at)).toEqual({
      objectName: `publications/2026/${UUID}.${ext}`,
      contentType: type,
    });
  });

  it('senza tipo dal browser usa quello dell’estensione', () => {
    expect(planPublicationObject('export.mov', undefined, at).contentType).toBe('video/quicktime');
    expect(planPublicationObject('export.mov', '', at).contentType).toBe('video/quicktime');
  });

  it('un tipo fuori elenco non passa: vale l’estensione', () => {
    expect(planPublicationObject('pagina.webm', 'text/html', at).contentType).toBe('video/webm');
  });

  it('estensione sconosciuta o assente: mp4', () => {
    expect(planPublicationObject('file.exe', 'application/x-msdownload', at)).toEqual({
      objectName: `publications/2026/${UUID}.mp4`,
      contentType: 'video/mp4',
    });
    expect(planPublicationObject('senza-estensione', undefined, at).objectName).toMatch(/\.mp4$/);
    expect(planPublicationObject('trucco.constructor', undefined, at).objectName).toMatch(/\.mp4$/);
  });

  it('il nome originale non entra nella chiave', () => {
    const { objectName } = planPublicationObject('../../altro/segreto.mp4', 'video/mp4', at);
    expect(objectName).toBe(`publications/2026/${UUID}.mp4`);
  });

  it('senza opzioni genera un nome valido', () => {
    expect(planPublicationObject('a.mp4').objectName).toMatch(PUBLICATION_OBJECT_NAME_RE);
  });
});

describe('PUBLICATION_OBJECT_NAME_RE', () => {
  it('accetta solo i nomi creati da planPublicationObject', () => {
    expect(PUBLICATION_OBJECT_NAME_RE.test(`publications/2026/${UUID}.mov`)).toBe(true);
    for (const bad of [
      `recordings/publications/2026/${UUID}.mp4`,
      `publications/2026/${UUID}.mp4/../x`,
      `publications/2026/${UUID}.exe`,
      'publications/2026/not-a-uuid.mp4',
      `postprod/${UUID}.mp4`,
    ]) {
      expect(PUBLICATION_OBJECT_NAME_RE.test(bad)).toBe(false);
    }
  });
});
