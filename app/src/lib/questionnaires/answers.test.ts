import { describe, expect, it } from 'vitest';

import { rispostaVuota } from './answers';

describe('rispostaVuota', () => {
  it('vuota senza testo, scelte o valore; il testo di soli spazi non conta', () => {
    expect(rispostaVuota({})).toBe(true);
    expect(rispostaVuota({ valueText: '   ', valueChoices: [], valueScale: null })).toBe(
      true
    );
  });

  it('piena con un testo, una scelta o un valore, anche zero', () => {
    expect(rispostaVuota({ valueText: 'sì' })).toBe(false);
    expect(rispostaVuota({ valueChoices: [0] })).toBe(false);
    // «No» in una domanda sì/no vale 0: e' una risposta.
    expect(rispostaVuota({ valueScale: 0 })).toBe(false);
  });
});
