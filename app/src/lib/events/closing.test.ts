import { describe, expect, it } from 'vitest';

import { statoChiusura, type DatiChiusura, type VoceChiusura } from './closing';

const FINE = new Date('2026-10-10T12:00:00Z');
const ORA = 3_600_000;
const GIORNO = 24 * ORA;
const DOPO_UN_GIORNO = FINE.getTime() + GIORNO;

const base: DatiChiusura = {
  status: 'ENDED',
  eventType: 'SCHEDULED',
  endsAt: FINE,
  fineEffettiva: null,
  dataRetentionDays: 30,
  recordingEnabled: true,
  recordingUrl: null,
  recordingPublished: false,
  youtubeUrl: null,
  transcriptPublished: false,
  captionsTranscriptEnabled: false,
  trascrizione: null,
  trascrizioneInLavorazione: false,
  pipelineAi: true,
  resocontoGenerato: false,
  resocontoPubblicato: false,
  resocontoInLavorazione: false,
  messaggi: 0,
  domande: 0,
  sondaggi: 0,
  nuvole: 0,
  materialiDopo: 0,
  postEventShowMaterials: true,
  feedbackEnabled: true,
  emailValutazioni: true,
  emailValutazioniInviataIl: null,
  valutazioni: 0,
  postEventPublic: true,
  postEventPublicUntil: null,
  libraryListed: false,
};

function voce(
  d: Partial<DatiChiusura>,
  v: VoceChiusura,
  { adesso = DOPO_UN_GIORNO, staff = true }: { adesso?: number; staff?: boolean } = {}
) {
  return statoChiusura({ ...base, ...d }, { adesso, staff }).voci.find(
    (x) => x.voce === v
  )!;
}

describe("chiudi l'evento — registrazione", () => {
  it('con il file e non pubblicata: da fare; pubblicata o su YouTube: fatto', () => {
    expect(voce({ recordingUrl: 'https://x/v.mp4' }, 'registrazione').stato).toBe(
      'da-fare'
    );
    expect(
      voce({ recordingUrl: 'https://x/v.mp4', recordingPublished: true }, 'registrazione')
        .stato
    ).toBe('fatto');
    expect(voce({ youtubeUrl: 'https://youtu.be/x' }, 'registrazione').stato).toBe(
      'fatto'
    );
  });

  it('senza file: si aspetta qualche ora, poi si dice che non c’e’', () => {
    expect(voce({}, 'registrazione', { adesso: FINE.getTime() + ORA })).toMatchObject({
      stato: 'in-corso',
      caso: 'inArrivo',
    });
    expect(voce({}, 'registrazione')).toMatchObject({
      stato: 'non-serve',
      caso: 'nessunFile',
    });
  });

  it('registrazione non prevista: non serve', () => {
    expect(voce({ recordingEnabled: false }, 'registrazione')).toMatchObject({
      stato: 'non-serve',
      caso: 'spenta',
    });
  });
});

describe("chiudi l'evento — trascrizione", () => {
  const ai = { recordingId: 'r1', origine: 'ai' as const };

  it('pronta e non pubblicata: da fare per lo staff, con la registrazione da aprire', () => {
    expect(voce({ trascrizione: ai }, 'trascrizione')).toMatchObject({
      stato: 'da-fare',
      caso: 'prontaAi',
      recordingId: 'r1',
    });
  });

  it('con il solo link del moderatore non e’ da fare: la fa lo staff', () => {
    expect(voce({ trascrizione: ai }, 'trascrizione', { staff: false })).toMatchObject({
      stato: 'non-serve',
      caso: 'soloStaff',
    });
  });

  it('la pagina pubblica la mostra anche quando e’ pubblicato il video', () => {
    expect(
      voce({ trascrizione: ai, recordingPublished: true }, 'trascrizione').stato
    ).toBe('fatto');
  });

  it('senza pipeline e senza trascrizione dai sottotitoli non si vede: non serve', () => {
    expect(
      voce(
        {
          trascrizione: { recordingId: 'r1', origine: 'sottotitoli' },
          transcriptPublished: true,
          pipelineAi: false,
        },
        'trascrizione'
      ).caso
    ).toBe('nessuna');
  });

  it('un lavoro in corso vince su una trascrizione non pubblicata', () => {
    expect(
      voce({ trascrizione: ai, trascrizioneInLavorazione: true }, 'trascrizione').stato
    ).toBe('in-corso');
  });
});

describe("chiudi l'evento — resoconto", () => {
  it('senza pipeline non serve; con la pipeline va generato e poi pubblicato', () => {
    expect(voce({ pipelineAi: false }, 'resoconto').stato).toBe('non-serve');
    expect(voce({}, 'resoconto').caso).toBe('daGenerare');
    expect(voce({ resocontoGenerato: true }, 'resoconto').caso).toBe('daPubblicare');
    expect(
      voce({ resocontoGenerato: true, resocontoPubblicato: true }, 'resoconto').stato
    ).toBe('fatto');
  });

  it('con il solo link del moderatore: lo fa lo staff', () => {
    expect(voce({}, 'resoconto', { staff: false })).toMatchObject({
      stato: 'non-serve',
      caso: 'soloStaff',
    });
  });
});

describe("chiudi l'evento — sala, materiali, valutazioni, pagina", () => {
  it('la sala si racconta, non chiede niente', () => {
    expect(voce({ messaggi: 10, domande: 3 }, 'sala')).toMatchObject({
      stato: 'fatto',
      numeri: { messaggi: 10, domande: 3 },
    });
    expect(voce({}, 'sala').stato).toBe('non-serve');
  });

  it('materiali: visibili, nascosti dalla pagina, assenti', () => {
    expect(voce({ materialiDopo: 2 }, 'materiali')).toMatchObject({
      stato: 'fatto',
      numeri: { materiali: 2 },
    });
    expect(
      voce({ materialiDopo: 2, postEventShowMaterials: false }, 'materiali')
    ).toMatchObject({
      stato: 'da-fare',
      caso: 'nascosti',
    });
    expect(voce({}, 'materiali')).toMatchObject({ stato: 'non-serve', caso: 'nessuno' });
    // Su una pagina ritirata i materiali nascosti non cambiano niente.
    expect(
      voce(
        { materialiDopo: 2, postEventShowMaterials: false, postEventPublic: false },
        'materiali'
      ).stato
    ).toBe('non-serve');
  });

  it('valutazioni: email in partenza, inviata, spenta entro la settimana, raccolte dopo', () => {
    expect(voce({}, 'valutazioni').caso).toBe('emailInPartenza');
    expect(voce({ emailValutazioniInviataIl: new Date() }, 'valutazioni').stato).toBe(
      'fatto'
    );
    expect(voce({ emailValutazioni: false }, 'valutazioni').stato).toBe('da-fare');
    expect(
      voce({ emailValutazioni: false }, 'valutazioni', {
        adesso: FINE.getTime() + 8 * GIORNO,
      }).caso
    ).toBe('raccolte');
    expect(voce({ feedbackEnabled: false }, 'valutazioni').stato).toBe('non-serve');
  });

  it('un evento archiviato non manda l’email: niente «in partenza»', () => {
    expect(voce({ status: 'ARCHIVED' }, 'valutazioni').caso).toBe('raccolte');
  });

  it('pagina: visibile, nella libreria solo con il video, privata, scaduta, archiviata', () => {
    expect(voce({}, 'pagina').caso).toBe('visibile');
    expect(voce({ libraryListed: true }, 'pagina').caso).toBe('libreriaSenzaVideo');
    expect(
      voce({ libraryListed: true, youtubeUrl: 'https://youtu.be/x' }, 'pagina').caso
    ).toBe('nellaLibreria');
    expect(voce({ postEventPublic: false }, 'pagina').caso).toBe('privata');
    expect(
      voce({ postEventPublicUntil: new Date(FINE.getTime() + ORA) }, 'pagina').caso
    ).toBe('scaduta');
    expect(voce({ status: 'ARCHIVED' }, 'pagina').stato).toBe('non-serve');
  });

  it('conta le voci da fare', () => {
    const s = statoChiusura(
      { ...base, recordingUrl: 'https://x/v.mp4' },
      { adesso: DOPO_UN_GIORNO }
    );
    // registrazione da pubblicare, resoconto da generare
    expect(s.daFare).toBe(2);
  });
});

describe("chiudi l'evento — cio' che non si puo' piu' fare", () => {
  const ai = { recordingId: 'r1', origine: 'ai' as const };

  it("evento archiviato: trascrizione e resoconto non si pubblicano piu' (la pagina non e' pubblica)", () => {
    expect(voce({ status: 'ARCHIVED', trascrizione: ai }, 'trascrizione').caso).toBe('nonPiu');
    expect(voce({ status: 'ARCHIVED', resocontoGenerato: true }, 'resoconto').caso).toBe('nonPiu');
  });

  it("dati scaduti: il resoconto non si genera piu', ma se c'e' si pubblica ancora", () => {
    const dopo = { adesso: FINE.getTime() + 31 * GIORNO };
    expect(voce({}, 'resoconto', dopo).caso).toBe('nonPiu');
    expect(voce({ resocontoGenerato: true }, 'resoconto', dopo).caso).toBe('daPubblicare');
    expect(voce({ trascrizione: ai }, 'trascrizione', dopo).stato).toBe('da-fare');
  });

  it("pipeline spenta: un lavoro rimasto in coda non tiene la trascrizione «in corso»", () => {
    expect(
      voce(
        {
          pipelineAi: false,
          captionsTranscriptEnabled: true,
          trascrizione: { recordingId: 'r2', origine: 'sottotitoli' },
          trascrizioneInLavorazione: true,
        },
        'trascrizione',
      ).caso,
    ).toBe('prontaSottotitoli');
  });

  it("il file si aspetta dalla chiusura vera della sala, non dall'orario", () => {
    const chiusa = new Date(FINE.getTime() - 3 * ORA);
    expect(voce({ fineEffettiva: chiusa }, 'registrazione', { adesso: FINE.getTime() + ORA }).caso).toBe('nessunFile');
    const tardi = new Date(FINE.getTime() + 5 * ORA);
    expect(voce({ fineEffettiva: tardi }, 'registrazione', { adesso: FINE.getTime() + 6 * ORA }).caso).toBe('inArrivo');
  });

  it("materiali nascosti su una pagina che non si vede: non chiedono niente, ma si dice che ci sono", () => {
    expect(voce({ materialiDopo: 2, postEventShowMaterials: false, postEventPublic: false }, 'materiali')).toMatchObject({
      stato: 'non-serve',
      caso: 'nascosti',
    });
  });
});
