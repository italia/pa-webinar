import { describe, expect, it } from 'vitest';

import { csvCell, csvText } from './csv';

describe('csvCell', () => {
  it('neutralizza i valori che un foglio di calcolo leggerebbe come formula', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+39 06 1234')).toBe("'+39 06 1234");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@nome')).toBe("'@nome");
  });

  it('racchiude fra virgolette solo le celle con separatore, virgolette o a capo', () => {
    expect(csvCell('Comune di Esempio')).toBe('Comune di Esempio');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('riga\naltra')).toBe('"riga\naltra"');
  });
});

describe('csvText', () => {
  it('unisce le celle con il punto e virgola e le righe con CRLF', () => {
    expect(csvText([['Nome', 'Ente'], ['Ada', '=1+1']])).toBe("Nome;Ente\r\nAda;'=1+1\r\n");
  });
});
