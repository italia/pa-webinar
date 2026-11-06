// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';

import {
  chiaveConsensoTrascrizione,
  traccePerPersonaConservate,
  consensiRichiesti,
  trascrizioneDalVideo,
  trascrizioneRichiesta,
} from './consents';

const base = {
  recordingEnabled: true,
  multitrackRecordingEnabled: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
};
const ascolto = {
  participantsCanUnmute: false,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};

describe('consensiRichiesti', () => {
  it('chi può parlare e mostrarsi presta entrambi i consensi', () => {
    expect(consensiRichiesti(base)).toEqual({
      registrazione: true,
      avvisoRegistrazione: false,
      tracce: true,
    });
  });

  it("solo ascolto: l'informativa al posto della casella, la traccia resta obbligatoria", () => {
    // Il registratore multitraccia non filtra per consenso: chi riceve la
    // parola dev'essere già coperto.
    expect(consensiRichiesti({ ...base, ...ascolto })).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
  });

  it('il solo schermo condiviso basta a chiedere il consenso alla registrazione', () => {
    expect(
      consensiRichiesti({ ...base, ...ascolto, participantsCanShareScreen: true }).registrazione,
    ).toBe(true);
  });

  it('senza registrazione non si chiede né si avvisa', () => {
    expect(
      consensiRichiesti({ ...base, recordingEnabled: false, multitrackRecordingEnabled: false }),
    ).toEqual({ registrazione: false, avvisoRegistrazione: false, tracce: false });
  });
});

describe('trascrizioneDalVideo', () => {
  const evento = { eventType: 'SCHEDULED', recordingEnabled: true, aiTranscriptEnabled: true };
  const sito = { aiPipelineEnabled: true };

  it("vale dove c'e' un video da trascrivere e l'AI e' accesa", () => {
    expect(trascrizioneDalVideo(evento, sito, true, 'fissa')).toBe(true);
    expect(trascrizioneDalVideo(evento, sito, true, 'rimovibile')).toBe(true);
  });

  it('non vale in una chiamata rapida', () => {
    expect(trascrizioneDalVideo({ ...evento, eventType: 'INSTANT' }, sito, true, 'fissa')).toBe(false);
  });

  it("non vale se l'evento non registra o non vuole la trascrizione", () => {
    expect(trascrizioneDalVideo({ ...evento, recordingEnabled: false }, sito, true, 'fissa')).toBe(false);
    expect(trascrizioneDalVideo({ ...evento, aiTranscriptEnabled: false }, sito, true, 'fissa')).toBe(false);
  });

  it('non vale con la pipeline spenta, o se il valore manca', () => {
    expect(trascrizioneDalVideo(evento, { aiPipelineEnabled: false }, true, 'fissa')).toBe(false);
    expect(trascrizioneDalVideo(evento, {}, true, 'fissa')).toBe(false);
  });

  it("non vale dove l'installazione non puo' produrre il video completo", () => {
    expect(trascrizioneDalVideo(evento, sito, false, 'fissa')).toBe(false);
    expect(trascrizioneDalVideo(evento, sito, true, 'assente')).toBe(false);
  });

  it("senza i campi dell'evento non vale", () => {
    expect(trascrizioneDalVideo({}, sito, true, 'fissa')).toBe(false);
  });
});

describe('trascrizioneRichiesta', () => {
  it('basta una delle tre fonti', () => {
    expect(trascrizioneRichiesta({ multitrackRecordingEnabled: true })).toBe(true);
    expect(trascrizioneRichiesta({ captionsTranscript: true })).toBe(true);
    expect(trascrizioneRichiesta({ trascrizioneVideo: true })).toBe(true);
  });

  it('senza nessuna non si chiede', () => {
    expect(trascrizioneRichiesta({})).toBe(false);
  });
});

describe('consensiRichiesti con la trascrizione dal video', () => {
  const senzaTracce = { ...base, multitrackRecordingEnabled: false };

  it('senza il campo la regola resta quella delle tracce e dei sottotitoli', () => {
    expect(consensiRichiesti(senzaTracce).tracce).toBe(false);
    expect(consensiRichiesti({ ...senzaTracce, captionsTranscript: true }).tracce).toBe(true);
  });

  it("il campo chiede la trascrizione anche senza tracce ne' sottotitoli", () => {
    expect(consensiRichiesti({ ...senzaTracce, trascrizioneVideo: true }).tracce).toBe(true);
    expect(consensiRichiesti({ ...senzaTracce, trascrizioneVideo: false }).tracce).toBe(false);
  });

  it("non cambia la registrazione ne' l'avviso", () => {
    expect(consensiRichiesti({ ...senzaTracce, ...ascolto, trascrizioneVideo: true })).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
  });

  it("i flag grezzi che la rotta passa con le colonne dell'evento non bastano", () => {
    const colonne = { ...senzaTracce, aiTranscriptEnabled: true, aiPipelineEnabled: true };
    expect(consensiRichiesti(colonne).tracce).toBe(false);
  });
});

describe('traccePerPersonaConservate', () => {
  it("l'evento le conserva, anche a pipeline accesa", () => {
    expect(
      traccePerPersonaConservate({ retainParticipantTracks: true }, { aiPipelineEnabled: true }),
    ).toBe(true);
  });

  it('a pipeline spenta nessuna trascrizione le cancella', () => {
    expect(
      traccePerPersonaConservate({ retainParticipantTracks: false }, { aiPipelineEnabled: false }),
    ).toBe(true);
    expect(traccePerPersonaConservate({}, {})).toBe(true);
  });

  it('a pipeline accesa, senza conservazione, si cancellano', () => {
    expect(
      traccePerPersonaConservate({ retainParticipantTracks: false }, { aiPipelineEnabled: true }),
    ).toBe(false);
    expect(
      traccePerPersonaConservate({ retainParticipantTracks: null }, { aiPipelineEnabled: true }),
    ).toBe(false);
  });
});

describe('chiaveConsensoTrascrizione', () => {
  it('con le tracce conservate il testo non promette la cancellazione', () => {
    expect(chiaveConsensoTrascrizione(true)).toBe('multitrackRetained');
  });

  it('altrimenti resta il testo di sempre, anche se il valore manca', () => {
    expect(chiaveConsensoTrascrizione(false)).toBe('multitrack');
    expect(chiaveConsensoTrascrizione(undefined)).toBe('multitrack');
  });

  it('i due testi esistono, e solo uno promette la cancellazione', () => {
    const { multitrack, multitrackRetained } = messages.gdpr.consent;
    expect(multitrack).toContain('si cancella');
    expect(multitrackRetained).toBeTruthy();
    expect(multitrackRetained).not.toContain('si cancella');
  });
});
