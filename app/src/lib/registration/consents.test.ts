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
    expect(consensiRichiesti(base, 'solo-voce')).toEqual({
      registrazione: true,
      avvisoRegistrazione: false,
      tracce: true,
    });
  });

  it("solo ascolto: l'informativa al posto della casella, la traccia resta obbligatoria", () => {
    // Il registratore multitraccia non filtra per consenso: chi riceve la
    // parola dev'essere già coperto.
    expect(consensiRichiesti({ ...base, ...ascolto }, 'solo-voce')).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
  });

  it('il solo schermo condiviso basta a chiedere il consenso alla registrazione', () => {
    expect(
      consensiRichiesti({ ...base, ...ascolto, participantsCanShareScreen: true }, 'solo-voce').registrazione,
    ).toBe(true);
  });

  it('senza registrazione non si chiede né si avvisa', () => {
    expect(
      consensiRichiesti({ ...base, recordingEnabled: false, multitrackRecordingEnabled: false }, 'solo-voce'),
    ).toEqual({ registrazione: false, avvisoRegistrazione: false, tracce: false });
  });

  it("dove chi partecipa non entra mai nel video non c'e' una casella: l'informativa", () => {
    expect(consensiRichiesti(base, 'esclusi')).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
    expect(consensiRichiesti({ ...base, ...ascolto }, 'esclusi')).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
    // Senza registrazione nemmeno quella.
    expect(consensiRichiesti({ ...base, recordingEnabled: false }, 'esclusi').avvisoRegistrazione).toBe(
      false,
    );
  });

  it.each(['visibili', 'assente'] as const)('%s: si chiede come sempre', (partecipanti) => {
    expect(consensiRichiesti(base, partecipanti).registrazione).toBe(true);
    expect(consensiRichiesti({ ...base, ...ascolto }, partecipanti).avvisoRegistrazione).toBe(true);
  });
});

describe('trascrizioneDalVideo', () => {
  const evento = { eventType: 'SCHEDULED', recordingEnabled: true, aiTranscriptEnabled: true };
  const sito = { aiPipelineEnabled: true };

  it("vale dove c'e' un video da trascrivere e l'AI e' accesa", () => {
    expect(trascrizioneDalVideo(evento, sito, true, 'visibili')).toBe(true);
    expect(trascrizioneDalVideo(evento, sito, true, 'solo-voce')).toBe(true);
  });

  it('non vale in una chiamata rapida', () => {
    expect(trascrizioneDalVideo({ ...evento, eventType: 'INSTANT' }, sito, true, 'visibili')).toBe(false);
  });

  it("non vale se l'evento non registra o non vuole la trascrizione", () => {
    expect(trascrizioneDalVideo({ ...evento, recordingEnabled: false }, sito, true, 'visibili')).toBe(false);
    expect(trascrizioneDalVideo({ ...evento, aiTranscriptEnabled: false }, sito, true, 'visibili')).toBe(false);
  });

  it('non vale con la pipeline spenta, o se il valore manca', () => {
    expect(trascrizioneDalVideo(evento, { aiPipelineEnabled: false }, true, 'visibili')).toBe(false);
    expect(trascrizioneDalVideo(evento, {}, true, 'visibili')).toBe(false);
  });

  it("non vale dove l'installazione non puo' produrre il video completo", () => {
    expect(trascrizioneDalVideo(evento, sito, false, 'visibili')).toBe(false);
    expect(trascrizioneDalVideo(evento, sito, true, 'assente')).toBe(false);
  });

  it("senza i campi dell'evento non vale", () => {
    expect(trascrizioneDalVideo({}, sito, true, 'visibili')).toBe(false);
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
    expect(consensiRichiesti(senzaTracce, 'solo-voce').tracce).toBe(false);
    expect(consensiRichiesti({ ...senzaTracce, captionsTranscript: true }, 'solo-voce').tracce).toBe(true);
  });

  it("il campo chiede la trascrizione anche senza tracce ne' sottotitoli", () => {
    expect(consensiRichiesti({ ...senzaTracce, trascrizioneVideo: true }, 'solo-voce').tracce).toBe(true);
    expect(consensiRichiesti({ ...senzaTracce, trascrizioneVideo: false }, 'solo-voce').tracce).toBe(false);
  });

  it("non cambia la registrazione ne' l'avviso", () => {
    expect(consensiRichiesti({ ...senzaTracce, ...ascolto, trascrizioneVideo: true }, 'solo-voce')).toEqual({
      registrazione: false,
      avvisoRegistrazione: true,
      tracce: true,
    });
  });

  it("i flag grezzi che la rotta passa con le colonne dell'evento non bastano", () => {
    const colonne = { ...senzaTracce, aiTranscriptEnabled: true, aiPipelineEnabled: true };
    expect(consensiRichiesti(colonne, 'solo-voce').tracce).toBe(false);
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
