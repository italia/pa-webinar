// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

import { PrivacySheet, schedaInSala } from './privacy-sheet';

const t = messages.gdpr.sheet;
const tSala = messages.waiting;

const SCHEDA: SchedaPrivacy = {
  registrazione: {
    modo: 'manuale',
    destinazione: 'PUBLIC',
    chiNonAcconsente: 'restaFuori',
    conduceSempre: false,
  },
  trascrizione: { chiesta: false, sottotitoli: false, tracce: null, dalVideo: false },
  sottotitoli: { attivi: false, testoConservato: false },
  ia: null,
  chat: { attiva: false, domandeAttive: false, esitoDomande: 'nonPubblicate' },
  elencoVisibile: true,
  pseudonimi: false,
  conservazione: { giorniDati: 30, registrazione: { giorni: null, video: true } },
  rubrica: null,
};

let container: HTMLDivElement;
let root: Root;
const errori = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  errori.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  expect(errori).not.toHaveBeenCalled();
});

function disegna(modifiche: Partial<SchedaPrivacy> = {}, testoIa?: string | null) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} onError={errori}>
        <PrivacySheet scheda={{ ...SCHEDA, ...modifiche }} testoIa={testoIa} />
      </NextIntlClientProvider>
    );
  });
  return container.textContent ?? '';
}

const conRegistrazione = (r: Partial<SchedaPrivacy['registrazione']>) =>
  disegna({ registrazione: { ...SCHEDA.registrazione, ...r } });

const IA = {
  sintesi: false,
  traduzione: false,
  doppiaggio: false,
  elaborabileDopo: false,
};

describe('PrivacySheet, la registrazione', () => {
  it.each([
    ['nessuna', t.recording.none],
    ['soloTracce', t.recording.tracksOnly],
    ['manuale', t.recording.manual],
    ['automatica', t.recording.auto],
  ] as const)('modo %s', (modo, testo) => {
    expect(conRegistrazione({ modo })).toContain(testo);
  });

  it.each([
    ['PUBLIC', t.recording.destinationPublic],
    ['REGISTRANTS', t.recording.destinationReserved],
    ['nonDichiarata', t.recording.destinationUnset],
  ] as const)('destinazione %s', (destinazione, testo) => {
    expect(conRegistrazione({ destinazione })).toContain(testo);
  });

  it.each([
    ['restaFuori', t.recording.refuseOut],
    ['soloAscolto', t.recording.refuseListenOnly],
    ['avviso', t.recording.audienceNotice],
    ['avvisoVoce', t.recording.audienceNoticeVoice],
  ] as const)('chi non acconsente: %s', (chiNonAcconsente, testo) => {
    expect(conRegistrazione({ chiNonAcconsente })).toContain(testo);
  });

  it('senza un video non nomina destinazione, video da mettere a disposizione o scadenze', () => {
    const testo = disegna({
      registrazione: {
        modo: 'soloTracce',
        destinazione: null,
        chiNonAcconsente: 'restaFuori',
        conduceSempre: false,
      },
      conservazione: { giorniDati: 30, registrazione: null },
    });
    expect(testo).toContain(t.recording.tracksOnly);
    expect(testo).not.toContain(t.recording.destinationPublic);
    expect(testo).not.toContain(t.recording.destinationReserved);
    expect(testo).not.toContain(t.recording.destinationUnset);
    expect(testo).not.toContain(t.retention.recordingKept);
    expect(testo).not.toContain(t.retention.transcriptKept);
  });

  it('con voce fissa non dice che chi non acconsente resta fuori dal video', () => {
    const testo = conRegistrazione({ chiNonAcconsente: 'soloAscolto' });
    expect(testo).toContain(t.recording.refuseListenOnly);
    expect(testo).not.toContain(t.recording.refuseOut);
  });

  it('nessuna registrazione: una frase sola', () => {
    const testo = disegna({
      registrazione: {
        modo: 'nessuna',
        destinazione: null,
        chiNonAcconsente: null,
        conduceSempre: false,
      },
      conservazione: { giorniDati: 30, registrazione: null },
    });
    expect(testo).toContain(t.recording.none);
    expect(testo).not.toContain(t.recording.refuseOut);
    expect(testo).not.toContain(t.recording.refuseListenOnly);
  });

  it('chi conduce sempre nella registrazione', () => {
    expect(conRegistrazione({})).not.toContain(t.recording.hostsAlways);
    expect(conRegistrazione({ conduceSempre: true })).toContain(t.recording.hostsAlways);
  });
});

describe('PrivacySheet, trascrizione e sottotitoli', () => {
  it('niente da dire: la riga non compare', () => {
    const testo = disegna();
    expect(testo).not.toContain(t.transcript.label);
    expect(testo).not.toContain(t.captions.label);
  });

  it.each([
    [{ chiesta: true, sottotitoli: true, tracce: null, dalVideo: false }, t.transcript.captions],
    [{ chiesta: true, sottotitoli: false, tracce: 'cancellate', dalVideo: false }, t.transcript.tracks],
    [
      { chiesta: true, sottotitoli: false, tracce: 'conservate', dalVideo: false },
      t.transcript.tracksRetained,
    ],
    [{ chiesta: true, sottotitoli: false, tracce: null, dalVideo: true }, t.transcript.fromVideo],
  ] as const)('%o', (trascrizione, testo) => {
    const resa = disegna({ trascrizione });
    expect(resa).toContain(t.transcript.label);
    expect(resa).toContain(testo);
  });

  it('una traccia che si conserva non promette la cancellazione', () => {
    const resa = disegna({
      trascrizione: { chiesta: true, sottotitoli: false, tracce: 'conservate', dalVideo: false },
    });
    expect(resa).not.toContain(t.transcript.tracks);
  });

  it("i sottotitoli riusano il testo dell'avviso in sala", () => {
    expect(disegna({ sottotitoli: { attivi: true, testoConservato: false } })).toContain(
      tSala.captionsNotice
    );
    expect(disegna({ sottotitoli: { attivi: true, testoConservato: true } })).toContain(
      tSala.captionsNoticeTranscript
    );
  });
});

describe('PrivacySheet, intelligenza artificiale', () => {
  it('pipeline spenta: nessuna riga', () => {
    expect(disegna({ ia: null })).not.toContain(t.ai.label);
  });

  it("pipeline accesa: il resoconto c'e' sempre", () => {
    const testo = disegna({ ia: IA });
    expect(testo).toContain(t.ai.report);
    expect(testo).not.toContain(t.ai.summary);
    expect(testo).not.toContain(t.ai.translation);
    expect(testo).not.toContain(t.ai.dubbing);
    expect(testo).not.toContain(t.ai.onRequest);
  });

  it("dice che i testi automatici possono sbagliare, anche sotto il testo dell'amministrazione", () => {
    expect(disegna({ ia: IA })).toContain(t.ai.accuracy);
    expect(disegna({ ia: { ...IA, sintesi: true } }, 'Testo scritto.')).toContain(
      t.ai.accuracy
    );
    expect(disegna({ ia: null })).not.toContain(t.ai.accuracy);
  });

  it("dice cio' che chi organizza puo' chiedere dopo l'evento, prima del resoconto", () => {
    const testo = disegna({ ia: { ...IA, elaborabileDopo: true } });
    expect(testo).toContain(t.ai.onRequest);
    expect(testo.indexOf(t.ai.onRequest)).toBeLessThan(testo.indexOf(t.ai.report));
  });

  it('una frase per ogni elaborazione', () => {
    const testo = disegna({
      ia: { ...IA, sintesi: true, traduzione: true, doppiaggio: true },
    });
    expect(testo).toContain(t.ai.summary);
    expect(testo).toContain(t.ai.translation);
    expect(testo).toContain(t.ai.dubbing);
  });

  const SCRITTO = 'Testo scritto da chi amministra.';

  it("il testo dell'amministrazione sostituisce le frasi sulle elaborazioni, non il resoconto", () => {
    const testo = disegna({ ia: { ...IA, sintesi: true, traduzione: true } }, SCRITTO);
    expect(testo).toContain(SCRITTO);
    expect(testo).not.toContain(t.ai.summary);
    expect(testo).not.toContain(t.ai.translation);
    expect(testo).toContain(t.ai.report);
  });

  it("il testo dell'amministrazione non toglie cio' che si puo' chiedere dopo l'evento", () => {
    const testo = disegna({ ia: { ...IA, elaborabileDopo: true } }, SCRITTO);
    expect(testo).toContain(SCRITTO);
    expect(testo).toContain(t.ai.onRequest);
  });

  it("vale anche se l'unica elaborazione e' la trascrizione", () => {
    expect(
      disegna(
        { ia: IA, trascrizione: { chiesta: true, sottotitoli: false, tracce: null, dalVideo: true } },
        SCRITTO
      )
    ).toContain(SCRITTO);
  });

  it("senza niente da elaborare il testo dell'amministrazione non compare", () => {
    const testo = disegna({ ia: IA }, SCRITTO);
    expect(testo).not.toContain(SCRITTO);
    expect(testo).toContain(t.ai.report);
  });

  it('un testo vuoto vale come assente', () => {
    expect(disegna({ ia: { ...IA, sintesi: true } }, '   ')).toContain(t.ai.summary);
  });

  it("senza pipeline il testo dell'amministrazione non compare", () => {
    expect(disegna({ ia: null }, SCRITTO)).not.toContain(SCRITTO);
  });
});

describe('PrivacySheet, chat e domande', () => {
  it('niente chat e niente domande: la riga non compare', () => {
    expect(disegna()).not.toContain(t.chat.label);
  });

  it('la chat non si pubblica mai', () => {
    const testo = disegna({
      chat: { attiva: true, domandeAttive: false, esitoDomande: 'soloTesto' },
    });
    expect(testo).toContain(t.chat.label);
    expect(testo).toContain(t.chat.messages);
    expect(testo).not.toContain(t.chat.questionsText);
    expect(testo).not.toContain(t.chat.questionsNone);
  });

  it('delle domande si pubblica solo il testo', () => {
    const testo = disegna({
      chat: { attiva: true, domandeAttive: true, esitoDomande: 'soloTesto' },
    });
    expect(testo).toContain(t.chat.questionsText);
    expect(testo).not.toContain(t.chat.questionsNone);
  });

  it('con la registrazione riservata nessuna domanda', () => {
    const testo = disegna({
      chat: { attiva: false, domandeAttive: true, esitoDomande: 'nonPubblicate' },
    });
    expect(testo).toContain(t.chat.label);
    expect(testo).toContain(t.chat.questionsNone);
    expect(testo).not.toContain(t.chat.messages);
    expect(testo).not.toContain(t.chat.questionsText);
  });
});

describe('PrivacySheet, il nome nella trascrizione', () => {
  const SI = { ...SCHEDA.trascrizione, chiesta: true };

  it('dove nessuno chiede la trascrizione non la nomina', () => {
    const testo = disegna({ pseudonimi: true });
    expect(testo).toContain(t.name.pseudonym);
    expect(testo).not.toContain(t.name.pseudonymTranscript);
  });

  it('dove si chiede dice che il nome resta', () => {
    expect(disegna({ pseudonimi: true, trascrizione: SI })).toContain(t.name.pseudonymTranscript);
  });

  it('con il proprio nome non serve dirlo', () => {
    expect(disegna({ trascrizione: SI })).not.toContain(t.name.pseudonymTranscript);
  });

  it('in sala vale anche il consenso gia\' dato, o i sottotitoli accesi dal vivo', () => {
    const adesso = { sottotitoli: false, chat: true, domande: true };
    const base: SchedaPrivacy = { ...SCHEDA, pseudonimi: true };
    expect(schedaInSala(base, adesso).trascrizione.chiesta).toBe(false);
    expect(
      schedaInSala(base, { ...adesso, trascrizioneData: true }).trascrizione.chiesta
    ).toBe(true);
    expect(
      schedaInSala(
        { ...base, sottotitoli: { attivi: false, testoConservato: true } },
        { ...adesso, sottotitoli: true }
      ).trascrizione.chiesta
    ).toBe(true);
  });
});

describe('schedaInSala, la scheda con i flag di adesso', () => {
  const accesi: SchedaPrivacy = {
    ...SCHEDA,
    trascrizione: { chiesta: true, sottotitoli: true, tracce: 'cancellate', dalVideo: false },
    sottotitoli: { attivi: true, testoConservato: true },
    chat: { attiva: true, domandeAttive: true, esitoDomande: 'soloTesto' },
  };
  const conSottotitoli = (scheda: SchedaPrivacy, sottotitoli: boolean) =>
    schedaInSala(scheda, {
      sottotitoli,
      chat: scheda.chat.attiva,
      domande: scheda.chat.domandeAttive,
    });

  it('spenti dal vivo: niente riga, e il testo non diventa trascrizione', () => {
    const dopo = conSottotitoli(accesi, false);
    expect(dopo.sottotitoli).toEqual({ attivi: false, testoConservato: true });
    expect(dopo.trascrizione).toEqual({
      chiesta: true,
      sottotitoli: false,
      tracce: 'cancellate',
      dalVideo: false,
    });
    const testo = disegna(dopo);
    expect(testo).not.toContain(t.captions.label);
    expect(testo).not.toContain(t.transcript.captions);
    expect(testo).toContain(t.transcript.tracks);
  });

  it('accesi dal vivo dove erano spenti: dice che il testo si conserva', () => {
    const spenti = conSottotitoli(accesi, false);
    const testo = disegna(conSottotitoli(spenti, true));
    expect(testo).toContain(tSala.captionsNoticeTranscript);
    expect(testo).toContain(t.transcript.captions);
  });

  it('dove il testo non si conserva resta cosi', () => {
    const dopo = conSottotitoli(
      { ...SCHEDA, sottotitoli: { attivi: false, testoConservato: false } },
      true
    );
    expect(dopo.sottotitoli.attivi).toBe(true);
    expect(dopo.trascrizione.sottotitoli).toBe(false);
    expect(disegna(dopo)).toContain(tSala.captionsNotice);
  });

  it('Q&A acceso dal vivo: dice cosa si pubblica delle domande', () => {
    const chiuso: SchedaPrivacy = {
      ...accesi,
      chat: { ...accesi.chat, domandeAttive: false },
    };
    expect(disegna(chiuso)).not.toContain(t.chat.questionsText);
    const testo = disegna(
      schedaInSala(chiuso, { sottotitoli: true, chat: true, domande: true })
    );
    expect(testo).toContain(t.chat.questionsText);
  });

  it('chat e Q&A spenti dal vivo: la riga sparisce', () => {
    const testo = disegna(
      schedaInSala(accesi, { sottotitoli: true, chat: false, domande: false })
    );
    expect(testo).not.toContain(t.chat.label);
  });

  it('chat spenta dal vivo: restano le domande', () => {
    const testo = disegna(
      schedaInSala(accesi, { sottotitoli: true, chat: false, domande: true })
    );
    expect(testo).not.toContain(t.chat.messages);
    expect(testo).toContain(t.chat.questionsText);
  });

  describe('per chi conduce', () => {
    const conScheda = (registrazione: Partial<SchedaPrivacy['registrazione']>) =>
      schedaInSala(
        {
          ...accesi,
          pseudonimi: true,
          registrazione: { ...accesi.registrazione, ...registrazione },
        },
        { sottotitoli: true, chat: true, domande: true, conduce: true }
      );

    it('compare con il proprio nome anche dove il pubblico ha uno pseudonimo', () => {
      const testo = disegna(conScheda({ chiNonAcconsente: 'restaFuori' }));
      expect(testo).toContain(t.name.real);
      expect(testo).not.toContain(t.name.pseudonym);
    });

    it.each(['soloAscolto', 'avviso', 'avvisoVoce', 'restaFuori'] as const)(
      'dove c\'e\' un video non legge cosa succede a chi nega («%s»): e\' nel video',
      (chiNonAcconsente) => {
        const testo = disegna(conScheda({ chiNonAcconsente, conduceSempre: true }));
        expect(testo).toContain(t.recording.hostsAlways);
        expect(testo).not.toContain(t.recording.refuseOut);
        expect(testo).not.toContain(t.recording.refuseListenOnly);
        expect(testo).not.toContain(t.recording.audienceNotice);
        expect(testo).not.toContain(t.recording.audienceNoticeVoice);
      }
    );

    it('senza un video non legge una scelta che non gli si offre: restano le tracce', () => {
      const testo = disegna(conScheda({ chiNonAcconsente: 'avvisoVoce', conduceSempre: false }));
      expect(testo).not.toContain(t.recording.refuseOut);
      expect(testo).not.toContain(t.recording.audienceNoticeVoice);
    });

    it('la scheda di chi partecipa non cambia', () => {
      const pubblico = schedaInSala(
        {
          ...accesi,
          pseudonimi: true,
          registrazione: { ...accesi.registrazione, chiNonAcconsente: 'soloAscolto' },
        },
        { sottotitoli: true, chat: true, domande: true }
      );
      expect(pubblico.pseudonimi).toBe(true);
      expect(pubblico.registrazione.chiNonAcconsente).toBe('soloAscolto');
    });
  });

  it('la rubrica non si promette: in sala non c\'e\' la casella', () => {
    const dopo = conSottotitoli({ ...accesi, rubrica: { mesi: 24 } }, true);
    expect(dopo.rubrica).toBeNull();
    expect(disegna(dopo)).not.toContain(t.addressBook.label);
  });

  it('il resto della scheda non cambia', () => {
    expect(conSottotitoli(accesi, false)).toMatchObject({
      registrazione: accesi.registrazione,
      conservazione: accesi.conservazione,
      elencoVisibile: accesi.elencoVisibile,
      pseudonimi: accesi.pseudonimi,
    });
  });
});

describe('PrivacySheet, gli altri fatti', () => {
  it('elenco e nome', () => {
    const aperta = disegna();
    expect(aperta).toContain(t.list.visible);
    expect(aperta).toContain(t.name.real);

    const pseudonimi = disegna({ elencoVisibile: false, pseudonimi: true });
    expect(pseudonimi).toContain(t.list.hidden);
    expect(pseudonimi).toContain(t.name.pseudonym);
    expect(pseudonimi).not.toContain(t.name.real);
  });

  it('i giorni, al plurale e al singolare', () => {
    expect(disegna({ conservazione: { giorniDati: 30, registrazione: null } })).toContain(
      '30 giorni dopo'
    );
    expect(disegna({ conservazione: { giorniDati: 1, registrazione: null } })).toContain(
      '1 giorno dopo'
    );
  });

  it('senza una scadenza la registrazione resta, e non compare un numero di giorni', () => {
    const testo = disegna();
    expect(testo).toContain(t.retention.recordingKept);
    expect(testo).not.toContain('dopo la pubblicazione');
  });

  it('con una scadenza la dice, dalla fine o dalla pubblicazione', () => {
    const testo = disegna({
      conservazione: { giorniDati: 30, registrazione: { giorni: 90, video: true } },
    });
    expect(testo).toContain('si cancellano 90 giorni dopo la fine dell’evento'.replace('’', "'"));
    expect(testo).toContain('dopo la pubblicazione');
    expect(testo).not.toContain(t.retention.recordingKept);
  });

  it('senza video parla della trascrizione', () => {
    const resta = disegna({
      conservazione: { giorniDati: 30, registrazione: { giorni: null, video: false } },
    });
    expect(resta).toContain(t.retention.transcriptKept);
    expect(resta).not.toContain(t.retention.recordingKept);
    const scade = disegna({
      conservazione: { giorniDati: 30, registrazione: { giorni: 7, video: false } },
    });
    expect(scade).toContain('La trascrizione si cancella 7 giorni dopo');
  });

  it('la rubrica compare solo dove si propone, con i suoi mesi', () => {
    expect(disegna()).not.toContain(t.addressBook.label);
    const testo = disegna({ rubrica: { mesi: 24 } });
    expect(testo).toContain(t.addressBook.label);
    expect(testo).toContain('24 mesi dal consenso');
  });
});

describe('PrivacySheet, la struttura', () => {
  it('sezione con titolo e una voce di elenco per ogni fatto', () => {
    disegna();
    const sezione = container.querySelector('section');
    const titolo = container.querySelector('h2');
    expect(titolo?.textContent).toBe(t.title);
    expect(sezione?.getAttribute('aria-labelledby')).toBe(titolo?.id);
    expect(container.querySelector('p')?.textContent).toBe(t.intro);
    // Registrazione, elenco, nome e conservazione.
    expect(container.querySelectorAll('ul.wr-facts--frasi > li.wr-fact')).toHaveLength(4);
  });

  it("le icone sono decorative e vengono dallo sprite dell'applicazione", () => {
    disegna();
    expect(container.querySelector('.wr-fact__icon')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(container.querySelector('.wr-fact__icon use')?.getAttribute('href')).toContain(
      '/svg/sprites.svg#it-video'
    );
  });

  it("due schede nella stessa pagina non si contendono l'id del titolo", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} onError={errori}>
          <PrivacySheet scheda={SCHEDA} />
          <PrivacySheet scheda={SCHEDA} />
        </NextIntlClientProvider>
      );
    });
    const [primo, secondo] = container.querySelectorAll('h2');
    expect(primo?.id).toBeTruthy();
    expect(primo?.id).not.toBe(secondo?.id);
  });
});
