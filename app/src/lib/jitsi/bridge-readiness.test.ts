import { describe, it, expect } from 'vitest';

import { leggiStatoPonte, leggiStatoRegistratore } from './bridge-readiness';

describe('lettura dello stato del ponte video', () => {
  it('«ready» e «scaling» sono le uniche risposte nette', () => {
    expect(leggiStatoPonte({ jvbStatus: 'ready' })).toBe(true);
    expect(leggiStatoPonte({ jvbStatus: 'scaling' })).toBe(false);
  });

  it('tutto il resto e’ «non lo so», non «no»', () => {
    // `standby` esce sia quando nessuno ha chiesto un ponte sia quando il
    // conto va in errore; i valori assenti dicono soltanto che la sonda non sa
    // rispondere. Schiacciarli sul «no» chiude la porta a una sala che va.
    for (const muto of ['standby', 'unavailable', '', undefined, null, 42, {}]) {
      expect(leggiStatoPonte({ jvbStatus: muto }), String(muto)).toBeNull();
    }
    expect(leggiStatoPonte(null)).toBeNull();
    expect(leggiStatoPonte(undefined)).toBeNull();
  });

  it('se sul ponte c’e’ gia’ qualcuno, il ponte c’e’', () => {
    // E' il caso che conta davvero: la fotografia delle repliche e' vecchia e
    // dice «si sta accendendo», ma nella sala si sta gia' parlando. Una prova
    // batte una stima, altrimenti si resta fuori da una stanza piena.
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbParticipants: 7 })).toBe(true);
    expect(leggiStatoPonte({ jvbStatus: 'standby', jvbParticipants: 1 })).toBe(true);
  });

  it('zero presenti non e’ una prova di niente', () => {
    // Nessuno dentro e' lo stato normale di una sala che sta per aprire: deve
    // continuare a decidere lo stato dichiarato, non il conteggio.
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbParticipants: 0 })).toBe(false);
    expect(leggiStatoPonte({ jvbStatus: 'standby', jvbParticipants: 0 })).toBeNull();
    expect(leggiStatoPonte({ jvbStatus: 'ready', jvbParticipants: 0 })).toBe(true);
  });

  it('una fotografia dichiarata vecchia non decide niente', () => {
    // La sonda stessa dice quando il suo dato e' scaduto. Da li' in poi non
    // vale ne' il no («si sta accendendo» rimasto appeso a un lavoro fermo)
    // ne' il si' (presenti sopravvissuti a una conferenza finita): l'unica
    // risposta onesta e' «non lo so», che lascia entrare.
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbStale: true })).toBeNull();
    expect(leggiStatoPonte({ jvbStatus: 'ready', jvbStale: true })).toBeNull();
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbParticipants: 7, jvbStale: true })).toBeNull();
    // Fresca, decide come sempre.
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbStale: false })).toBe(false);
  });

  it('un conteggio che non e’ un numero non conta come prova', () => {
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbParticipants: null })).toBe(false);
    expect(leggiStatoPonte({ jvbStatus: 'scaling', jvbParticipants: '9' })).toBe(false);
  });
});

describe('lettura dello stato del registratore', () => {
  it('resta ai due valori netti: nessuno «passa da Jibri»', () => {
    expect(leggiStatoRegistratore('ready')).toBe(true);
    expect(leggiStatoRegistratore('scaling')).toBe(false);
    expect(leggiStatoRegistratore('unavailable')).toBeNull();
    expect(leggiStatoRegistratore(undefined)).toBeNull();
  });
});
