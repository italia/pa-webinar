import { describe, it, expect } from 'vitest';

import { leggiStatoPonte } from './bridge-readiness';

describe('lettura dello stato del ponte video', () => {
  it('«ready» e «scaling» sono le uniche risposte nette', () => {
    expect(leggiStatoPonte('ready')).toBe(true);
    expect(leggiStatoPonte('scaling')).toBe(false);
  });

  it('tutto il resto e’ «non lo so», non «no»', () => {
    // `standby` esce sia quando nessuno ha chiesto un ponte sia quando il
    // conto va in errore; `unavailable` e i valori assenti dicono soltanto che
    // la sonda non sa rispondere. Schiacciarli sul «no» significa chiudere la
    // porta a una conferenza che funziona.
    for (const muto of ['standby', 'unavailable', '', undefined, null, 42, {}]) {
      expect(leggiStatoPonte(muto), String(muto)).toBeNull();
    }
  });
});
