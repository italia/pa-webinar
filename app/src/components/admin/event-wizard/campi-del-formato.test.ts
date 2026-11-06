// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  campiDaEvento,
  campiDaModello,
  campiDaSalvare,
  destinazioneDopoIlSalvataggio,
  videoDaDestinare,
  type CampiDelFormato,
} from './campi-del-formato';
import type { WizardForm, WizardTemplatePreset } from './wizard-shell';

/**
 * Da dove partono i valori del formato, e cosa ne manda il salvataggio: un valore
 * di troppo farebbe rifiutare il salvataggio, o rimetterebbe un valore vecchio.
 */
const salvati: CampiDelFormato = {
  recordingDestination: 'REGISTRANTS',
  offerAddressBook: true,
  audienceAnonymous: false,
  hostsAlwaysRecorded: false,
  postEventShowQA: true,
};
const modulo = (patch: Partial<WizardForm> = {}) =>
  ({ recordingEnabled: true, ...salvati, ...patch }) as WizardForm;

describe('campiDaModello', () => {
  const modello = {
    recordingDestination: 'PUBLIC',
    offerAddressBook: false,
    audienceAnonymous: true,
    hostsAlwaysRecorded: true,
    postEventShowQA: false,
  } as WizardTemplatePreset;

  it('prende i valori del modello', () => {
    expect(campiDaModello(modello, true)).toEqual({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });
  });

  it('senza registrazione chi conduce resta com e, la destinazione del modello resta', () => {
    expect(campiDaModello(modello, false)).toMatchObject({
      recordingDestination: 'PUBLIC',
      hostsAlwaysRecorded: false,
    });
  });

  it('un modello muto vale i default delle colonne, e riservata se registra', () => {
    expect(campiDaModello(null, true)).toEqual({
      recordingDestination: 'REGISTRANTS',
      offerAddressBook: true,
      audienceAnonymous: false,
      hostsAlwaysRecorded: false,
      postEventShowQA: true,
    });
    expect(campiDaModello(undefined, false).recordingDestination).toBeNull();
    expect(
      campiDaModello({ recordingDestination: null } as WizardTemplatePreset, true)
        .recordingDestination
    ).toBe('REGISTRANTS');
  });
});

describe('dove non c e un video da destinare', () => {
  it('lo dice la voce assente', () => {
    expect(videoDaDestinare('assente')).toBe(false);
    expect(videoDaDestinare('fissa')).toBe(true);
    expect(videoDaDestinare('rimovibile')).toBe(true);
    expect(videoDaDestinare(undefined)).toBe(true);
  });

  it('non parte una destinazione, nemmeno quella del modello', () => {
    expect(campiDaModello(null, true, false).recordingDestination).toBeNull();
    expect(
      campiDaModello(
        { recordingDestination: 'REGISTRANTS' } as WizardTemplatePreset,
        true,
        false
      ).recordingDestination
    ).toBeNull();
  });

  it('il resto dei valori non cambia', () => {
    expect(
      campiDaModello({ hostsAlwaysRecorded: true } as WizardTemplatePreset, true, false)
        .hostsAlwaysRecorded
    ).toBe(true);
  });
});

describe('campiDaEvento', () => {
  it('prende i valori dell evento', () => {
    const ev: CampiDelFormato = {
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    };
    expect(campiDaEvento(ev)).toEqual({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });
  });

  it('un evento senza quei campi non ha destinazione, e vale i default', () => {
    expect(campiDaEvento({})).toEqual({
      recordingDestination: null,
      offerAddressBook: true,
      audienceAnonymous: false,
      hostsAlwaysRecorded: false,
      postEventShowQA: true,
    });
  });
});

describe('destinazioneDopoIlSalvataggio', () => {
  const accesa = { recordingEnabled: true, recordingDestination: 'PUBLIC' } as const;
  const spenta = {
    recordingEnabled: false,
    recordingDestination: 'REGISTRANTS',
  } as const;

  it('un evento che registra prende la scelta del modulo', () => {
    expect(destinazioneDopoIlSalvataggio(accesa, null)).toBe('PUBLIC');
    expect(destinazioneDopoIlSalvataggio(accesa, 'REGISTRANTS')).toBe('PUBLIC');
  });

  it('a registrazione spenta una scelta nuova resta nel modulo', () => {
    expect(destinazioneDopoIlSalvataggio(spenta, null)).toBeNull();
  });

  it('una destinazione dichiarata non si toglie, e a registrazione spenta si cambia', () => {
    expect(
      destinazioneDopoIlSalvataggio(
        { recordingEnabled: false, recordingDestination: null },
        'PUBLIC'
      )
    ).toBe('PUBLIC');
    expect(
      destinazioneDopoIlSalvataggio(
        { recordingEnabled: true, recordingDestination: null },
        'PUBLIC'
      )
    ).toBe('PUBLIC');
    expect(destinazioneDopoIlSalvataggio(spenta, 'PUBLIC')).toBe('REGISTRANTS');
  });
});

describe('campiDaSalvare', () => {
  it('in creazione manda tutto, tranne una destinazione che non c e', () => {
    expect(campiDaSalvare(modulo(), null, false)).toEqual(salvati);
    expect(
      campiDaSalvare(modulo({ recordingDestination: null }), null, false)
        .recordingDestination
    ).toBeUndefined();
  });

  it('in creazione un evento che non registra non dichiara una destinazione', () => {
    expect(
      campiDaSalvare(modulo({ recordingEnabled: false }), null, false)
        .recordingDestination
    ).toBeUndefined();
  });

  it('in modifica una scelta nuova a registrazione spenta non parte', () => {
    const senza = { ...salvati, recordingDestination: null };
    expect(
      campiDaSalvare(modulo({ recordingEnabled: false }), senza, false)
        .recordingDestination
    ).toBeUndefined();
  });

  it('a registrazione spenta una destinazione dichiarata si puo cambiare', () => {
    expect(
      campiDaSalvare(
        modulo({ recordingEnabled: false, recordingDestination: 'PUBLIC' }),
        salvati,
        false
      ).recordingDestination
    ).toBe('PUBLIC');
  });

  it('in modifica i campi non cambiati non partono', () => {
    expect(campiDaSalvare(modulo(), salvati, false)).toEqual({
      recordingDestination: undefined,
      offerAddressBook: undefined,
      audienceAnonymous: false,
      hostsAlwaysRecorded: false,
      postEventShowQA: undefined,
    });
  });

  it('in modifica i campi cambiati partono', () => {
    const form = modulo({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      postEventShowQA: false,
    });
    expect(campiDaSalvare(form, salvati, false)).toMatchObject({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      postEventShowQA: false,
    });
  });

  it('null non parte mai su un evento con destinazione', () => {
    expect(
      campiDaSalvare(modulo({ recordingDestination: null }), salvati, false)
        .recordingDestination
    ).toBeUndefined();
  });

  it('con un link di conduzione partono solo i nomi del pubblico', () => {
    const form = modulo({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      postEventShowQA: false,
      hostsAlwaysRecorded: true,
    });
    expect(campiDaSalvare(form, salvati, true)).toEqual({
      recordingDestination: undefined,
      offerAddressBook: undefined,
      audienceAnonymous: false,
      hostsAlwaysRecorded: undefined,
      postEventShowQA: undefined,
    });
  });
});
