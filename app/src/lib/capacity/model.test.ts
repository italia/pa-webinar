import { describe, expect, it } from 'vitest';

import { VIDEO_QUALITY_PRESETS } from '@/lib/jitsi/config';

import {
  ISTANZA_PREDEFINITA,
  MAX_RIQUADRI,
  SCHERMO_MBPS,
  durataInOre,
  livelloCapacita,
  profiloFlussi,
  stimaCapacita,
  type CapacitaIstanza,
  type InputCapacita,
  type TaraturaCapacita,
} from './model';

/**
 * Il modello della capacita': tarato sulle misure di un ponte di 15 core,
 * monotono nei partecipanti, limitato dalla griglia e dal preset, con le
 * soglie e il suggerimento per alleggerire l'evento.
 */

const ponte15: CapacitaIstanza = {
  ...ISTANZA_PREDEFINITA,
  coresPerBridge: 15,
  numLoudest: 5,
  instanceBridges: 1,
};

const riunione: InputCapacita = {
  maxParticipants: 150,
  expectedSenderRatioPct: 100,
  participantsCanStartVideo: true,
  participantsCanUnmute: true,
  presenters: 1,
  videoQuality: 'HIGH',
  recordingEnabled: false,
  liveCaptionsEnabled: false,
  durationHours: 1.5,
};

const webinar: InputCapacita = {
  ...riunione,
  maxParticipants: 300,
  participantsCanStartVideo: false,
  participantsCanUnmute: false,
  presenters: 3,
};

// I partecipanti sintetici delle prove mandano 180p a 15 fotogrammi al secondo
// (circa 48 kbps in pacchetti da 9 al secondo) e ricevono tutti gli altri.
const robot = (microfoniAperti: number): TaraturaCapacita => ({
  flussi: {
    lastN: -1,
    riquadro: 0.048,
    riquadroPps: 9,
    medio: 0.048,
    primoPiano: 0.048,
    picco: 0.05,
    simulcast: 0.05,
    voce: 0.037,
    maxRiquadri: 27,
  },
  microfoniAperti,
  schermo: false,
});

const prova = { ...riunione, maxParticipants: 28 };

function vicino(misurato: number, stimato: number, tolleranza = 0.1) {
  expect(Math.abs(stimato - misurato) / misurato).toBeLessThanOrEqual(tolleranza);
}

describe('taratura sulle misure del ponte', () => {
  it('28 webcam, microfoni chiusi: 0,68 core, 36 Mbps e 6,9 mila pacchetti al secondo in uscita', () => {
    const s = stimaCapacita(prova, ponte15, robot(0));
    vicino(0.68, s.ponte.core);
    vicino(36, s.ponte.outMbps);
    vicino(6900, s.ponte.outPps);
  });

  it('28 microfoni aperti, inoltrate le 5 voci piu forti: 1,03 core, 41 Mbps, 13,8 mila pacchetti', () => {
    const s = stimaCapacita(prova, ponte15, robot(28));
    expect(s.vociInoltrate).toBe(5);
    vicino(1.03, s.ponte.core);
    vicino(41, s.ponte.outMbps);
    vicino(13_800, s.ponte.outPps);
  });

  it('28 microfoni aperti, tutte le voci inoltrate: 2,35 core e 45-48 mila pacchetti', () => {
    const s = stimaCapacita(prova, { ...ponte15, numLoudest: 0 }, robot(28));
    expect(s.vociInoltrate).toBe(28);
    vicino(2.35, s.ponte.core);
    vicino(46_500, s.ponte.outPps);
  });
});

describe('stimaCapacita', () => {
  it('cresce con i partecipanti, per ogni qualita e quota di webcam', () => {
    for (const videoQuality of VIDEO_QUALITY_PRESETS) {
      for (const quota of [0, 10, 50, 100]) {
        let prima = { core: 0, out: 0 };
        for (let n = 2; n <= 5000; n += n < 60 ? 1 : 97) {
          const s = stimaCapacita(
            {
              ...riunione,
              videoQuality,
              expectedSenderRatioPct: quota,
              maxParticipants: n,
            },
            ponte15
          );
          expect(s.ponte.core).toBeGreaterThanOrEqual(prima.core);
          expect(s.ponte.outMbps).toBeGreaterThanOrEqual(prima.out);
          prima = { core: s.ponte.core, out: s.ponte.outMbps };
        }
      }
    }
  });

  it('chi guarda non riceve di piu oltre le 25 webcam della griglia', () => {
    const trenta = stimaCapacita({ ...riunione, maxParticipants: 30 }, ponte15);
    const cento = stimaCapacita({ ...riunione, maxParticipants: 100 }, ponte15);
    expect(trenta.videoVisti).toBe(MAX_RIQUADRI);
    expect(cento.videoVisti).toBe(MAX_RIQUADRI);
    expect(cento.perPartecipante.downMbps).toBe(trenta.perPartecipante.downMbps);
  });

  it('la quota di webcam cambia la banda di chi guarda e il carico', () => {
    const poche = stimaCapacita(
      { ...riunione, maxParticipants: 40, expectedSenderRatioPct: 10 },
      ponte15
    );
    const tutte = stimaCapacita(
      { ...riunione, maxParticipants: 40, expectedSenderRatioPct: 100 },
      ponte15
    );
    expect(tutte.webcam).toBe(40);
    expect(poche.webcam).toBe(4);
    expect(tutte.perPartecipante.downMbps).toBeGreaterThan(
      poche.perPartecipante.downMbps
    );
    expect(tutte.ponte.core).toBeGreaterThan(poche.ponte.core);
  });

  it('una quota assente e quella del sito', () => {
    const sito = stimaCapacita(
      { ...riunione, expectedSenderRatioPct: null },
      {
        ...ponte15,
        siteCameraPct: 10,
      }
    );
    expect(sito.quotaWebcam).toBe(10);
    expect(sito.webcam).toBe(15);
  });

  it('Risparmio dati ferma i video visti a 6; Massima pesa piu di Alta', () => {
    const risparmio = stimaCapacita({ ...riunione, videoQuality: 'SAVE_DATA' }, ponte15);
    expect(risparmio.videoVisti).toBe(6);
    const alta = stimaCapacita({ ...riunione, maxParticipants: 30 }, ponte15);
    const massima = stimaCapacita(
      { ...riunione, maxParticipants: 30, videoQuality: 'MAX' },
      ponte15
    );
    expect(massima.ponte.core).toBeGreaterThan(alta.ponte.core);
    expect(massima.ponte.inMbps).toBeGreaterThan(alta.ponte.inMbps);
    // Senza sospensione degli strati, ogni webcam li manda tutti.
    expect(massima.perPartecipante.upSempreTutti).toBe(true);
    expect(massima.perPartecipante.upMbps).toBe(massima.perPartecipante.upPiccoMbps);
  });

  it('una qualita assente e quella del sito', () => {
    const s = stimaCapacita(
      { ...riunione, videoQuality: null },
      {
        ...ponte15,
        siteVideoQuality: 'BALANCED',
      }
    );
    expect(s.qualita).toBe('BALANCED');
  });

  it('le voci inoltrate sono al piu quelle piu forti; senza il filtro, tutti i microfoni aperti', () => {
    const conFiltro = stimaCapacita({ ...riunione, maxParticipants: 30 }, ponte15);
    expect(conFiltro.microfoniAperti).toBe(10);
    expect(conFiltro.vociInoltrate).toBe(5);
    const senza = stimaCapacita(
      { ...riunione, maxParticipants: 30 },
      { ...ponte15, numLoudest: 0 }
    );
    expect(senza.vociInoltrate).toBe(10);
    expect(senza.ponte.outPps).toBeGreaterThan(conFiltro.ponte.outPps);
  });

  it('senza microfoni dei partecipanti parlano solo le persone che presentano', () => {
    const s = stimaCapacita(webinar, ponte15);
    expect(s.microfoniAperti).toBe(3);
    expect(s.vociInoltrate).toBe(3);
  });

  it('senza video dei partecipanti le webcam sono quelle di chi presenta', () => {
    const s = stimaCapacita({ ...webinar, expectedSenderRatioPct: 100 }, ponte15);
    expect(s.webcam).toBe(3);
    expect(s.quotaWebcam).toBe(0);
    expect(s.disposizione).toBe('primoPiano');
  });

  it('con poche webcam lo schermo condiviso prende il primo piano; in griglia lo schermo e sei riquadri', () => {
    const alta = profiloFlussi('HIGH');
    const primo = stimaCapacita(webinar, ponte15);
    expect(primo.perPartecipante.downMbps).toBeCloseTo(
      Math.max(SCHERMO_MBPS, alta.primoPiano) + 2 * alta.riquadro + 3 * alta.voce
    );
    const f = profiloFlussi('SAVE_DATA');
    const piccola = {
      ...riunione,
      maxParticipants: 8,
      participantsCanUnmute: false,
      videoQuality: 'SAVE_DATA' as const,
    };
    const conSchermo = stimaCapacita(piccola, ponte15);
    expect(conSchermo.disposizione).toBe('griglia');
    expect(conSchermo.videoVisti).toBe(6);
    expect(conSchermo.perPartecipante.downMbps).toBeCloseTo(
      SCHERMO_MBPS + 6 * f.riquadro + f.voce
    );
    // Senza schermo, la griglia: mai meno di quella da quattro riquadri medi.
    const senzaSchermo = stimaCapacita(piccola, ponte15, { schermo: false });
    expect(senzaSchermo.perPartecipante.downMbps).toBeCloseTo(4 * f.medio + f.voce);
  });

  it('da telefono al piu quattro video', () => {
    const s = stimaCapacita(riunione, ponte15);
    expect(s.perPartecipante.telefonoVideo).toBe(4);
    expect(s.perPartecipante.telefonoMbps).toBeLessThan(s.perPartecipante.downMbps);
  });

  it('valori fuori misura o mancanti non danno NaN', () => {
    const strani = stimaCapacita(
      {
        ...riunione,
        maxParticipants: Number.NaN,
        expectedSenderRatioPct: 250,
        presenters: Number.NaN,
        durationHours: Number.NaN,
        recordingEnabled: true,
      },
      {
        ...ponte15,
        coresPerBridge: Number.NaN,
        instanceBridges: Number.NaN,
        stressWarn: Number.NaN,
      }
    );
    expect(strani.partecipanti).toBe(2);
    expect(strani.quotaWebcam).toBe(100);
    expect(strani.presentatori).toBe(1);
    const numeri =
      JSON.stringify(strani).match(/-?\d+(\.\d+)?(e-?\d+)?|NaN|Infinity/g) ?? [];
    expect(numeri).not.toContain('NaN');
    expect(numeri).not.toContain('Infinity');
    expect(
      stimaCapacita({ ...riunione, maxParticipants: 99_999 }, ponte15).partecipanti
    ).toBe(5000);
    expect(
      stimaCapacita({ ...riunione, expectedSenderRatioPct: -5 }, ponte15).quotaWebcam
    ).toBe(0);
  });

  it('chi registra conta come un partecipante in piu, e lo spazio va con la durata', () => {
    const senza = stimaCapacita(webinar, ponte15);
    const con = stimaCapacita({ ...webinar, recordingEnabled: true }, ponte15);
    expect(con.ponte.outMbps).toBeCloseTo(
      senza.ponte.outMbps + senza.perPartecipante.downMbps
    );
    expect(con.registrazione?.core).toBe(1.5);
    // Da 4 a 10 Mbps per un'ora e mezza.
    expect(con.registrazione?.gbMin).toBeCloseTo((4 * 3600 * 1.5) / 8 / 1024);
    expect(con.registrazione?.gbMax).toBeCloseTo((10 * 3600 * 1.5) / 8 / 1024);
    expect(senza.registrazione).toBeNull();
  });

  it('i sottotitoli contano solo dove ci sono, fino alle voci che il servizio trascrive', () => {
    const accesi = { ...riunione, liveCaptionsEnabled: true };
    expect(stimaCapacita(accesi, ponte15).sottotitoli).toBeNull();
    const s = stimaCapacita(accesi, {
      ...ponte15,
      captionsAvailable: true,
      captionsMaxStreams: 4,
    });
    expect(s.sottotitoli).toEqual({ core: 4, voci: 4 });
    const pochi = stimaCapacita(
      { ...webinar, liveCaptionsEnabled: true },
      { ...ponte15, captionsAvailable: true, captionsMaxStreams: 4 }
    );
    expect(pochi.sottotitoli?.voci).toBe(3);
  });

  it('la durata viene dalle date, quando ci sono', () => {
    expect(durataInOre('2026-10-20T10:00', '2026-10-20T11:30')).toBeCloseTo(1.5);
    expect(durataInOre('2026-10-20T11:00', '2026-10-20T10:00')).toBeNull();
    expect(durataInOre('', '2026-10-20T10:00')).toBeNull();
    expect(durataInOre('non una data', '2026-10-20T10:00')).toBeNull();
  });
});

describe('livello e ponti', () => {
  const s = { attenzione: 0.5, critica: 0.7 };

  it('il livello cambia esattamente alle soglie', () => {
    expect(livelloCapacita(0.4999, s)).toBe('ampio');
    expect(livelloCapacita(0.5, s)).toBe('attenzione');
    expect(livelloCapacita(0.6999, s)).toBe('attenzione');
    expect(livelloCapacita(0.7, s)).toBe('limite');
    expect(livelloCapacita(1, s)).toBe('limite');
    expect(livelloCapacita(1.0001, s)).toBe('nonBasta');
  });

  it('una soglia critica sotto quella di attenzione vale come l attenzione', () => {
    const r = stimaCapacita(riunione, { ...ponte15, stressWarn: 60, stressCritical: 40 });
    expect(r.ponte.soglie).toEqual({ attenzione: 0.6, critica: 0.6 });
  });

  it('senza ponti collegati un evento resta su un ponte, anche quando non ci sta', () => {
    const r = stimaCapacita(
      { ...webinar, maxParticipants: 1000 },
      { ...ponte15, instanceBridges: 6 }
    );
    expect(r.ponte.livello).toBe('nonBasta');
    expect(r.ponte.ponti).toBe(1);
    expect(r.ponte.entra).toBe(false);
    expect(r.istanza.ponti).toBe(6);
  });

  it('con i ponti collegati usa i ponti che servono, fino a quelli dell istanza', () => {
    const grande = { ...webinar, maxParticipants: 1000 };
    const r = stimaCapacita(grande, { ...ponte15, cascading: true, instanceBridges: 6 });
    expect(r.ponte.ponti).toBe(Math.ceil(r.ponte.carico / 0.7));
    expect(r.ponte.ponti).toBeGreaterThan(1);
    expect(r.ponte.entra).toBe(true);
    const pochi = stimaCapacita(grande, {
      ...ponte15,
      cascading: true,
      instanceBridges: 2,
    });
    expect(pochi.ponte.ponti).toBe(2);
    expect(pochi.ponte.entra).toBe(false);
  });

  it('il carico e sui core del ponte dell istanza', () => {
    const piccolo = stimaCapacita(
      { ...riunione, maxParticipants: 100 },
      { ...ponte15, coresPerBridge: 3 }
    );
    expect(piccolo.ponte.carico).toBeCloseTo(piccolo.ponte.core / (3 * 0.9));
    expect(piccolo.ponte.livello).toBe('nonBasta');
  });
});

describe('suggerimento', () => {
  it('con molte webcam propone una qualita piu bassa e dice che spegnerne meta non aiuta', () => {
    const r = stimaCapacita(riunione, ponte15);
    expect(r.ponte.livello).toBe('attenzione');
    expect(r.suggerimento).toMatchObject({ tipo: 'qualita', qualita: 'BALANCED' });
    expect(r.suggerimento?.carico).toBeLessThan(0.5);
    expect(r.webcamNonAiutano).toBe(true);
  });

  it('quando la qualita non basta propone meno webcam', () => {
    const r = stimaCapacita(
      { ...riunione, maxParticipants: 30, videoQuality: 'SAVE_DATA' },
      { ...ponte15, coresPerBridge: 2 }
    );
    expect(r.suggerimento).toMatchObject({ tipo: 'webcam' });
    expect(r.suggerimento?.carico).toBeLessThan(0.5);
    expect(r.webcamNonAiutano).toBe(false);
  });

  it('un webinar troppo grande per un ponte: il numero di partecipanti che ci sta', () => {
    const r = stimaCapacita({ ...webinar, maxParticipants: 1000 }, ponte15);
    expect(r.suggerimento?.tipo).toBe('partecipanti');
    const n = r.suggerimento?.tipo === 'partecipanti' ? r.suggerimento.partecipanti : 0;
    expect(
      stimaCapacita({ ...webinar, maxParticipants: n }, ponte15).ponte.carico
    ).toBeLessThan(0.5);
    expect(
      stimaCapacita({ ...webinar, maxParticipants: n + 1 }, ponte15).ponte.carico
    ).toBeGreaterThanOrEqual(0.5);
  });

  it('con margine ampio non suggerisce niente', () => {
    const r = stimaCapacita({ ...riunione, maxParticipants: 30 }, ponte15);
    expect(r.ponte.livello).toBe('ampio');
    expect(r.suggerimento).toBeNull();
    expect(r.webcamNonAiutano).toBe(false);
  });
});
