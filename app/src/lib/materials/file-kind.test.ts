import { describe, expect, it } from 'vitest';

import { materialHost, materialKind, titleFromFileName } from './file-kind';

describe('materialKind', () => {
  it('un link resta un link, qualunque sia l’indirizzo', () => {
    expect(materialKind({ type: 'LINK', url: 'https://example.org/slide.pdf' })).toBe('link');
  });

  it('per un file decide il tipo MIME verificato dal server', () => {
    expect(materialKind({ type: 'FILE', mimeType: 'application/pdf' })).toBe('pdf');
    expect(
      materialKind({
        type: 'FILE',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe('slides');
    expect(materialKind({ type: 'FILE', mimeType: 'TEXT/PLAIN' })).toBe('text');
  });

  it('senza tipo MIME decide l’estensione, del nome o del percorso (non della query)', () => {
    expect(materialKind({ type: 'FILE', fileName: 'Bilancio 2026.XLSX' })).toBe('sheet');
    expect(
      materialKind({ type: 'FILE', url: 'https://blob.example/x/relazione.docx?sig=abc.pdf' }),
    ).toBe('doc');
  });

  it('un file sconosciuto è un file generico', () => {
    expect(materialKind({ type: 'FILE', url: 'https://blob.example/x/archivio' })).toBe('file');
  });
});

describe('titleFromFileName', () => {
  it('toglie l’estensione e i trattini bassi', () => {
    expect(titleFromFileName('slide_intervento_finale.pptx')).toBe('slide intervento finale');
    expect(titleFromFileName('Programma.pdf')).toBe('Programma');
  });
});

describe('materialHost', () => {
  it('il nome del sito, senza www né percorso', () => {
    expect(materialHost('https://www.example.org/slide.pdf?x=1')).toBe('example.org');
    expect(materialHost('http://docs.example.gov.it:8443/a')).toBe('docs.example.gov.it');
  });

  it('un indirizzo illeggibile non ha sito', () => {
    expect(materialHost('non è un indirizzo')).toBeNull();
  });
});
