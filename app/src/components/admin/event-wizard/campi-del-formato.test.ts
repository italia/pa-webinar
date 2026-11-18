// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { videoDaDestinare } from '@/lib/recording/destination';

import {
  campiDaEvento,
  campiDaModello,
  campiDaSalvare,
  destinazioneDopoIlSalvataggio,
  destinazioneSuInvito,
  paginaCheSegue,
  registrazioneVuota,
  videoPubblico,
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
    expect(videoDaDestinare('visibili')).toBe(true);
    expect(videoDaDestinare('solo-voce')).toBe(true);
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

describe('videoPubblico', () => {
  it('conta solo su un evento che registra', () => {
    expect(
      videoPubblico({ recordingEnabled: true, recordingDestination: 'PUBLIC' })
    ).toBe(true);
    expect(
      videoPubblico({ recordingEnabled: false, recordingDestination: 'PUBLIC' })
    ).toBe(false);
    expect(
      videoPubblico({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' })
    ).toBe(false);
  });
});

describe('registrazioneVuota', () => {
  const tracce = { aiTranscriptEnabled: true, multitrackRecordingEnabled: true };
  const niente = { aiTranscriptEnabled: false, multitrackRecordingEnabled: false };

  it('solo senza video della sala e senza tracce', () => {
    expect(
      registrazioneVuota({ recordingEnabled: true, ...niente }, 'assente', true)
    ).toBe(true);
    expect(
      registrazioneVuota({ recordingEnabled: true, ...tracce }, 'assente', true)
    ).toBe(false);
    expect(
      registrazioneVuota({ recordingEnabled: true, ...niente }, 'visibili', true)
    ).toBe(false);
    expect(
      registrazioneVuota({ recordingEnabled: false, ...niente }, 'assente', true)
    ).toBe(false);
  });

  it('non conta un evento che non registra, e le tracce valgono solo se il registratore c e', () => {
    expect(
      registrazioneVuota({ recordingEnabled: true, ...tracce }, 'assente', false)
    ).toBe(true);
  });
});

describe('paginaCheSegue', () => {
  const riservata = {
    recordingEnabled: true,
    recordingDestination: 'REGISTRANTS' as const,
  };
  const pubblica = { recordingEnabled: true, recordingDestination: 'PUBLIC' as const };
  const senza = { recordingEnabled: false, recordingDestination: null };
  const spenta = { recordingEnabled: false, recordingDestination: 'PUBLIC' as const };
  const daRiservataPrivata = { ...riservata, postEventPublic: false };
  const daRiservataAperta = { ...riservata, postEventPublic: true };
  const daPubblicaPrivata = { ...pubblica, postEventPublic: false };
  const daPubblicaAperta = { ...pubblica, postEventPublic: true };

  it('un evento che diventa su invito chiude la pagina', () => {
    expect(
      paginaCheSegue(
        daRiservataAperta,
        { suInvito: false, form: riservata },
        { suInvito: true, form: { ...riservata, postEventPublic: true } }
      )
    ).toBe(false);
    expect(
      paginaCheSegue(
        { ...senza, postEventPublic: true },
        { suInvito: false, form: senza },
        { suInvito: true, form: { ...senza, postEventPublic: true } }
      )
    ).toBe(false);
  });

  it('salvo che il video resti pubblico', () => {
    expect(
      paginaCheSegue(
        daPubblicaAperta,
        { suInvito: false, form: pubblica },
        { suInvito: true, form: { ...pubblica, postEventPublic: true } }
      )
    ).toBe(true);
  });

  it('un video che diventa pubblico apre la pagina, anche su invito', () => {
    expect(
      paginaCheSegue(
        daRiservataPrivata,
        { suInvito: false, form: riservata },
        { suInvito: false, form: { ...pubblica, postEventPublic: false } }
      )
    ).toBe(true);
    expect(
      paginaCheSegue(
        daRiservataPrivata,
        { suInvito: true, form: riservata },
        { suInvito: true, form: { ...pubblica, postEventPublic: false } }
      )
    ).toBe(true);
  });

  it('il video di un evento su invito che smette di essere pubblico la richiude', () => {
    expect(
      paginaCheSegue(
        daRiservataAperta,
        { suInvito: true, form: pubblica },
        { suInvito: true, form: { ...riservata, postEventPublic: true } }
      )
    ).toBe(false);
  });

  it('su un evento aperto il video che smette di essere pubblico torna alla partenza', () => {
    expect(
      paginaCheSegue(
        daRiservataPrivata,
        { suInvito: false, form: pubblica },
        { suInvito: false, form: { ...riservata, postEventPublic: true } }
      )
    ).toBe(false);
    expect(
      paginaCheSegue(
        daPubblicaAperta,
        { suInvito: false, form: pubblica },
        { suInvito: false, form: { ...riservata, postEventPublic: true } }
      )
    ).toBe(true);
  });

  it('un video pubblico gia alla partenza non apre una pagina privata tornando', () => {
    const spegnendo = paginaCheSegue(
      daPubblicaPrivata,
      { suInvito: false, form: pubblica },
      { suInvito: false, form: { ...spenta, postEventPublic: false } }
    );
    expect(spegnendo).toBe(false);
    expect(
      paginaCheSegue(
        daPubblicaPrivata,
        { suInvito: false, form: spenta },
        { suInvito: false, form: { ...pubblica, postEventPublic: spegnendo } }
      )
    ).toBe(false);
  });

  it('senza un passaggio la pagina resta com e', () => {
    expect(
      paginaCheSegue(
        daRiservataAperta,
        { suInvito: true, form: riservata },
        { suInvito: false, form: { ...riservata, postEventPublic: false } }
      )
    ).toBe(false);
    expect(
      paginaCheSegue(
        daPubblicaPrivata,
        { suInvito: false, form: pubblica },
        { suInvito: false, form: { ...pubblica, postEventPublic: false } }
      )
    ).toBe(false);
    expect(
      paginaCheSegue(
        daRiservataAperta,
        { suInvito: true, form: riservata },
        { suInvito: true, form: { ...riservata, postEventPublic: true } }
      )
    ).toBe(true);
  });
});

describe('destinazioneSuInvito', () => {
  it('un video pubblico che nessuno ha scelto torna riservato', () => {
    expect(destinazioneSuInvito('PUBLIC', true, false)).toBe('REGISTRANTS');
  });

  it('una destinazione scelta resta', () => {
    expect(destinazioneSuInvito('PUBLIC', true, true)).toBe('PUBLIC');
  });

  it('il passaggio inverso non allarga, e nulla resta nulla', () => {
    expect(destinazioneSuInvito('REGISTRANTS', false, false)).toBe('REGISTRANTS');
    expect(destinazioneSuInvito('PUBLIC', false, false)).toBe('PUBLIC');
    expect(destinazioneSuInvito(null, true, false)).toBeNull();
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
