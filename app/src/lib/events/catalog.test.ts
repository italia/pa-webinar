// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  catalogoDiCreazione,
  classeDaFormato,
  classeDelModello,
  CLASSI_FORMATO,
  tipoDiCatalogo,
  type ModelloPerCatalogo,
} from './catalog';
import { classeFormato, presetDaFormato, type FormatoGuidato } from './guided-format';

const modello = (campi: Partial<ModelloPerCatalogo> = {}): ModelloPerCatalogo => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Modello',
  maxParticipants: 100,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  permissionMatrix: null,
  ...campi,
});

describe('Le famiglie del formato', () => {
  it('sono quelle dello schema, nello stesso ordine', () => {
    const enumerato = Prisma.dmmf.datamodel.enums.find(
      (e) => e.name === 'EventFormatClass'
    );
    expect(enumerato?.values.map((v) => v.name)).toEqual([...CLASSI_FORMATO]);
  });

  it('ogni famiglia del wizard ha la sua', () => {
    expect(classeDaFormato('riunione')).toBe('MEETING');
    expect(classeDaFormato('partecipativo')).toBe('PARTICIPATORY');
    expect(classeDaFormato('pubblico')).toBe('PUBLIC');
  });
});

describe('La famiglia di un modello', () => {
  it('e la stessa delle domande che danno gli stessi valori', () => {
    // I valori di partenza di ogni formato, letti come un modello: la regola
    // del modello deve dire la famiglia delle risposte.
    const persone = ['piccolo', 'medio', 'grande'] as const;
    const voci = ['tutti', 'relatori'] as const;
    for (const p of persone) {
      for (const v of voci) {
        const formato: FormatoGuidato = {
          persone: p,
          voce: v,
          registra: 'no',
          accesso: 'tutti',
        };
        const preset = presetDaFormato(formato, 'x');
        expect(classeDelModello(modello(preset)), `${p}.${v}`).toBe(
          classeDaFormato(classeFormato(formato))
        );
      }
    }
  });

  it('i modelli di sistema finiscono dove ci si aspetta', () => {
    // Riunione di lavoro, Corso di formazione, Webinar pubblico, Conferenza stampa.
    expect(classeDelModello(modello({ maxParticipants: 20 }))).toBe('MEETING');
    expect(classeDelModello(modello({ maxParticipants: 50 }))).toBe('PARTICIPATORY');
    expect(
      classeDelModello(
        modello({
          maxParticipants: 300,
          participantsCanUnmute: false,
          participantsCanStartVideo: false,
        })
      )
    ).toBe('PUBLIC');
    expect(
      classeDelModello(
        modello({
          maxParticipants: 150,
          participantsCanUnmute: false,
          participantsCanStartVideo: false,
        })
      )
    ).toBe('PUBLIC');
  });

  it('su vasta scala e pubblico anche se tutti parlano', () => {
    expect(classeDelModello(modello({ maxParticipants: 500 }))).toBe('PUBLIC');
  });

  it('la matrice dei permessi vince sugli interruttori, come alla creazione', () => {
    const soloRelatori = {
      chat: ['MODERATOR', 'SPEAKER', 'GUEST'],
      qa: ['MODERATOR', 'SPEAKER', 'GUEST'],
      mic: ['MODERATOR', 'SPEAKER'],
      video: ['MODERATOR', 'SPEAKER'],
      share: ['MODERATOR', 'SPEAKER'],
      recording_control: ['MODERATOR'],
    };
    expect(
      classeDelModello(modello({ maxParticipants: 50, permissionMatrix: soloRelatori }))
    ).toBe('PUBLIC');
  });
});

describe('Il catalogo di un evento nuovo', () => {
  it('senza modello e senza formato resta vuoto', () => {
    expect(catalogoDiCreazione(null, undefined)).toEqual({
      templateId: null,
      templateName: null,
      formatClass: null,
    });
  });

  it('il formato dichiarato vince su quello del modello', () => {
    expect(catalogoDiCreazione(modello({ maxParticipants: 20 }), 'PUBLIC')).toEqual({
      templateId: '11111111-1111-4111-8111-111111111111',
      templateName: 'Modello',
      formatClass: 'PUBLIC',
    });
  });

  it('dal solo modello: il suo nome e la sua famiglia', () => {
    expect(
      catalogoDiCreazione(modello({ name: 'Riunione', maxParticipants: 10 }), null)
    ).toEqual({
      templateId: '11111111-1111-4111-8111-111111111111',
      templateName: 'Riunione',
      formatClass: 'MEETING',
    });
  });
});

describe('Il tipo nelle statistiche', () => {
  it('le chiamate rapide e gli archivi importati sono tipi a se', () => {
    expect(tipoDiCatalogo({ eventType: 'INSTANT', formatClass: null })).toBe('INSTANT');
    // Anche con una famiglia scritta a mano: il tipo lo dice eventType.
    expect(tipoDiCatalogo({ eventType: 'INSTANT', formatClass: 'MEETING' })).toBe(
      'INSTANT'
    );
    expect(tipoDiCatalogo({ eventType: 'LEGACY', formatClass: null })).toBe('LEGACY');
  });

  it('un evento senza famiglia non e catalogato', () => {
    expect(tipoDiCatalogo({ eventType: 'SCHEDULED', formatClass: null })).toBe(
      'UNCATALOGED'
    );
    expect(tipoDiCatalogo({ eventType: 'SCHEDULED', formatClass: 'PARTICIPATORY' })).toBe(
      'PARTICIPATORY'
    );
  });
});
