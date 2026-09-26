import { describe, expect, it } from 'vitest';

import { mapServerIssues, validateStep } from './validation';
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
