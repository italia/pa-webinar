// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { messaggioErroreApi } from '@/lib/api-error-message';
import { AppError } from '@/lib/errors';

import {
  assertEsposizioneConsentita,
  chiaveAvvisoConduce,
  chiaveConsenso,
  consensoCopre,
  consensoOra,
  destinazioneDelTesto,
  erroreDestinazioneNonCoperta,
  esitoPubblicazione,
  puoCambiareDestinazione,
  testoInVigore,
  testoLetto,
  VERSIONE_TESTO_REGISTRAZIONE,
  type Destinazione,
  type EsposizioneVideo,
  destinazioneDiPartenza,
  DESTINAZIONE_DI_PARTENZA,
  videoDaDestinare,
} from './destination';

const DESTINAZIONI: Destinazione[] = ['PUBLIC', 'REGISTRANTS', null];

const video = (over: Partial<EsposizioneVideo> = {}): EsposizioneVideo => ({
  recordingDestination: 'REGISTRANTS',
  recordingAudience: 'REGISTRANTS',
  recordingPublished: false,
  transcriptPublished: false,
  youtubeUrl: null,
  tempRecordingUrl: null,
  ...over,
});

/** L'errore lanciato dalla guardia, o null se la modifica passa. */
function esito(prima: EsposizioneVideo | null, dopo: EsposizioneVideo): AppError | null {
  try {
    assertEsposizioneConsentita(prima, dopo);
    return null;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

describe('consensoCopre', () => {
  it.each([
    // [consenso, evento, copre]
    ['PUBLIC', 'PUBLIC', true],
    ['REGISTRANTS', 'PUBLIC', false],
    [null, 'PUBLIC', false],
    ['PUBLIC', 'REGISTRANTS', true],
    ['REGISTRANTS', 'REGISTRANTS', true],
    [null, 'REGISTRANTS', false],
    ['PUBLIC', null, true],
    ['REGISTRANTS', null, true],
    [null, null, true],
  ] as const)('consenso %s, evento %s: %s', (consenso, evento, copre) => {
    expect(consensoCopre(consenso, evento)).toBe(copre);
  });

  it('un campo assente vale come non dichiarato', () => {
    expect(consensoCopre(undefined, undefined)).toBe(true);
    expect(consensoCopre(undefined, 'PUBLIC')).toBe(false);
    expect(consensoCopre('REGISTRANTS', undefined)).toBe(true);
  });
});

describe('destinazioneDelTesto', () => {
  it("e' quella dell'evento dove c'e' un video", () => {
    for (const voce of ['rimovibile', 'fissa'] as const) {
      expect(destinazioneDelTesto('PUBLIC', voce)).toBe('PUBLIC');
      expect(destinazioneDelTesto('REGISTRANTS', voce)).toBe('REGISTRANTS');
      expect(destinazioneDelTesto(null, voce)).toBeNull();
      expect(destinazioneDelTesto(undefined, voce)).toBeNull();
    }
  });

  it("dove non c'e' un video il testo non dichiara niente", () => {
    for (const destinazione of DESTINAZIONI) {
      expect(destinazioneDelTesto(destinazione, 'assente')).toBeNull();
    }
  });

  it("senza video un consenso senza destinazione copre, con il video non piu'", () => {
    expect(consensoCopre(null, destinazioneDelTesto('PUBLIC', 'assente'))).toBe(true);
    expect(consensoCopre(null, destinazioneDelTesto('REGISTRANTS', 'assente'))).toBe(
      true
    );
    expect(consensoCopre(null, destinazioneDelTesto('PUBLIC', 'rimovibile'))).toBe(false);
    expect(consensoCopre(null, destinazioneDelTesto('REGISTRANTS', 'fissa'))).toBe(false);
  });
});

describe('testoLetto', () => {
  it("e' cio' che la pagina dichiara, anche un testo senza destinazione", () => {
    for (const letta of DESTINAZIONI) {
      for (const inVigore of DESTINAZIONI) {
        expect(testoLetto(letta, inVigore)).toBe(letta);
      }
    }
  });

  it('solo il campo assente vale come testo in vigore', () => {
    for (const inVigore of DESTINAZIONI) {
      expect(testoLetto(undefined, inVigore)).toBe(inVigore);
    }
    expect(testoLetto(undefined, undefined)).toBeNull();
  });
});

describe('testoInVigore', () => {
  it.each([
    // [letta, inVigore, vale]
    ['PUBLIC', 'PUBLIC', true],
    ['REGISTRANTS', 'REGISTRANTS', true],
    [null, null, true],
    ['REGISTRANTS', 'PUBLIC', false],
    ['PUBLIC', 'REGISTRANTS', false],
    [null, 'PUBLIC', false],
    [null, 'REGISTRANTS', false],
    ['PUBLIC', null, false],
    ['REGISTRANTS', null, false],
  ] as const)('testo %s, destinazione %s: %s', (letta, inVigore, vale) => {
    expect(testoInVigore(letta, inVigore)).toBe(vale);
  });

  it('una pagina che non manda il campo non si rifiuta', () => {
    for (const inVigore of DESTINAZIONI) {
      expect(testoInVigore(undefined, inVigore)).toBe(true);
    }
    expect(testoInVigore(undefined, undefined)).toBe(true);
  });
});

describe('consensoOra', () => {
  const acconsente = (recordingConsentDestination?: Destinazione) => ({
    recordingConsent: true,
    recordingConsentDestination,
  });

  it('senza consenso non conta il testo', () => {
    expect(consensoOra({}, 'PUBLIC')).toBe(false);
    expect(consensoOra({ recordingConsent: false }, 'PUBLIC')).toBe(false);
    expect(
      consensoOra(
        { recordingConsent: false, recordingConsentDestination: 'PUBLIC' },
        'PUBLIC'
      )
    ).toBe(false);
  });

  it('una pagina che non manda il campo vale per il testo in vigore', () => {
    for (const inVigore of DESTINAZIONI) {
      expect(consensoOra({ recordingConsent: true }, inVigore)).toBe(true);
    }
    expect(consensoOra({ recordingConsent: true }, undefined)).toBe(true);
  });

  it.each([
    // [testo letto, destinazione in vigore, vale]
    ['PUBLIC', 'PUBLIC', true],
    ['REGISTRANTS', 'REGISTRANTS', true],
    [null, null, true],
    // Una restrizione a pagina aperta non chiede niente.
    ['PUBLIC', 'REGISTRANTS', true],
    // Allargare non si copre con il testo di prima.
    ['REGISTRANTS', 'PUBLIC', false],
    // Un testo che non diceva dove va il video non vale per una destinazione.
    [null, 'PUBLIC', false],
    [null, 'REGISTRANTS', false],
    // Su un evento senza destinazione vale ogni consenso.
    ['PUBLIC', null, true],
    ['REGISTRANTS', null, true],
  ] as const)('testo %s, destinazione %s: %s', (letta, inVigore, vale) => {
    expect(consensoOra(acconsente(letta), inVigore)).toBe(vale);
  });

  it('giudica come consensoCopre tutti i testi dichiarati', () => {
    for (const letta of DESTINAZIONI) {
      for (const inVigore of DESTINAZIONI) {
        expect(consensoOra(acconsente(letta), inVigore)).toBe(
          consensoCopre(letta, inVigore)
        );
      }
    }
  });
});

describe('testo del consenso', () => {
  it('la casella segue la destinazione, senza destinazione resta quella di prima', () => {
    for (const voce of ['rimovibile', 'fissa'] as const) {
      expect(chiaveConsenso('PUBLIC', voce)).toBe('recordingPublic');
      expect(chiaveConsenso('REGISTRANTS', voce)).toBe('recordingReserved');
      expect(chiaveConsenso(null, voce)).toBe('recording');
      expect(chiaveConsenso(undefined, voce)).toBe('recording');
    }
  });

  it("dove non c'e' un video la casella non ne parla, qualunque destinazione abbia l'evento", () => {
    for (const destinazione of [...DESTINAZIONI, undefined]) {
      expect(chiaveConsenso(destinazione, 'assente')).toBe('recordingNoVideo');
    }
  });

  it("l'avviso a chi conduce segue la destinazione", () => {
    expect(chiaveAvvisoConduce('PUBLIC')).toBe('recordingHostAlwaysPublic');
    expect(chiaveAvvisoConduce('REGISTRANTS')).toBe('recordingHostAlwaysReserved');
    expect(chiaveAvvisoConduce(null)).toBe('recordingHostAlways');
    expect(chiaveAvvisoConduce(undefined)).toBe('recordingHostAlways');
  });

  it('ogni testo esiste nel catalogo: una chiave sbagliata si vedrebbe nuda nella casella', () => {
    for (const destinazione of DESTINAZIONI) {
      for (const voce of ['assente', 'rimovibile', 'fissa'] as const) {
        expect(messages.gdpr.consent[chiaveConsenso(destinazione, voce)]).toBeTruthy();
      }
      expect(messages.gdpr.consent[chiaveAvvisoConduce(destinazione)]).toBeTruthy();
    }
    expect(messages.apiErrors.recordingDestinationNotCovered).toBeTruthy();
  });

  it("la versione del testo e' un numero valido per le colonne delle prove", () => {
    expect(Number.isInteger(VERSIONE_TESTO_REGISTRAZIONE)).toBe(true);
    expect(VERSIONE_TESTO_REGISTRAZIONE).toBeGreaterThan(0);
  });
});

describe('esitoPubblicazione', () => {
  it.each([
    ['REGISTRANTS', 'SCHEDULED', 'riservata'],
    ['REGISTRANTS', 'INSTANT', 'riservata'],
    ['REGISTRANTS', 'LEGACY', 'riservata'],
    ['PUBLIC', 'SCHEDULED', 'libera'],
    ['PUBLIC', 'INSTANT', 'libera'],
    ['PUBLIC', 'LEGACY', 'libera'],
    [null, 'SCHEDULED', 'senzaDestinazione'],
    [null, 'INSTANT', 'senzaDestinazione'],
    [null, 'LEGACY', 'libera'],
  ] as const)(
    'destinazione %s, tipo %s: %s',
    (recordingDestination, eventType, atteso) => {
      expect(esitoPubblicazione({ recordingDestination, eventType })).toBe(atteso);
    }
  );

  it('una destinazione assente vale come non dichiarata', () => {
    expect(
      esitoPubblicazione({ recordingDestination: undefined, eventType: 'SCHEDULED' })
    ).toBe('senzaDestinazione');
  });
});

describe('assertEsposizioneConsentita', () => {
  it('lancia un 409 con il codice che il client traduce', () => {
    const err = esito(video(), video({ recordingAudience: 'PUBLIC' }));
    expect(err).toBeInstanceOf(AppError);
    expect(err?.statusCode).toBe(409);
    expect(err?.code).toBe('RECORDING_DESTINATION_NOT_COVERED');
    expect(err?.code).toBe(erroreDestinazioneNonCoperta().code);
    expect(messaggioErroreApi(409, (k) => `[${k}]`, 'ripiego', {}, err?.code)).toBe(
      '[recordingDestinationNotCovered]'
    );
  });

  describe("evento riservato: cio' che aumenta l'esposizione si ferma", () => {
    it('la registrazione per tutti, anche non ancora pubblicata', () => {
      expect(esito(video(), video({ recordingAudience: 'PUBLIC' }))).not.toBeNull();
      expect(
        esito(
          video({ recordingPublished: true }),
          video({ recordingPublished: true, recordingAudience: 'PUBLIC' })
        )
      ).not.toBeNull();
      expect(
        esito(
          video({ transcriptPublished: true }),
          video({ transcriptPublished: true, recordingAudience: 'PUBLIC' })
        )
      ).not.toBeNull();
    });

    it("pubblicare per tutti, se il pubblico era gia' tutti", () => {
      const perTutti = video({ recordingAudience: 'PUBLIC' });
      expect(esito(perTutti, { ...perTutti, recordingPublished: true })).not.toBeNull();
      expect(esito(perTutti, { ...perTutti, transcriptPublished: true })).not.toBeNull();
      // Il video si aggiunge alla trascrizione gia' pubblicata: e' un'esposizione in piu'.
      const trascrizione = { ...perTutti, transcriptPublished: true };
      expect(
        esito(trascrizione, { ...trascrizione, recordingPublished: true })
      ).not.toBeNull();
    });

    it('un video esterno, nuovo o cambiato', () => {
      expect(
        esito(video(), video({ youtubeUrl: 'https://youtu.be/uno' }))
      ).not.toBeNull();
      expect(
        esito(
          video({ youtubeUrl: 'https://youtu.be/uno' }),
          video({ youtubeUrl: 'https://youtu.be/due' })
        )
      ).not.toBeNull();
    });

    it('un recupero in diretta, nuovo o cambiato', () => {
      expect(
        esito(video(), video({ tempRecordingUrl: 'https://cdn/uno' }))
      ).not.toBeNull();
      expect(
        esito(
          video({ tempRecordingUrl: 'https://cdn/uno' }),
          video({ tempRecordingUrl: 'https://cdn/due' })
        )
      ).not.toBeNull();
    });

    it('alla creazione, che non ha uno stato precedente', () => {
      expect(esito(null, video({ youtubeUrl: 'https://youtu.be/uno' }))).not.toBeNull();
      expect(esito(null, video({ tempRecordingUrl: 'https://cdn/uno' }))).not.toBeNull();
      expect(esito(null, video({ recordingAudience: 'PUBLIC' }))).not.toBeNull();
      expect(esito(null, video())).toBeNull();
    });

    it('un indirizzo nuovo insieme alla restrizione si ferma comunque', () => {
      expect(
        esito(
          video({ recordingDestination: 'PUBLIC', recordingAudience: 'PUBLIC' }),
          video({ youtubeUrl: 'https://youtu.be/uno' })
        )
      ).not.toBeNull();
    });
  });

  describe('evento riservato: il resto passa', () => {
    it('pubblicare per gli iscritti', () => {
      expect(esito(video(), video({ recordingPublished: true }))).toBeNull();
      expect(esito(video(), video({ transcriptPublished: true }))).toBeNull();
    });

    it("togliere un'esposizione", () => {
      expect(
        esito(video({ youtubeUrl: 'https://youtu.be/uno' }), video({ youtubeUrl: null }))
      ).toBeNull();
      expect(
        esito(
          video({ tempRecordingUrl: 'https://cdn/uno' }),
          video({ tempRecordingUrl: '' })
        )
      ).toBeNull();
      expect(
        esito(
          video({ recordingAudience: 'PUBLIC', recordingPublished: true }),
          video({ recordingAudience: 'REGISTRANTS', recordingPublished: true })
        )
      ).toBeNull();
      expect(
        esito(
          video({ recordingAudience: 'PUBLIC', recordingPublished: true }),
          video({ recordingAudience: 'PUBLIC', recordingPublished: false })
        )
      ).toBeNull();
    });

    it("una modifica che lascia tutto com'era", () => {
      const uguale = video({
        recordingAudience: 'PUBLIC',
        recordingPublished: true,
        youtubeUrl: 'https://youtu.be/uno',
        tempRecordingUrl: 'https://cdn/uno',
      });
      expect(esito(uguale, { ...uguale })).toBeNull();
    });
  });

  it('restringere verso riservata non si rifiuta mai', () => {
    const si = [false, true];
    for (const recordingDestination of ['PUBLIC', null] as const) {
      for (const recordingAudience of ['PUBLIC', 'REGISTRANTS'] as const) {
        for (const recordingPublished of si) {
          for (const transcriptPublished of si) {
            for (const youtubeUrl of [null, 'https://youtu.be/uno']) {
              for (const tempRecordingUrl of [null, 'https://cdn/uno']) {
                const prima = video({
                  recordingDestination,
                  recordingAudience,
                  recordingPublished,
                  transcriptPublished,
                  youtubeUrl,
                  tempRecordingUrl,
                });
                const ristretto: EsposizioneVideo = {
                  ...prima,
                  recordingDestination: 'REGISTRANTS',
                };
                expect(esito(prima, ristretto)).toBeNull();
                // Con il pubblico allineato alla destinazione, come fanno le rotte.
                expect(
                  esito(prima, { ...ristretto, recordingAudience: 'REGISTRANTS' })
                ).toBeNull();
              }
            }
          }
        }
      }
    }
  });

  it('senza destinazione riservata non ferma niente', () => {
    const tutto = {
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      transcriptPublished: true,
      youtubeUrl: 'https://youtu.be/uno',
      tempRecordingUrl: 'https://cdn/uno',
    } as const;
    for (const recordingDestination of ['PUBLIC', null] as const) {
      expect(
        esito(
          video({ recordingDestination, recordingAudience: 'REGISTRANTS' }),
          video({ recordingDestination, ...tutto })
        )
      ).toBeNull();
      expect(esito(null, video({ recordingDestination, ...tutto }))).toBeNull();
    }
  });

  it("allargare la destinazione non passa di qui: la regola e' puoCambiareDestinazione", () => {
    expect(
      esito(
        video(),
        video({ recordingDestination: 'PUBLIC', recordingAudience: 'PUBLIC' })
      )
    ).toBeNull();
  });
});

describe('puoCambiareDestinazione', () => {
  it.each([
    ['PUBLIC', 'PUBLIC', true],
    ['REGISTRANTS', 'REGISTRANTS', true],
    [null, null, true],
    ['PUBLIC', 'REGISTRANTS', true],
    ['REGISTRANTS', 'PUBLIC', true],
    [null, 'REGISTRANTS', true],
    [null, 'PUBLIC', true],
    ['REGISTRANTS', null, false],
    ['PUBLIC', null, false],
  ] as const)('prima della sala, da %s a %s: %s', (prima, dopo, atteso) => {
    expect(puoCambiareDestinazione(prima, dopo, false)).toBe(atteso);
  });

  it.each([
    ['PUBLIC', 'PUBLIC', true],
    ['REGISTRANTS', 'REGISTRANTS', true],
    [null, null, true],
    ['PUBLIC', 'REGISTRANTS', true],
    [null, 'REGISTRANTS', true],
    ['REGISTRANTS', 'PUBLIC', false],
    [null, 'PUBLIC', false],
    ['REGISTRANTS', null, false],
    ['PUBLIC', null, false],
  ] as const)('dopo la sala, da %s a %s: %s', (prima, dopo, atteso) => {
    expect(puoCambiareDestinazione(prima, dopo, true)).toBe(atteso);
  });

  it('togliere la destinazione non aggira il consenso a un video riservato', () => {
    // Passando per null il consenso coprirebbe e la guardia lascerebbe pubblicare.
    expect(consensoCopre('REGISTRANTS', 'PUBLIC')).toBe(false);
    expect(consensoCopre('REGISTRANTS', null)).toBe(true);
    expect(puoCambiareDestinazione('REGISTRANTS', null, false)).toBe(false);
    expect(puoCambiareDestinazione('REGISTRANTS', null, true)).toBe(false);
  });

  it('una destinazione assente vale come non dichiarata', () => {
    for (const salaGiaAperta of [false, true]) {
      expect(puoCambiareDestinazione(undefined, null, salaGiaAperta)).toBe(true);
      expect(puoCambiareDestinazione(undefined, 'REGISTRANTS', salaGiaAperta)).toBe(true);
    }
    expect(puoCambiareDestinazione(undefined, 'PUBLIC', false)).toBe(true);
    expect(puoCambiareDestinazione(undefined, 'PUBLIC', true)).toBe(false);
  });
});

describe('destinazioneDiPartenza', () => {
  const spento = { recordingEnabled: false };

  it('una dichiarata resta, in ogni caso', () => {
    for (const recordingEnabled of [false, true]) {
      for (const registra of [false, true]) {
        expect(
          destinazioneDiPartenza({ recordingEnabled, recordingDestination: 'PUBLIC' }, registra)
        ).toBe('PUBLIC');
      }
    }
  });

  it('chi comincia a registrare parte riservato', () => {
    expect(destinazioneDiPartenza(spento, true)).toBe(DESTINAZIONE_DI_PARTENZA);
    expect(DESTINAZIONE_DI_PARTENZA).toBe('REGISTRANTS');
  });

  it('senza registrazione non si dichiara niente', () => {
    expect(destinazioneDiPartenza(spento, false)).toBeNull();
  });

  it('un evento che registrava gia senza destinazione resta com era', () => {
    expect(destinazioneDiPartenza({ recordingEnabled: true }, true)).toBeNull();
    expect(
      destinazioneDiPartenza({ recordingEnabled: true, recordingDestination: null }, true)
    ).toBeNull();
  });

  it('una chiamata rapida resta senza', () => {
    expect(destinazioneDiPartenza({ ...spento, eventType: 'INSTANT' }, true)).toBeNull();
    expect(destinazioneDiPartenza({ ...spento, eventType: 'SCHEDULED' }, true)).toBe('REGISTRANTS');
  });

});

describe('dove il video della sala non c e', () => {
  it('la destinazione non si chiede', () => {
    expect(videoDaDestinare('assente')).toBe(false);
    expect(videoDaDestinare('fissa')).toBe(true);
    expect(videoDaDestinare('rimovibile')).toBe(true);
    expect(videoDaDestinare(undefined)).toBe(true);
  });

  it('se l installazione aggiunge il video, chi ha letto quel testo va richiesto', () => {
    const evento = destinazioneDiPartenza({ recordingEnabled: false }, true);
    expect(evento).toBe('REGISTRANTS');
    const letto = { recordingConsent: true, recordingConsentDestination: null };
    expect(consensoOra(letto, destinazioneDelTesto(evento, 'assente'))).toBe(true);
    expect(consensoOra(letto, destinazioneDelTesto(evento, 'fissa'))).toBe(false);
    expect(consensoCopre(null, destinazioneDelTesto(evento, 'fissa'))).toBe(false);
  });
});
