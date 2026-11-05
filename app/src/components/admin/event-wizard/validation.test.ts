import { describe, expect, it } from 'vitest';

import { campiMancanti, mapServerIssues, sezioniDegliErrori, validateStep } from './validation';
import type { WizardForm } from './wizard-shell';

function base(overrides: Partial<WizardForm> = {}): WizardForm {
  return {
    title: { it: 'Evento di prova', en: '' },
    description: { it: 'Una descrizione abbastanza lunga.', en: '' },
    startsAt: '2030-01-10T10:00',
    endsAt: '2030-01-10T12:00',
    maxParticipants: 100,
    aiTranslationEnabled: false,
    aiTargetLocales: null,
    ...overrides,
  } as WizardForm;
}

describe('validateStep base — descrizione', () => {
  it('senza descrizione nella lingua predefinita il passo non si supera', () => {
    const errs = validateStep('base', base({ description: { it: '', en: '' } }), 'it');
    expect(errs['description.it']).toBe('required');
  });

  it('usa la lingua predefinita del sito, non l italiano', () => {
    const form = base({
      title: { it: '', en: 'Test event' },
      description: { it: '', en: 'A description long enough.' },
    });
    expect(validateStep('base', form, 'en')).toEqual({});
    expect(validateStep('base', form, 'it')).toMatchObject({
      'title.it': 'required',
      'description.it': 'required',
    });
  });

  it('dieci spazi non sono una descrizione', () => {
    const errs = validateStep('base', base({ description: { it: ' '.repeat(12) } }), 'it');
    expect(errs['description.it']).toBe('required');
  });

  it('dieci caratteri bastano, come per il server', () => {
    const errs = validateStep('base', base({ description: { it: '0123456789' } }), 'it');
    expect(errs).toEqual({});
  });
});

describe('validateStep programme — durate', () => {
  const agenda = [{ key: 'r1', label: 'Intervento', minutes: 'dieci', speakerKey: null }];

  it('una durata che non e una durata ferma il passo del programma, non «Persone»', () => {
    const form = base({ agendaEnabled: true, agenda } as Partial<WizardForm>);
    expect(validateStep('programme', form, 'it')).toEqual({ 'agenda.0.minutes': 'invalid' });
    expect(validateStep('invites', form, 'it')).toEqual({});
  });

  it('ad agenda spenta il programma non si salva, e non ferma niente', () => {
    const form = base({ agendaEnabled: false, agenda } as Partial<WizardForm>);
    expect(validateStep('programme', form, 'it')).toEqual({});
  });
});

describe('mapServerIssues', () => {
  // La risposta 422 reale della creazione senza descrizione.
  const descrizioneMancante = [
    {
      path: ['description'],
      message: 'description.it is required and must be at least 10 characters',
    },
  ];

  it('porta la descrizione mancante sul campo del passo Base', () => {
    expect(mapServerIssues(descrizioneMancante, 'it')).toEqual({
      fieldErrors: { 'description.it': 'server' },
      step: 'base',
      unmapped: [],
    });
  });

  it('se il sito ha un altra lingua predefinita, il messaggio resta nell avviso', () => {
    // Il server esige l'italiano; il passo 1 evidenzia solo la lingua del
    // sito, quindi non c'e' un campo da indicare.
    expect(mapServerIssues(descrizioneMancante, 'en')).toEqual({
      fieldErrors: {},
      step: null,
      unmapped: ['description.it is required and must be at least 10 characters'],
    });
  });

  it('sceglie il primo passo in ordine, non il primo errore', () => {
    const mapped = mapServerIssues(
      [
        { path: ['moderatorEmail'], message: 'Invalid email' },
        { path: ['aiTargetLocales'], message: 'Too long' },
        { path: ['endsAt'], message: 'endsAt must be after startsAt' },
      ],
      'it',
    );
    // Le lingue dell'evento stanno nel passo «Evento», prima di «Quando» e
    // di «Persone».
    expect(mapped.step).toBe('base');
    expect(mapped.fieldErrors).toEqual({
      moderatorEmail: 'server',
      aiTargetLocales: 'server',
      endsAt: 'server',
    });
  });

  it('un campo che nessun passo mostra finisce fra i messaggi', () => {
    const mapped = mapServerIssues(
      [
        { path: ['recurrenceSeriesId'], message: 'series_not_manageable' },
        { path: ['constructor'], message: 'strano' },
      ],
      'it',
    );
    expect(mapped).toEqual({
      fieldErrors: {},
      step: null,
      unmapped: ['series_not_manageable', 'strano'],
    });
  });

  it('accetta il percorso come stringa a punti e ignora un corpo inatteso', () => {
    expect(mapServerIssues([{ path: 'title.it', message: 'x' }], 'it').fieldErrors).toEqual({
      'title.it': 'server',
    });
    expect(mapServerIssues('Validation failed', 'it')).toEqual({
      fieldErrors: {},
      step: null,
      unmapped: [],
    });
  });
});

describe('validateStep base — lingue dell evento', () => {
  const traduce = { recordingEnabled: true, aiTranscriptEnabled: true, aiTranslationEnabled: true };
  it('la traduzione di sottotitoli e sintesi senza lingue si ferma al passo «Evento»', () => {
    expect(validateStep('base', base({ ...traduce, aiTargetLocales: null }), 'it')).toEqual({
      aiTargetLocales: 'required',
    });
    // Un valore vecchio scritto a mano non conta come lingua.
    expect(validateStep('base', base({ ...traduce, aiTargetLocales: 'english' }), 'it')).toEqual({
      aiTargetLocales: 'required',
    });
    expect(validateStep('base', base({ ...traduce, aiTargetLocales: 'en' }), 'it')).toEqual({});
    expect(validateStep('review', base({ ...traduce, aiTargetLocales: null }), 'it')).toEqual({});
  });

  it('senza traduzione (o senza registrazione) le lingue possono mancare: l evento e in una lingua sola', () => {
    expect(validateStep('base', base({ aiTargetLocales: null }), 'it')).toEqual({});
    expect(
      validateStep('base', base({ ...traduce, recordingEnabled: false, aiTargetLocales: null }), 'it')
    ).toEqual({});
  });
});

describe('partecipanti attesi: nei dettagli tecnici', () => {
  it('il passo «Quando» non li controlla piu\', le impostazioni avanzate si\'', () => {
    const f = base({ maxParticipants: 1 });
    expect(validateStep('schedule', f, 'it')).not.toHaveProperty('maxParticipants');
    expect(validateStep('advanced', f, 'it')).toHaveProperty('maxParticipants', 'outOfRange');
    expect(validateStep('advanced', base({ maxParticipants: 6000 }), 'it')).toHaveProperty('maxParticipants');
    expect(validateStep('advanced', base({ maxParticipants: 100 }), 'it')).not.toHaveProperty('maxParticipants');
  });

  it('cio\' che manca porta alle impostazioni avanzate', () => {
    const mancante = campiMancanti(base({ maxParticipants: 1 }), 'it').find((m) => m.key === 'maxParticipants');
    expect(mancante?.step).toBe('advanced');
  });

  it('si aprono tutte le sezioni con un errore', () => {
    expect(sezioniDegliErrori(['maxParticipants'])).toEqual(['technical']);
    expect(sezioniDegliErrori(['dataRetentionDays'])).toEqual(['data']);
    expect(sezioniDegliErrori(['dataRetentionDays', 'maxParticipants'])).toEqual(['data', 'technical']);
    expect(sezioniDegliErrori([])).toEqual(['data']);
  });

  it("un errore del server sui partecipanti porta alle impostazioni avanzate", () => {
    const mapped = mapServerIssues([{ path: ['maxParticipants'], message: 'too big' }], 'it');
    expect(mapped.step).toBe('advanced');
  });
});

