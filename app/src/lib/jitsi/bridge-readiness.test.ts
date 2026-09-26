import { describe, it, expect } from 'vitest';

import {
  faseRegistratoreStabile,
  leggiFaseRegistratore,
  leggiStatoPonte,
  leggiStatoRegistratore,
} from './bridge-readiness';

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
    expect(leggiStatoRegistratore('failed')).toBeNull();
    expect(leggiStatoRegistratore(undefined)).toBeNull();
  });
});

describe('fase del registratore mostrata a chi modera', () => {
  it('«in avvio» solo quando la sonda lo dice', () => {
    expect(leggiFaseRegistratore('scaling')).toBe('in-avvio');
    expect(leggiFaseRegistratore('ready')).toBe('pronto');
  });

  it('passato il tempo massimo non e’ piu’ «in avvio» ma «non partito»', () => {
    expect(leggiFaseRegistratore('failed')).toBe('non-partito');
  });

  it('storage non configurato e’ una fase sua, non un’attesa', () => {
    expect(leggiFaseRegistratore('unavailable')).toBe('non-configurato');
  });

  it('tutto il resto e’ «non lo so», che non blocca il pulsante', () => {
    for (const muto of ['standby', '', undefined, null, 42, {}]) {
      expect(leggiFaseRegistratore(muto), String(muto)).toBeNull();
    }
  });
});

describe('fase del registratore stabile dentro la stessa attesa', () => {
  it('«non partito» non torna «in avvio» per una risposta discorde', () => {
    expect(faseRegistratoreStabile('non-partito', 'in-avvio')).toBe('non-partito');
  });

  it('l’attesa finisce quando la sonda dice altro', () => {
    expect(faseRegistratoreStabile('non-partito', 'pronto')).toBe('pronto');
    expect(faseRegistratoreStabile('non-partito', 'non-configurato')).toBe('non-configurato');
    expect(faseRegistratoreStabile('non-partito', null)).toBeNull();
    // Dopo, un'attesa nuova si mostra di nuovo «in avvio».
    expect(faseRegistratoreStabile('pronto', 'in-avvio')).toBe('in-avvio');
    expect(faseRegistratoreStabile(null, 'in-avvio')).toBe('in-avvio');
  });

  it('i passaggi in avanti restano quelli della sonda', () => {
    expect(faseRegistratoreStabile('in-avvio', 'non-partito')).toBe('non-partito');
    expect(faseRegistratoreStabile('in-avvio', 'pronto')).toBe('pronto');
  });
});
