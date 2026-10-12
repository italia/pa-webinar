import { describe, expect, it } from 'vitest';

import { CHIAVI_RINOMINATE, conChiaviRinominate } from './renamed-keys';
import it_ from './messages/it.json';

function leggi(chiave: string): unknown {
  return chiave.split('.').reduce<unknown>(
    (nodo, seg) => (nodo && typeof nodo === 'object' ? (nodo as Record<string, unknown>)[seg] : undefined),
    it_,
  );
}

describe('chiavi rinominate', () => {
  it('la personalizzazione con il nome vecchio vale per quello nuovo', () => {
    expect(conChiaviRinominate({ 'live.recordingConsent': 'Testo dell’ente' })).toMatchObject({
      'waiting.recordingConsentIntro': 'Testo dell’ente',
    });
  });

  it('una personalizzazione del nome nuovo vince su quella del vecchio', () => {
    const out = conChiaviRinominate({
      'live.recordingConsent': 'Vecchio',
      'waiting.recordingConsentIntro': 'Nuovo',
    });
    expect(out['waiting.recordingConsentIntro']).toBe('Nuovo');
  });

  it('un valore vuoto non cancella il testo predefinito', () => {
    expect(conChiaviRinominate({ 'live.recordingConsent': '  ' })['waiting.recordingConsentIntro']).toBeUndefined();
  });

  it('ogni nome nuovo esiste nel catalogo, ogni nome vecchio non piu\'', () => {
    for (const [vecchia, nuova] of Object.entries(CHIAVI_RINOMINATE)) {
      expect(typeof leggi(nuova), nuova).toBe('string');
      expect(leggi(vecchia), vecchia).toBeUndefined();
    }
  });
});
