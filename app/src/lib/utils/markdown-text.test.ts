import { describe, expect, it } from 'vitest';

import { markdownToPlainText } from './markdown-text';

describe('markdownToPlainText', () => {
  it('toglie grassetto, corsivo e titoli', () => {
    expect(markdownToPlainText('## Programma\n\nCon **Relatore 1** e _Relatore 2_.')).toBe(
      'Programma. Con Relatore 1 e Relatore 2.',
    );
  });

  it('di un link tiene il testo, non l’indirizzo', () => {
    expect(markdownToPlainText('Vedi [il bando](https://example.org/bando) entro venerdì.')).toBe(
      'Vedi il bando entro venerdì.',
    );
  });

  it('gli elenchi diventano una riga, con le voci separate', () => {
    expect(markdownToPlainText('Temi:\n\n- riuso\n- open source\n- accessibilità')).toBe(
      'Temi: riuso, open source, accessibilità',
    );
  });

  it('un elenco annidato resta nel suo elenco', () => {
    expect(markdownToPlainText('- a\n  - a1\n  - a2\n- b\n\nDopo')).toBe('a, a1, a2, b. Dopo');
  });

  it('un testo semplice resta com’è, senza punti aggiunti', () => {
    expect(markdownToPlainText('Evento sulla digitalizzazione')).toBe('Evento sulla digitalizzazione');
  });

  it('di un’immagine resta il testo alternativo, dell’HTML il testo', () => {
    expect(markdownToPlainText('![Logo dell’ente](/logo.png) <b>Diretta</b> &amp; replica')).toBe(
      'Logo dell’ente Diretta & replica',
    );
  });

  it('script e stili scritti a mano non diventano testo', () => {
    expect(markdownToPlainText('Testo con <script>alert(1)</script> fine <style>.x{}</style>')).toBe(
      'Testo con fine',
    );
  });

  it('le entità diventano i loro caratteri', () => {
    expect(markdownToPlainText('Pausa caff&egrave; &#8211; l&rsquo;ente &#x2019;')).toBe(
      'Pausa caffè – l’ente ’',
    );
  });

  it('vuoto resta vuoto', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText(null)).toBe('');
  });
});

describe('markdownToPlainText per esteso', () => {
  it('tiene paragrafi, a capo e voci d’elenco su righe proprie', () => {
    expect(
      markdownToPlainText(
        '## Programma\n\nOre 10 Saluti\nOre 11 Intervento\n\nTemi:\n\n- riuso\n- open source\n\n1. Apertura\n2. Chiusura',
        { paragrafi: true },
      ),
    ).toBe(
      'Programma\n\nOre 10 Saluti\nOre 11 Intervento\n\nTemi:\n\n- riuso\n- open source\n\n1. Apertura\n2. Chiusura',
    );
  });
});
