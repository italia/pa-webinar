// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { elencoPredefinito } from '@/lib/live/participant-list';
import { regolaConsenso, type VoceNelVideo } from '@/lib/live/consent-rule';
import { MESI_RUBRICA_PREDEFINITI } from '@/lib/persons/retention';
import { trascrizioneDalVideo } from '@/lib/registration/consents';
import type { ImpostazioniPubbliche } from '@/lib/settings/public-projection';
import { publicSettings } from '@/lib/settings/public-projection';

import {
  presetDaFormato,
  type FormatoAccesso,
  type FormatoGuidato,
  type FormatoPersone,
  type FormatoRegistra,
  type FormatoVoce,
} from './guided-format';
import {
  schedaPrivacy,
  schedaPrivacyEvento,
  testoIaDelSito,
  type AmbienteScheda,
  type EventoScheda,
  type SitoScheda,
} from './privacy-sheet';

const EVENTO: EventoScheda = {
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  autoStartRecording: false,
  recordingDestination: 'PUBLIC',
  recordingAudience: 'PUBLIC',
  multitrackRecordingEnabled: false,
  retainParticipantTracks: false,
  hostsAlwaysRecorded: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
  liveCaptionsEnabled: true,
  captionsTranscriptEnabled: false,
  aiTranscriptEnabled: true,
  aiSummaryEnabled: true,
  aiTranslationEnabled: true,
  aiDubbingEnabled: false,
  chatEnabled: true,
  qaEnabled: true,
  postEventShowQA: true,
  participantListVisible: true,
  audienceAnonymous: false,
  dataRetentionDays: 30,
  recordingDeleteAfterDays: null,
  offerAddressBook: true,
};

const SENZA_PRESENZA = {
  participantsCanUnmute: false,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};

const SITO: SitoScheda = {
  aiPipelineEnabled: true,
  addressBookEnabled: true,
  liveCaptionsEnabled: true,
};

const AMBIENTE: AmbienteScheda = {
  registrazioneDisponibile: true,
  voce: 'rimovibile',
  sottotitoliDisponibili: true,
  trascrizioneSottotitoli: false,
  tracceDisponibili: true,
};

function scheda(
  evento: Partial<EventoScheda> = {},
  ambiente: Partial<AmbienteScheda> = {},
  sito: Partial<SitoScheda> = {}
) {
  const s = schedaPrivacy({
    evento: { ...EVENTO, ...evento },
    sito: { ...SITO, ...sito },
    ambiente: { ...AMBIENTE, ...ambiente },
  });
  if (!s) throw new Error('scheda attesa');
  return s;
}

describe('schedaPrivacy, la voce di chi non acconsente', () => {
  it('rimovibile: chi non acconsente partecipa e la sua voce resta fuori; chi conduce e\' nel video', () => {
    expect(scheda({}, { voce: 'rimovibile' }).registrazione).toEqual({
      modo: 'manuale',
      destinazione: 'PUBLIC',
      chiNonAcconsente: 'restaFuori',
      conduceSempre: true,
    });
  });

  it('fissa: chi non acconsente partecipa in solo ascolto; chi conduce e\' nel video', () => {
    expect(scheda({}, { voce: 'fissa' }).registrazione).toEqual({
      modo: 'manuale',
      destinazione: 'PUBLIC',
      chiNonAcconsente: 'soloAscolto',
      conduceSempre: true,
    });
  });

  it('assente: senza tracce non si registra niente, e non si parla di video', () => {
    const s = scheda({}, { voce: 'assente' });
    expect(s.registrazione).toEqual({
      modo: 'nessuna',
      destinazione: null,
      chiNonAcconsente: null,
      conduceSempre: false,
    });
    expect(s.conservazione.registrazione).toBeNull();
  });

  it("assente: con le tracce non c'e' un video da pubblicare", () => {
    const s = scheda(
      { multitrackRecordingEnabled: true, recordingDestination: 'REGISTRANTS' },
      { voce: 'assente' }
    );
    expect(s.registrazione).toEqual({
      modo: 'soloTracce',
      destinazione: null,
      chiNonAcconsente: 'restaFuori',
      conduceSempre: false,
    });
    // Niente video, ma la trascrizione resta con la sua durata.
    expect(s.conservazione.registrazione).toEqual({ giorni: null, video: false });
    expect(s.trascrizione.tracce).toBe('cancellate');
  });

  it.each<[VoceNelVideo, string]>([
    ['rimovibile', 'avvisoVoce'],
    ['fissa', 'avviso'],
  ])(
    'voce %s, pubblico senza microfono, videocamera e schermo: si avvisa e basta',
    (voce, atteso) => {
      expect(scheda(SENZA_PRESENZA, { voce }).registrazione.chiNonAcconsente).toBe(
        atteso
      );
    }
  );

  it('assente con le tracce, pubblico senza presenza: acconsente in sala', () => {
    const s = scheda(
      { ...SENZA_PRESENZA, multitrackRecordingEnabled: true },
      { voce: 'assente' }
    );
    expect(s.registrazione.chiNonAcconsente).toBe('avvisoVoce');
  });

  it('dice lo stesso della regola del consenso, per ogni regime', () => {
    for (const voce of ['assente', 'rimovibile', 'fissa'] as const) {
      for (const presenza of [EVENTO, { ...EVENTO, ...SENZA_PRESENZA }]) {
        const regola = regolaConsenso(
          { ...presenza, multitrackRecordingEnabled: true },
          true,
          voce
        );
        const { chiNonAcconsente } = scheda(
          { ...presenza, multitrackRecordingEnabled: true },
          { voce }
        ).registrazione;
        expect(chiNonAcconsente === 'soloAscolto').toBe(regola.soloAscolto);
        expect(chiNonAcconsente === 'restaFuori').toBe(
          regola.richiesto && !regola.soloAscolto
        );
      }
    }
  });

  it('chi conduce e\' nel video dove c\'e\' un video, qualunque valore resti sulla colonna', () => {
    for (const hostsAlwaysRecorded of [false, true]) {
      const evento = { hostsAlwaysRecorded };
      expect(scheda(evento, { voce: 'rimovibile' }).registrazione.conduceSempre).toBe(true);
      expect(scheda(evento, { voce: 'fissa' }).registrazione.conduceSempre).toBe(true);
      expect(scheda(evento, { voce: 'assente' }).registrazione.conduceSempre).toBe(false);
      expect(
        scheda({ ...evento, recordingEnabled: false }, { voce: 'rimovibile' }).registrazione
          .conduceSempre
      ).toBe(false);
    }
  });
});

describe('schedaPrivacy, la registrazione', () => {
  it('non promette una registrazione certa se parte solo con il comando', () => {
    expect(scheda().registrazione.modo).toBe('manuale');
    expect(scheda({ autoStartRecording: true }).registrazione.modo).toBe('automatica');
  });

  it("l'evento non registra", () => {
    const s = scheda({ recordingEnabled: false, multitrackRecordingEnabled: true });
    expect(s.registrazione).toEqual({
      modo: 'nessuna',
      destinazione: null,
      chiNonAcconsente: null,
      conduceSempre: false,
    });
    expect(s.trascrizione.tracce).toBeNull();
    expect(s.conservazione.registrazione).toBeNull();
  });

  it("l'installazione non puo' registrare: niente video, tracce o elaborazioni", () => {
    const s = scheda(
      { multitrackRecordingEnabled: true, hostsAlwaysRecorded: true },
      { registrazioneDisponibile: false, tracceDisponibili: false }
    );
    expect(s.registrazione).toEqual({
      modo: 'nessuna',
      destinazione: null,
      chiNonAcconsente: null,
      conduceSempre: false,
    });
    expect(s.trascrizione).toEqual({ chiesta: false, sottotitoli: false, tracce: null, dalVideo: false });
    expect(s.conservazione.registrazione).toBeNull();
    expect(s.ia).toEqual({
      sintesi: false,
      traduzione: false,
      doppiaggio: false,
      elaborabileDopo: false,
    });
  });

  it.each([
    ['PUBLIC', 'PUBLIC'],
    ['REGISTRANTS', 'REGISTRANTS'],
    [null, 'nonDichiarata'],
  ] as const)('destinazione %s', (destinazione, atteso) => {
    expect(
      scheda({ recordingDestination: destinazione }).registrazione.destinazione
    ).toBe(atteso);
  });
});

describe('schedaPrivacy, la trascrizione', () => {
  const TRACCE = { multitrackRecordingEnabled: true };

  it('tracce per persona: si dicono, e il video non si nomina', () => {
    const evento = { ...EVENTO, ...TRACCE };
    // La regola del video da sola direbbe il contrario: per questo si guardano
    // prima le tracce.
    expect(trascrizioneDalVideo(evento, SITO, true, 'rimovibile')).toBe(true);
    expect(scheda(TRACCE).trascrizione).toEqual({
      chiesta: true,
      sottotitoli: false,
      tracce: 'cancellate',
      dalVideo: false,
    });
  });

  it('solo dal video: niente tracce e pipeline accesa', () => {
    expect(scheda().trascrizione).toEqual({
      chiesta: true,
      sottotitoli: false,
      tracce: null,
      dalVideo: true,
    });
  });

  it('con il solo Jibri il flag delle tracce non basta: si trascrive dal video', () => {
    expect(scheda(TRACCE, { tracceDisponibili: false }).trascrizione).toEqual({
      chiesta: true,
      sottotitoli: false,
      tracce: null,
      dalVideo: true,
    });
  });

  it("senza trascrizione sull'evento il registratore per persona non parte", () => {
    expect(scheda({ ...TRACCE, aiTranscriptEnabled: false }).trascrizione).toEqual({
      chiesta: true,
      sottotitoli: false,
      tracce: null,
      dalVideo: false,
    });
  });

  it('non promette la cancellazione di una traccia che si conserva', () => {
    expect(scheda({ ...TRACCE, retainParticipantTracks: true }).trascrizione.tracce).toBe(
      'conservate'
    );
  });

  it("senza pipeline nessuno trascrive la traccia: resta con i dati dell'evento", () => {
    expect(scheda(TRACCE, {}, { aiPipelineEnabled: false }).trascrizione.tracce).toBe(
      'conservate'
    );
  });

  it('i sottotitoli tenuti si dicono accanto alle altre vie', () => {
    expect(scheda(TRACCE, { trascrizioneSottotitoli: true }).trascrizione).toEqual({
      chiesta: true,
      sottotitoli: true,
      tracce: 'cancellate',
      dalVideo: false,
    });
  });
});

describe('schedaPrivacy, se la trascrizione si chiede', () => {
  const TRACCE = { multitrackRecordingEnabled: true };

  it('senza pipeline, tracce e sottotitoli non la chiede nessuno', () => {
    expect(scheda({}, {}, { aiPipelineEnabled: false }).trascrizione.chiesta).toBe(false);
  });

  it('la chiedono le tracce, il video e i sottotitoli tenuti', () => {
    expect(scheda(TRACCE, {}, { aiPipelineEnabled: false }).trascrizione.chiesta).toBe(true);
    expect(scheda().trascrizione.chiesta).toBe(true);
    expect(
      scheda({}, { trascrizioneSottotitoli: true }, { aiPipelineEnabled: false }).trascrizione
        .chiesta
    ).toBe(true);
  });

  it('il flag delle tracce non basta dove non si registra niente', () => {
    expect(
      scheda({ ...TRACCE, aiTranscriptEnabled: false }, { voce: 'assente' }).trascrizione.chiesta
    ).toBe(false);
  });
});

describe('schedaPrivacy, i sottotitoli', () => {
  it('non installati o spenti: nessun avviso', () => {
    expect(scheda({}, { sottotitoliDisponibili: false }).sottotitoli.attivi).toBe(false);
    expect(scheda({ liveCaptionsEnabled: false }).sottotitoli.attivi).toBe(false);
  });

  it('accesi, con il testo che si conserva o no', () => {
    expect(scheda().sottotitoli).toEqual({ attivi: true, testoConservato: false });
    expect(scheda({ captionsTranscriptEnabled: true }).sottotitoli).toEqual({
      attivi: true,
      testoConservato: true,
    });
  });

  it('spenti in partenza: si sa comunque che accesi dal vivo il testo si conserva', () => {
    expect(
      scheda({ liveCaptionsEnabled: false, captionsTranscriptEnabled: true }).sottotitoli
    ).toEqual({ attivi: false, testoConservato: true });
  });

  it("senza il servizio il testo non si conserva, qualunque cosa dica l'evento", () => {
    expect(
      scheda({ captionsTranscriptEnabled: true }, { sottotitoliDisponibili: false })
        .sottotitoli
    ).toEqual({ attivi: false, testoConservato: false });
  });
});

describe('schedaPrivacy, la pipeline AI', () => {
  it('spenta: nessuna riga e nessuna trascrizione dal video', () => {
    const s = scheda({}, {}, { aiPipelineEnabled: false });
    expect(s.ia).toBeNull();
    expect(s.trascrizione.dalVideo).toBe(false);
  });

  it("accesa: la riga resta anche con i flag dell'evento spenti, per il resoconto", () => {
    expect(
      scheda({
        aiTranscriptEnabled: false,
        aiSummaryEnabled: false,
        aiTranslationEnabled: false,
      }).ia
    ).toEqual({
      sintesi: false,
      traduzione: false,
      doppiaggio: false,
      elaborabileDopo: true,
    });
  });

  it("segue i flag dell'evento, solo se c'e' qualcosa da elaborare", () => {
    expect(scheda().ia).toEqual({
      sintesi: true,
      traduzione: true,
      doppiaggio: false,
      elaborabileDopo: false,
    });
    expect(scheda({ recordingEnabled: false }).ia).toEqual({
      sintesi: false,
      traduzione: false,
      doppiaggio: false,
      elaborabileDopo: false,
    });
  });

  it('il doppiaggio segue il suo flag, anche a traduzione spenta', () => {
    expect(scheda().ia?.doppiaggio).toBe(false);
    expect(scheda({ aiDubbingEnabled: true }).ia?.doppiaggio).toBe(true);
    // Chi organizza puo' aggiungere una lingua dopo l'evento, e il doppiaggio
    // parte con lei (lib/ai/enqueue).
    expect(
      scheda({ aiDubbingEnabled: true, aiTranslationEnabled: false }).ia?.doppiaggio
    ).toBe(true);
  });

  it('senza video non si doppia niente: sintesi e traduzione restano sulle tracce', () => {
    const s = scheda(
      { multitrackRecordingEnabled: true, aiDubbingEnabled: true },
      { voce: 'assente' }
    );
    expect(s.registrazione.modo).toBe('soloTracce');
    expect(s.ia).toEqual({
      sintesi: true,
      traduzione: true,
      doppiaggio: false,
      elaborabileDopo: false,
    });
  });

  describe("cio' che chi organizza puo' chiedere dopo l'evento", () => {
    const SPENTI = {
      aiTranscriptEnabled: false,
      aiSummaryEnabled: false,
      aiTranslationEnabled: false,
    };

    it("un video con i flag spenti si puo' ancora elaborare", () => {
      const s = scheda(SPENTI);
      expect(s.trascrizione.dalVideo).toBe(false);
      expect(s.ia?.elaborabileDopo).toBe(true);
    });

    it.each([
      ['la trascrizione', { aiTranscriptEnabled: false }],
      ['la sintesi', { aiSummaryEnabled: false }],
      ['la traduzione', { aiTranslationEnabled: false }],
    ])('basta che manchi %s', (_nome, spento) => {
      expect(scheda(spento).ia?.elaborabileDopo).toBe(true);
    });

    it('con le sole tracce restano sintesi e traduzione', () => {
      const tracce = { multitrackRecordingEnabled: true };
      expect(
        scheda({ ...tracce, aiSummaryEnabled: false }, { voce: 'assente' }).ia
          ?.elaborabileDopo
      ).toBe(true);
      expect(scheda(tracce, { voce: 'assente' }).ia?.elaborabileDopo).toBe(false);
    });

    it('niente da elaborare: non si dice', () => {
      expect(scheda(SPENTI, { voce: 'assente' }).ia?.elaborabileDopo).toBe(false);
      expect(scheda({ ...SPENTI, recordingEnabled: false }).ia?.elaborabileDopo).toBe(
        false
      );
      expect(
        scheda(SPENTI, { registrazioneDisponibile: false }).ia?.elaborabileDopo
      ).toBe(false);
    });
  });
});

describe('schedaPrivacy, chat e domande', () => {
  it("la chat c'e' e le domande pubblicate restano solo testo", () => {
    expect(scheda().chat).toEqual({
      attiva: true,
      domandeAttive: true,
      esitoDomande: 'soloTesto',
    });
  });

  it('niente chat, niente domande: niente da dire', () => {
    expect(scheda({ chatEnabled: false, qaEnabled: false }).chat).toMatchObject({
      attiva: false,
      domandeAttive: false,
    });
  });

  it("l'esito delle domande non dipende dal Q&A: chi modera puo' aprirlo dal vivo", () => {
    expect(scheda({ qaEnabled: false }).chat.esitoDomande).toBe('soloTesto');
    expect(
      scheda({ qaEnabled: false, recordingDestination: 'REGISTRANTS' }).chat.esitoDomande
    ).toBe('nonPubblicate');
    expect(scheda({ qaEnabled: false, postEventShowQA: false }).chat.esitoDomande).toBe(
      'nonPubblicate'
    );
  });

  it('con la registrazione riservata le domande non si pubblicano, qualunque sia la scelta', () => {
    expect(
      scheda({ recordingDestination: 'REGISTRANTS', postEventShowQA: true }).chat.esitoDomande
    ).toBe('nonPubblicate');
  });

  it('segue la scelta di chi organizza', () => {
    expect(scheda({ postEventShowQA: false }).chat.esitoDomande).toBe('nonPubblicate');
    expect(scheda({ recordingAudience: 'REGISTRANTS' }).chat.esitoDomande).toBe('nonPubblicate');
  });

  it('non dipende da cosa registra: senza video la regola resta quella della pagina', () => {
    expect(scheda({ recordingEnabled: false }).chat.esitoDomande).toBe('soloTesto');
    expect(scheda({}, { voce: 'assente' }).chat.esitoDomande).toBe('soloTesto');
  });
});

describe('schedaPrivacy, gli altri fatti', () => {
  it("l'elenco segue la regola della sala: con gli pseudonimi resta nascosto", () => {
    expect(scheda({ participantListVisible: true }).elencoVisibile).toBe(true);
    expect(scheda({ participantListVisible: false }).elencoVisibile).toBe(false);
    const s = scheda({ participantListVisible: true, audienceAnonymous: true });
    expect(s.elencoVisibile).toBe(false);
    expect(s.pseudonimi).toBe(true);
  });

  it('la conservazione della registrazione non inventa un numero di giorni', () => {
    expect(scheda().conservazione).toEqual({
      giorniDati: 30,
      registrazione: { giorni: null, video: true },
    });
    expect(
      scheda({ recordingDeleteAfterDays: 90, dataRetentionDays: 7 }).conservazione
    ).toEqual({
      giorniDati: 7,
      registrazione: { giorni: 90, video: true },
    });
    expect(scheda({ recordingDeleteAfterDays: 0 }).conservazione.registrazione).toEqual({
      giorni: null,
      video: true,
    });
  });

  it('senza video, la trascrizione dai sottotitoli ha la stessa durata', () => {
    const s = scheda(
      { recordingEnabled: false, recordingDeleteAfterDays: 30 },
      { trascrizioneSottotitoli: true }
    );
    expect(s.conservazione.registrazione).toEqual({ giorni: 30, video: false });
  });

  it("la rubrica serve accesa sia nell'installazione sia sull'evento", () => {
    expect(scheda().rubrica).toEqual({ mesi: MESI_RUBRICA_PREDEFINITI });
    expect(scheda({ offerAddressBook: false }).rubrica).toBeNull();
    expect(scheda({}, {}, { addressBookEnabled: false }).rubrica).toBeNull();
  });

  it("niente scheda sulle chiamate rapide, qualunque cosa dica l'evento", () => {
    expect(
      schedaPrivacy({
        evento: { ...EVENTO, eventType: 'INSTANT' },
        sito: SITO,
        ambiente: AMBIENTE,
      })
    ).toBeNull();
  });

  it("segue l'evento: cambia l'impostazione, cambia la scheda", () => {
    const prima = scheda();
    const dopo = scheda({
      recordingDestination: 'REGISTRANTS',
      autoStartRecording: true,
      audienceAnonymous: true,
      dataRetentionDays: 90,
    });
    expect(dopo.registrazione.destinazione).toBe('REGISTRANTS');
    expect(dopo.registrazione.modo).toBe('automatica');
    expect(dopo.pseudonimi).toBe(true);
    expect(dopo.conservazione.giorniDati).toBe(90);
    expect(dopo).not.toEqual(prima);
  });

  it("e' un dato: passa intatta dal server al client", () => {
    const s = scheda(
      { multitrackRecordingEnabled: true },
      { trascrizioneSottotitoli: true }
    );
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('schedaPrivacy, i formati guidati', () => {
  const PERSONE: FormatoPersone[] = ['piccolo', 'medio', 'grande'];
  const VOCI: FormatoVoce[] = ['tutti', 'relatori'];
  const REGISTRA: FormatoRegistra[] = ['no', 'riservata', 'pubblica'];
  const ACCESSI: FormatoAccesso[] = ['tutti', 'invitati'];
  const FORMATI: FormatoGuidato[] = PERSONE.flatMap((persone) =>
    VOCI.flatMap((voce) =>
      REGISTRA.flatMap((registra) =>
        ACCESSI.map((accesso) => ({ persone, voce, registra, accesso }))
      )
    )
  );

  /** L'evento che il formato crea: i valori del preset, compresa la destinazione,
   *  con la lista dei partecipanti che il wizard ne ricava. */
  function eventoDaFormato(f: FormatoGuidato): EventoScheda {
    const preset = presetDaFormato(f, 'Formato');
    return {
      ...EVENTO,
      ...preset,
      participantListVisible: elencoPredefinito(preset),
    } as EventoScheda;
  }

  it('prova tutte le combinazioni', () => {
    expect(FORMATI).toHaveLength(36);
  });

  it.each(
    FORMATI.map((f) => [`${f.persone}.${f.voce}.${f.registra}.${f.accesso}`, f] as const)
  )('%s', (_nome, formato) => {
    const evento = eventoDaFormato(formato);
    const s = schedaPrivacy({ evento, sito: SITO, ambiente: AMBIENTE });
    expect(s).not.toBeNull();
    if (!s) return;

    // La tabella dei formati, scritta qui per intero: chi cambia un valore di
    // partenza deve cambiarla apposta.
    const registra = formato.registra !== 'no';
    const pubblico = formato.voce === 'relatori' || formato.persone === 'grande';
    const riunione = !pubblico && formato.persone === 'piccolo';

    expect(s.registrazione.modo).toBe(registra ? 'manuale' : 'nessuna');
    expect(s.registrazione.destinazione).toBe(
      { no: null, riservata: 'REGISTRANTS', pubblica: 'PUBLIC' }[formato.registra]
    );
    expect(s.registrazione.chiNonAcconsente).toBe(
      !registra ? null : formato.voce === 'tutti' ? 'restaFuori' : 'avvisoVoce'
    );
    expect(s.registrazione.conduceSempre).toBe(registra);
    expect(s.trascrizione.tracce).toBe(registra ? 'cancellate' : null);
    expect(s.elencoVisibile).toBe(!pubblico);
    expect(s.pseudonimi).toBe(pubblico);
    expect(s.chat).toEqual({
      attiva: true,
      domandeAttive: true,
      esitoDomande:
        riunione || formato.registra === 'riservata' ? 'nonPubblicate' : 'soloTesto',
    });
    expect(s.rubrica).toEqual(riunione ? null : { mesi: MESI_RUBRICA_PREDEFINITI });
  });
});

describe('testoIaDelSito', () => {
  it('il testo della lingua della pagina, o nessuno', () => {
    const sito = { aiConsentDisclosure: { fr: 'Texte écrit.' } };
    expect(testoIaDelSito(sito, 'fr')).toBe('Texte écrit.');
    expect(testoIaDelSito(sito, 'it')).toBeNull();
    expect(testoIaDelSito({ aiConsentDisclosure: null }, 'it')).toBeNull();
  });
});

describe('schedaPrivacyEvento, sul server', () => {
  afterEach(() => vi.unstubAllEnvs());

  function installa(variabili: Record<string, string>) {
    for (const nome of [
      'JITSI_WEB_INTERNAL_URL',
      'JIBRI_HEALTH_URL',
      'RECORDER_CONTROLLER_URL',
      'RECORDING_VOICE_EXCLUSION',
      'RECORDING_STORAGE_TYPE',
      'CAPTIONS_STATUS_URL',
    ]) {
      vi.stubEnv(nome, variabili[nome] ?? '');
    }
  }

  const CHART = { JITSI_WEB_INTERNAL_URL: 'http://jitsi-web' };

  it('chart senza registratori e senza sottotitoli: nessuna riga su video o sottotitoli', () => {
    installa(CHART);
    const s = schedaPrivacyEvento({ ...EVENTO, captionsTranscriptEnabled: true }, SITO);
    expect(s?.registrazione.modo).toBe('nessuna');
    expect(s?.sottotitoli).toEqual({ attivi: false, testoConservato: false });
    expect(s?.trascrizione.sottotitoli).toBe(false);
  });

  it('Jibri con la voce esclusa e i sottotitoli installati', () => {
    installa({
      ...CHART,
      JIBRI_HEALTH_URL: 'http://jibri',
      RECORDING_VOICE_EXCLUSION: 'true',
      CAPTIONS_STATUS_URL: 'http://sottotitoli:2700/status',
    });
    const s = schedaPrivacyEvento(
      { ...EVENTO, captionsTranscriptEnabled: true, multitrackRecordingEnabled: true },
      SITO
    );
    expect(s?.registrazione.chiNonAcconsente).toBe('restaFuori');
    expect(s?.trascrizione).toEqual({ chiesta: true, sottotitoli: true, tracce: null, dalVideo: true });
    expect(s?.sottotitoli).toEqual({ attivi: true, testoConservato: true });
  });

  it('solo il registratore per partecipante: tracce senza video', () => {
    installa({ ...CHART, RECORDER_CONTROLLER_URL: 'http://recorder-controller:8080' });
    const s = schedaPrivacyEvento({ ...EVENTO, multitrackRecordingEnabled: true }, SITO);
    expect(s?.registrazione.modo).toBe('soloTracce');
    expect(s?.trascrizione.tracce).toBe('cancellate');
  });

  it('Jitsi esterno: la risposta prudente', () => {
    installa({});
    const s = schedaPrivacyEvento(EVENTO, SITO);
    expect(s?.registrazione.modo).toBe('manuale');
    expect(s?.registrazione.chiNonAcconsente).toBe('soloAscolto');
  });

  it("sottotitoli spenti nell'installazione: non si annunciano", () => {
    installa({ CAPTIONS_STATUS_URL: 'http://sottotitoli:2700/status' });
    expect(
      schedaPrivacyEvento(
        { ...EVENTO, captionsTranscriptEnabled: true },
        { ...SITO, liveCaptionsEnabled: false }
      )?.sottotitoli
    ).toEqual({ attivi: false, testoConservato: false });
  });

  it('legge la rubrica dalla riga intera, e il compilatore rifiuta le altre', () => {
    installa({});
    expect(
      schedaPrivacyEvento(EVENTO, { ...SITO, addressBookEnabled: false })?.rubrica
    ).toBeNull();

    const pubbliche = {} as ImpostazioniPubbliche;
    // @ts-expect-error le impostazioni pubbliche non portano addressBookEnabled
    expect(() => schedaPrivacyEvento(EVENTO, pubbliche)).not.toThrow();
    // @ts-expect-error la proiezione pubblica non porta addressBookEnabled
    expect(() => schedaPrivacyEvento(EVENTO, publicSettings({ ...SITO }))).not.toThrow();
  });
});
