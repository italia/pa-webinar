import { describe, expect, it } from 'vitest';

import { codificaFormato, decodificaFormato, presetDaFormato } from './guided-format';

describe('formato guidato', () => {
  it('quaranta persone, tutti in video, con registrazione: tutto acceso, REC manuale', () => {
    const p = presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'si', accesso: 'tutti' }, 'x');
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
    const p = presetDaFormato({ persone: 'grande', voce: 'relatori', registra: 'si', accesso: 'invitati' }, 'x');
    expect(p).toMatchObject({ accessMode: 'INVITATION', postEventPublic: false });
  });

  it('aperto a tutti su un sito solo su invito: la scelta si fissa sull evento', () => {
    const p = presetDaFormato({ persone: 'medio', voce: 'tutti', registra: 'si', accesso: 'tutti' }, 'x', false);
    expect(p.accessMode).toBe('OPEN');
  });

  it('si ritrova dall indirizzo, e un valore sbagliato non vale', () => {
    const f = { persone: 'piccolo', voce: 'relatori', registra: 'si', accesso: 'invitati' } as const;
    expect(decodificaFormato(codificaFormato(f))).toEqual(f);
    expect(decodificaFormato('enorme.tutti.si.tutti')).toBeNull();
    // Tre risposte non bastano: manca chi partecipa.
    expect(decodificaFormato('medio.tutti.si')).toBeNull();
    expect(decodificaFormato(['medio.tutti.si'])).toBeNull();
    expect(decodificaFormato('constructor')).toBeNull();
  });
});
