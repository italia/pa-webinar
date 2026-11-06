// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { elencoPredefinito } from '@/lib/live/participant-list';

import {
  FORMATO_PREDEFINITO,
  classeFormato,
  codificaFormato,
  decodificaFormato,
  formatoConAccesso,
  formatoPossibile,
  formatoPredefinito,
  presetDaFormato,
  registrazioneProponibile,
  registrazioneProposta,
  trascriveSenzaRegistrare,
  type FormatoAccesso,
  type FormatoGuidato,
  type FormatoPersone,
  type FormatoRegistra,
  type FormatoVoce,
} from './guided-format';

const PERSONE: FormatoPersone[] = ['piccolo', 'medio', 'grande'];
const VOCI: FormatoVoce[] = ['tutti', 'relatori'];
const REGISTRA: FormatoRegistra[] = ['no', 'riservata', 'pubblica'];
const ACCESSI: FormatoAccesso[] = ['tutti', 'invitati'];

/** Tutti i 36 formati che le quattro domande possono produrre. */
const FORMATI: FormatoGuidato[] = PERSONE.flatMap((persone) =>
  VOCI.flatMap((voce) =>
    REGISTRA.flatMap((registra) => ACCESSI.map((accesso) => ({ persone, voce, registra, accesso }))),
  ),
);

describe('formato guidato', () => {
  it('quaranta persone, tutti in video, con registrazione: tutto acceso, REC manuale', () => {
    const p = presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' }, 'x');
    expect(p).toMatchObject({
      chatEnabled: true,
      qaEnabled: true,
      agendaEnabled: true,
      wordCloudEnabled: true,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
      maxParticipants: 100,
      recordingEnabled: true,
      autoStartRecording: false,
      aiTranscriptEnabled: true,
      aiSummaryEnabled: true,
      aiTranslationEnabled: true,
      // Coincide con il sito aperto: l'evento continua a seguirlo.
      accessMode: null,
      postEventPublic: true,
    });
  });

  it('solo i relatori parlano: il pubblico scrive', () => {
    const p = presetDaFormato({ persone: 'grande', voce: 'relatori', registra: 'no', accesso: 'tutti' }, 'x');
    expect(p).toMatchObject({
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      chatEnabled: true,
      qaEnabled: true,
      maxParticipants: 300,
      recordingEnabled: false,
      aiTranscriptEnabled: false,
    });
  });

  it('una riunione fra pochi non ha la pagina pubblica dopo', () => {
    expect(presetDaFormato({ persone: 'piccolo', voce: 'tutti', registra: 'no', accesso: 'tutti' }, 'x').postEventPublic).toBe(false);
  });

  it('solo su invito: si iscrive solo chi e invitato, e la pagina dopo non e pubblica', () => {
    const p = presetDaFormato({ persone: 'grande', voce: 'relatori', registra: 'riservata', accesso: 'invitati' }, 'x');
    expect(p).toMatchObject({ accessMode: 'INVITATION', postEventPublic: false });
  });

  it('aperto a tutti su un sito solo su invito: la scelta si fissa sull evento', () => {
    const p = presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' }, 'x', false);
    expect(p.accessMode).toBe('OPEN');
  });

  it('si ritrova dall indirizzo, e un valore sbagliato non vale', () => {
    for (const f of FORMATI) {
      expect(decodificaFormato(codificaFormato(f))).toEqual(f);
    }
    expect(decodificaFormato('enorme.tutti.pubblica.tutti')).toBeNull();
    expect(decodificaFormato('medio.tutti.forse.tutti')).toBeNull();
    // Tre risposte non bastano: manca chi partecipa.
    expect(decodificaFormato('medio.tutti.pubblica')).toBeNull();
    expect(decodificaFormato(['medio.tutti.pubblica'])).toBeNull();
    expect(decodificaFormato('constructor')).toBeNull();
  });

  it('il codice non produce mai il vecchio valore', () => {
    for (const f of FORMATI) expect(codificaFormato(f)).not.toContain('.si.');
  });
});

describe('gli indirizzi salvati con la vecchia risposta', () => {
  const registraDi = (indirizzo: string) => decodificaFormato(indirizzo)?.registra;

  it('una riunione fra pochi diventa riservata', () => {
    expect(registraDi('piccolo.tutti.si.tutti')).toBe('riservata');
  });

  it('un evento su invito diventa riservata, per ogni formato', () => {
    for (const persone of PERSONE) {
      for (const voce of VOCI) {
        expect(registraDi(`${persone}.${voce}.si.invitati`)).toBe('riservata');
      }
    }
  });

  it('il resto diventa pubblica', () => {
    expect(registraDi('medio.tutti.si.tutti')).toBe('pubblica');
    expect(registraDi('grande.tutti.si.tutti')).toBe('pubblica');
    expect(registraDi('piccolo.relatori.si.tutti')).toBe('pubblica');
    expect(registraDi('medio.relatori.si.tutti')).toBe('pubblica');
    expect(registraDi('grande.relatori.si.tutti')).toBe('pubblica');
  });

  it('le altre risposte restano quelle dell indirizzo', () => {
    expect(decodificaFormato('piccolo.relatori.si.invitati')).toEqual({
      persone: 'piccolo',
      voce: 'relatori',
      registra: 'riservata',
      accesso: 'invitati',
    });
    expect(registraDi('medio.tutti.no.tutti')).toBe('no');
  });

  it('un valore sconosciuto non diventa una risposta', () => {
    expect(decodificaFormato('enorme.tutti.si.tutti')).toBeNull();
    expect(decodificaFormato('medio.tutti.si')).toBeNull();
    expect(decodificaFormato('medio.tutti.si.tutti')).toEqual({
      ...FORMATO_PREDEFINITO,
      registra: 'pubblica',
    });
  });
});

describe('la famiglia del formato', () => {
  it('tutti + piccolo e tutti + medio: riunione e partecipativo', () => {
    expect(classeFormato({ persone: 'piccolo', voce: 'tutti' })).toBe('riunione');
    expect(classeFormato({ persone: 'medio', voce: 'tutti' })).toBe('partecipativo');
  });

  it('solo i relatori, o una grande platea: pubblico', () => {
    expect(classeFormato({ persone: 'grande', voce: 'tutti' })).toBe('pubblico');
    for (const persone of PERSONE) {
      expect(classeFormato({ persone, voce: 'relatori' })).toBe('pubblico');
    }
  });

  it('l elenco dei partecipanti si vede ovunque, tranne negli eventi pubblici', () => {
    for (const f of FORMATI) {
      expect(elencoPredefinito(presetDaFormato(f, 'x'))).toBe(classeFormato(f) !== 'pubblico');
    }
  });
});

describe('i valori di partenza per famiglia', () => {
  const riunione: FormatoGuidato = { persone: 'piccolo', voce: 'tutti', registra: 'riservata', accesso: 'tutti' };
  const partecipativo: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' };
  const pubblico: FormatoGuidato = { persone: 'grande', voce: 'relatori', registra: 'pubblica', accesso: 'tutti' };

  it('riunione: nomi reali, domande non pubblicate, rubrica non proposta', () => {
    expect(presetDaFormato(riunione, 'x')).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      audienceAnonymous: false,
      postEventShowQA: false,
      offerAddressBook: false,
      hostsAlwaysRecorded: false,
    });
  });

  it('partecipativo: nomi reali, testo delle domande, rubrica proposta', () => {
    expect(presetDaFormato(partecipativo, 'x')).toMatchObject({
      recordingDestination: 'PUBLIC',
      audienceAnonymous: false,
      postEventShowQA: true,
      offerAddressBook: true,
      hostsAlwaysRecorded: false,
    });
  });

  it('pubblico: pseudonimi, testo delle domande, rubrica proposta', () => {
    expect(presetDaFormato(pubblico, 'x')).toMatchObject({
      recordingDestination: 'PUBLIC',
      audienceAnonymous: true,
      postEventShowQA: true,
      offerAddressBook: true,
      hostsAlwaysRecorded: false,
    });
  });

  it('i valori dipendono dalla famiglia, non da come si registra o da chi partecipa', () => {
    for (const f of FORMATI) {
      const classe = classeFormato(f);
      const p = presetDaFormato(f, 'x');
      expect(p.audienceAnonymous).toBe(classe === 'pubblico');
      expect(p.postEventShowQA).toBe(classe !== 'riunione');
      expect(p.offerAddressBook).toBe(classe !== 'riunione');
    }
  });

  it('chi conduce sceglie come tutti, in ogni formato', () => {
    for (const f of FORMATI) expect(presetDaFormato(f, 'x').hostsAlwaysRecorded).toBe(false);
  });

  it('senza registrazione nulla di legato alla registrazione si accende', () => {
    for (const f of FORMATI.filter((x) => x.registra === 'no')) {
      expect(presetDaFormato(f, 'x')).toMatchObject({
        recordingEnabled: false,
        recordingDestination: null,
        hostsAlwaysRecorded: false,
        captionsTranscriptEnabled: false,
        aiTranscriptEnabled: false,
        multitrackRecordingEnabled: false,
      });
    }
  });

  it('la risposta decide la destinazione, anche contro quella proposta', () => {
    for (const f of FORMATI) {
      const { recordingDestination } = presetDaFormato(f, 'x');
      expect(recordingDestination).toBe(
        { no: null, riservata: 'REGISTRANTS', pubblica: 'PUBLIC' }[f.registra],
      );
    }
  });
});

describe('la pagina dopo l evento', () => {
  it('un video pubblico la apre, anche in una riunione o su invito', () => {
    for (const f of FORMATI.filter((x) => x.registra === 'pubblica')) {
      expect(presetDaFormato(f, 'x').postEventPublic).toBe(true);
    }
  });

  it('una riunione riservata o su invito resta privata: il video lo vede chi e iscritto', () => {
    expect(
      presetDaFormato({ persone: 'piccolo', voce: 'tutti', registra: 'riservata', accesso: 'tutti' }, 'x').postEventPublic,
    ).toBe(false);
    expect(
      presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'riservata', accesso: 'invitati' }, 'x').postEventPublic,
    ).toBe(false);
  });

  it('una registrazione riservata non chiude la pagina di un evento aperto', () => {
    expect(
      presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'riservata', accesso: 'tutti' }, 'x').postEventPublic,
    ).toBe(true);
  });
});

describe('la risposta proposta sulla registrazione', () => {
  it('riservata in una riunione e su invito, pubblica altrimenti', () => {
    for (const f of FORMATI) {
      const riservata = f.accesso === 'invitati' || classeFormato(f) === 'riunione';
      expect(registrazioneProposta(f)).toBe(riservata ? 'riservata' : 'pubblica');
    }
  });

  it('il formato di partenza segue chi partecipa', () => {
    expect(formatoPredefinito('tutti')).toEqual(FORMATO_PREDEFINITO);
    expect(formatoPredefinito('invitati')).toEqual({
      ...FORMATO_PREDEFINITO,
      registra: 'riservata',
      accesso: 'invitati',
    });
  });
});

describe('chi partecipa cambia dopo le domande', () => {
  it('passando agli inviti un video pubblico torna riservato, e la pagina resta privata', () => {
    const f: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' };
    const dopo = formatoConAccesso(f, 'invitati');
    expect(dopo).toEqual({ ...f, registra: 'riservata', accesso: 'invitati' });
    expect(presetDaFormato(dopo, 'x')).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      postEventPublic: false,
    });
  });

  it('vale per ogni formato: dagli inviti non esce mai un video pubblico nuovo', () => {
    for (const f of FORMATI.filter((x) => x.accesso === 'tutti')) {
      const dopo = formatoConAccesso(f, 'invitati');
      expect(dopo.accesso).toBe('invitati');
      expect(dopo.registra).toBe(f.registra === 'no' ? 'no' : 'riservata');
    }
  });

  it('una scelta pubblica gia su invito resta, se chi partecipa non cambia', () => {
    const f: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'invitati' };
    expect(formatoConAccesso(f, 'invitati')).toEqual(f);
  });

  it('il passaggio inverso non allarga: una risposta riservata non diventa pubblica', () => {
    const f: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'riservata', accesso: 'invitati' };
    expect(formatoConAccesso(f, 'tutti')).toEqual({ ...f, accesso: 'tutti' });
  });

  it('il «no» resta «no»', () => {
    const f: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'no', accesso: 'tutti' };
    expect(formatoConAccesso(f, 'invitati')).toEqual({ ...f, accesso: 'invitati' });
  });
});

describe('formatoPossibile', () => {
  it('dove non si puo registrare esce sempre senza registrazione', () => {
    for (const f of FORMATI) {
      expect(formatoPossibile(f, false).registra).toBe('no');
      expect(formatoPossibile(f, true)).toEqual(f);
    }
  });

  it('senza il video della sala un video pubblico diventa riservato, il resto no', () => {
    for (const f of FORMATI) {
      const atteso = f.registra === 'pubblica' ? { ...f, registra: 'riservata' } : f;
      expect(formatoPossibile(f, true, false)).toEqual(atteso);
      expect(formatoPossibile(f, false, false).registra).toBe('no');
    }
  });
});

describe('presetDaFormato: l\'elenco dei partecipanti', () => {
  const elenco = (persone: 'piccolo' | 'medio' | 'grande', voce: 'tutti' | 'relatori') =>
    elencoPredefinito(presetDaFormato({ persone, voce, registra: 'no', accesso: 'tutti' }, 'Prova'));

  it('si vede tra chi si conosce, non su vasta scala ne\' dove parlano solo i relatori', () => {
    expect(elenco('piccolo', 'tutti')).toBe(true);
    expect(elenco('medio', 'tutti')).toBe(true);
    expect(elenco('grande', 'tutti')).toBe(false);
    expect(elenco('medio', 'relatori')).toBe(false);
  });
});

describe('trascriveSenzaRegistrare', () => {
  it('senza video e senza AI restano i sottotitoli, se ci sono', () => {
    expect(trascriveSenzaRegistrare(true, 'assente', false, true)).toBe(true);
    expect(trascriveSenzaRegistrare(true, 'assente', false, false)).toBe(false);
  });

  it('dove la domanda si fa decide la risposta', () => {
    expect(trascriveSenzaRegistrare(true, 'fissa', false, true)).toBe(false);
    expect(trascriveSenzaRegistrare(true, 'assente', true, true)).toBe(false);
  });

  it('dove non si puo registrare non cambia nulla', () => {
    expect(trascriveSenzaRegistrare(false, 'assente', false, true)).toBe(false);
  });

  it('il preset la tiene anche senza registrazione', () => {
    const f: FormatoGuidato = { persone: 'medio', voce: 'tutti', registra: 'no', accesso: 'tutti' };
    expect(presetDaFormato(f, 'x', true, true)).toMatchObject({
      recordingEnabled: false,
      captionsTranscriptEnabled: true,
    });
    expect(presetDaFormato(f, 'x').captionsTranscriptEnabled).toBe(false);
  });
});

describe('registrazioneProponibile', () => {
  it('con il video della sala si propone, anche senza AI', () => {
    expect(registrazioneProponibile(true, 'fissa', false)).toBe(true);
    expect(registrazioneProponibile(true, undefined, false)).toBe(true);
  });

  it('senza video restano le tracce, che vogliono la pipeline AI', () => {
    expect(registrazioneProponibile(true, 'assente', true)).toBe(true);
    expect(registrazioneProponibile(true, 'assente', false)).toBe(false);
  });

  it('dove non si puo registrare non si propone mai', () => {
    expect(registrazioneProponibile(false, 'fissa', true)).toBe(false);
  });
});
