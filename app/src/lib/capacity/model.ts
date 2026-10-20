/**
 * Quanto pesa un evento sul ponte video e sulla rete: un modello per flussi e
 * pacchetti, puro, che usano il pannello della capacita' (nel wizard e sulla
 * pagina dell'evento), la riga del riepilogo e la stima salvata con l'evento.
 *
 * Il ponte (Jitsi Videobridge) non mescola niente: inoltra flussi. A chi guarda
 * manda i video che vede (al piu' la griglia, o il «lastN» del preset) e le
 * voci che sente (solo le piu' forti, se l'instradamento delle voci piu' forti
 * e' acceso); da chi ha la webcam riceve lo strato che qualcuno guarda, e tutti
 * gli strati da chi e' in primo piano. Il costo in CPU segue i pacchetti al
 * secondo piu' dei megabit, e la stima e' una retta su entrambi (entrata piu'
 * uscita), tarata su misure di un ponte di 15 core entro il 7% circa:
 *
 *   core ≈ 0,10 + 0,038 × migliaia di pacchetti/s + 0,007 × Mbps
 *
 * Il carico e' quei core sul 90% dei core del ponte (la soglia della CPU oltre
 * cui il ponte si dichiara sotto sforzo), confrontato con le soglie di
 * attenzione e critica del sito. Senza ponti collegati un evento resta su un
 * solo ponte: la domanda e' se ci sta.
 *
 * Lo scaler non usa ancora questo modello: dimensiona i ponti con
 * lib/jvb-sizing.
 */

import {
  DEFAULT_VIDEO_QUALITY_PRESET,
  VIDEO_QUALITY_PRESETS,
  videoQualityBudget,
  type VideoQualityPreset,
} from '@/lib/jitsi/config';

/** Il campo «Partecipanti attesi» va da 2 a 5000. */
export const PARTECIPANTI_MIN = 2;
export const PARTECIPANTI_MAX = 5000;
/** I riquadri di una griglia: oltre, nessuno ne vede di piu'. */
export const MAX_RIQUADRI = 25;
/** Fino a tre webcam la sala mostra chi parla in primo piano; oltre, la griglia. */
export const WEBCAM_PRIMO_PIANO = 3;
/** Con la griglia, fino a quattro video si ricevono a media risoluzione. */
const RIQUADRI_MEDI = 4;
/** Con uno schermo condiviso, i riquadri piccoli accanto. */
const RIQUADRI_CON_SCHERMO = 6;
/** Microfoni aperti quando i partecipanti possono parlare: chi presenta e
 *  qualche intervento dal pubblico. */
export const MICROFONI_APERTI_TIPICI = 10;
/** Una condivisione dello schermo a 5 fotogrammi al secondo. */
export const SCHERMO_MBPS = 1;
/** Una voce (Opus, pacchetti da 20 ms); stereo con la qualita' Massima. */
export const VOCE_MBPS = 0.04;
export const VOCE_STEREO_MBPS = 0.12;
export const VOCE_PPS = 50;
/** Un riquadro piccolo (180p) al secondo. */
export const RIQUADRO_PPS = 15;
/** I flussi grandi viaggiano in pacchetti di circa 1100 byte. */
const BYTE_PER_PACCHETTO = 1100;
const PPS_MINIMO = 30;
/** Quanto dei tetti del preset un flusso usa davvero: un riquadro piccolo, un
 *  video medio e uno in primo piano (il tetto e' il picco). */
const QUOTA_RIQUADRO = 0.75;
const QUOTA_MEDIO = 0.7;
const QUOTA_PRIMO_PIANO = 0.45;

/** La retta dei core del ponte (entrata piu' uscita). */
export const COEFFICIENTI_CORE = { base: 0.1, perKpps: 0.038, perMbps: 0.007 } as const;
/** Il ponte si dichiara sotto sforzo al 90% della sua CPU. */
export const SOGLIA_CPU_PONTE = 0.9;
/** Chi registra: un partecipante in piu' per il ponte, circa 1,5 core suoi,
 *  da 4 (tipico) a 10 Mbps (massimo) di video salvato. */
export const REGISTRAZIONE = { core: 1.5, mbpsTipici: 4, mbpsMassimi: 10 } as const;
/** I sottotitoli: circa un core per voce trascritta. */
export const SOTTOTITOLI_CORE_PER_VOCE = 1;

/** Le quote di webcam accese che il pannello propone (0: solo chi presenta). */
export const PROFILI_WEBCAM = [0, 10, 50, 100] as const;

export type LivelloCapacita = 'ampio' | 'attenzione' | 'limite' | 'nonBasta';

/** Cio' che l'istanza dice di se': la pagina del server lo legge
 *  (lib/capacity/istanza) e lo passa al pannello. */
export interface CapacitaIstanza {
  /** Core di un ponte (SiteSetting.jvbCpuCoresPerPod). */
  coresPerBridge: number;
  /** Soglie di sforzo del ponte, in percento (SiteSetting.jvbStress*Percent). */
  stressWarn: number;
  stressCritical: number;
  /** I ponti dell'istanza (JVB_MAX_REPLICAS). */
  instanceBridges: number;
  /** Le voci piu' forti che il ponte inoltra a ciascuno (JVB_NUM_LOUDEST);
   *  0: le inoltra tutte. */
  numLoudest: number;
  /** I ponti sono collegati fra loro: un evento puo' usarne piu' d'uno. */
  cascading: boolean;
  /** Le voci che i sottotitoli trascrivono insieme (CAPTIONS_MAX_STREAMS). */
  captionsMaxStreams: number;
  /** I sottotitoli live ci sono nell'istanza. */
  captionsAvailable: boolean;
  /** La quota di webcam accese del sito (SiteSetting.defaultSenderRatioPct). */
  siteCameraPct: number;
  /** La qualita' video del sito. */
  siteVideoQuality: VideoQualityPreset;
}

/** I valori di un'istanza che non dice niente: un ponte di 16 core, le soglie
 *  predefinite, nessuna voce filtrata (la stima piu' prudente). */
export const ISTANZA_PREDEFINITA: CapacitaIstanza = {
  coresPerBridge: 16,
  stressWarn: 50,
  stressCritical: 70,
  instanceBridges: 6,
  numLoudest: 0,
  cascading: false,
  captionsMaxStreams: 4,
  captionsAvailable: false,
  siteCameraPct: 30,
  siteVideoQuality: DEFAULT_VIDEO_QUALITY_PRESET,
};

/** Le scelte dell'evento che pesano sul ponte. */
export interface InputCapacita {
  maxParticipants: number;
  /** La quota di webcam accese; null: quella del sito. */
  expectedSenderRatioPct: number | null;
  participantsCanStartVideo: boolean;
  participantsCanUnmute: boolean;
  /** Chi presenta: il moderatore principale, i moderatori e i relatori. */
  presenters: number;
  /** null: la qualita' del sito. */
  videoQuality: VideoQualityPreset | null;
  recordingEnabled: boolean;
  liveCaptionsEnabled: boolean;
  /** La durata in ore (lo spazio della registrazione); null se non si sa. */
  durationHours: number | null;
}

/** I flussi di un preset, in Mbps e pacchetti al secondo. */
export interface ProfiloFlussi {
  /** Video ricevuti al massimo; -1: nessun limite (conta la griglia). */
  lastN: number;
  riquadro: number;
  riquadroPps: number;
  medio: number;
  /** In primo piano: tipico e tetto. */
  primoPiano: number;
  picco: number;
  /** Tutti gli strati di una webcam. */
  simulcast: number;
  voce: number;
  /** Gli strati che nessuno guarda si fermano (con la qualita' Massima no). */
  sospensione: boolean;
  maxRiquadri: number;
  /** Video ricevuti da un telefono. */
  telefonoVideo: number;
}

/** Per tarare il modello su una prova: flussi, microfoni e schermo come li
 *  ha prodotti la prova invece che come li suppone la sala. */
export interface TaraturaCapacita {
  flussi?: Partial<ProfiloFlussi>;
  microfoniAperti?: number;
  schermo?: boolean;
}

export type SuggerimentoCapacita =
  | { tipo: 'qualita'; qualita: VideoQualityPreset; carico: number }
  | { tipo: 'webcam'; quota: number; carico: number }
  | { tipo: 'partecipanti'; partecipanti: number; carico: number };

export interface StimaCapacita {
  partecipanti: number;
  presentatori: number;
  qualita: VideoQualityPreset;
  /** La quota di webcam che si conta (0 quando i partecipanti non la accendono). */
  quotaWebcam: number;
  webcam: number;
  microfoniAperti: number;
  vociInoltrate: number;
  /** Le voci piu' forti inoltrate (0: tutte). */
  numLoudest: number;
  videoVisti: number;
  disposizione: 'primoPiano' | 'griglia';
  /** Si conta una condivisione dello schermo. */
  schermo: boolean;
  perPartecipante: {
    /** Chi guarda, da computer e da telefono. */
    downMbps: number;
    telefonoMbps: number;
    telefonoVideo: number;
    /** Chi ha la webcam accesa: di solito, e in primo piano. */
    upMbps: number;
    upPiccoMbps: number;
    /** Con la qualita' Massima ogni webcam manda sempre tutti gli strati. */
    upSempreTutti: boolean;
  };
  ponte: {
    outMbps: number;
    inMbps: number;
    outPps: number;
    inPps: number;
    core: number;
    coreDelPonte: number;
    /** Core sul 90% dei core del ponte: 1 = pieno. */
    carico: number;
    soglie: { attenzione: number; critica: number };
    livello: LivelloCapacita;
    /** I ponti che l'evento usa (piu' di uno solo con i ponti collegati). */
    ponti: number;
    pontiNecessari: number;
    entra: boolean;
  };
  istanza: { ponti: number; coreDelPonte: number; cascading: boolean };
  registrazione: {
    core: number;
    gbMin: number;
    gbMax: number;
    ore: number | null;
  } | null;
  sottotitoli: { core: number; voci: number } | null;
  suggerimento: SuggerimentoCapacita | null;
  /** Spegnere meta' delle webcam lascia comunque piena la griglia. */
  webcamNonAiutano: boolean;
}

const ORDINE_QUALITA: readonly VideoQualityPreset[] = [
  'MAX',
  'HIGH',
  'BALANCED',
  'SAVE_DATA',
];

function finito(x: unknown, ripiego: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : ripiego;
}

function entro(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function qualitaValida(q: unknown): VideoQualityPreset | null {
  return typeof q === 'string' && (VIDEO_QUALITY_PRESETS as readonly string[]).includes(q)
    ? (q as VideoQualityPreset)
    : null;
}

/** I pacchetti al secondo di un flusso grande. */
function ppsDi(mbps: number): number {
  return Math.max(PPS_MINIMO, (mbps * 1e6) / 8 / BYTE_PER_PACCHETTO);
}

/** I flussi di un preset, dai suoi tetti di bitrate (lib/jitsi/config). */
export function profiloFlussi(preset: VideoQualityPreset): ProfiloFlussi {
  const q = videoQualityBudget(preset);
  const { low, standard, high } = q.maxBitratesVideo;
  const mbps = (bps: number) => bps / 1e6;
  return {
    lastN: q.channelLastN,
    riquadro: QUOTA_RIQUADRO * mbps(low),
    riquadroPps: RIQUADRO_PPS,
    medio: QUOTA_MEDIO * mbps(standard),
    primoPiano: QUOTA_PRIMO_PIANO * mbps(high),
    picco: mbps(high),
    simulcast: mbps(low + standard + high),
    voce: q.stereo ? VOCE_STEREO_MBPS : VOCE_MBPS,
    sospensione: q.enableLayerSuspension,
    maxRiquadri: MAX_RIQUADRI,
    telefonoVideo: q.mobileChannelLastN,
  };
}

/** Le ore fra inizio e fine, se si sanno. */
export function durataInOre(
  inizio: string | Date | null | undefined,
  fine: string | Date | null | undefined
): number | null {
  if (!inizio || !fine) return null;
  const ms = new Date(fine).getTime() - new Date(inizio).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : null;
}

/** Le soglie dell'istanza come frazioni, la critica mai sotto l'attenzione. */
function soglie(istanza: CapacitaIstanza): { attenzione: number; critica: number } {
  const attenzione = entro(finito(istanza.stressWarn, 50), 1, 100) / 100;
  const critica = entro(finito(istanza.stressCritical, 70) / 100, attenzione, 1);
  return { attenzione, critica };
}

/** Il livello di un carico: sotto l'attenzione, fino alla critica, fino al
 *  pieno, oltre. */
export function livelloCapacita(
  carico: number,
  s: { attenzione: number; critica: number }
): LivelloCapacita {
  if (carico < s.attenzione) return 'ampio';
  if (carico < s.critica) return 'attenzione';
  if (carico <= 1) return 'limite';
  return 'nonBasta';
}

type StimaSenzaSuggerimento = Omit<StimaCapacita, 'suggerimento' | 'webcamNonAiutano'>;

function calcola(
  input: InputCapacita,
  istanza: CapacitaIstanza,
  taratura: TaraturaCapacita = {}
): StimaSenzaSuggerimento {
  const N = entro(
    Math.floor(finito(input.maxParticipants, PARTECIPANTI_MIN)),
    PARTECIPANTI_MIN,
    PARTECIPANTI_MAX
  );
  const P = entro(Math.floor(finito(input.presenters, 1)), 1, N);
  const qualita =
    qualitaValida(input.videoQuality) ??
    qualitaValida(istanza.siteVideoQuality) ??
    DEFAULT_VIDEO_QUALITY_PRESET;
  const f: ProfiloFlussi = { ...profiloFlussi(qualita), ...taratura.flussi };

  // Webcam accese: chi presenta sempre, e la quota dei partecipanti se la
  // possono accendere.
  const quotaWebcam = input.participantsCanStartVideo
    ? entro(finito(input.expectedSenderRatioPct ?? istanza.siteCameraPct, 0), 0, 100)
    : 0;
  const C = entro(Math.max(P, Math.round((N * quotaWebcam) / 100)), 1, N);
  // Microfoni aperti: con i microfoni dei partecipanti, chi presenta e qualche
  // intervento; senza, solo chi presenta.
  const M = entro(
    Math.floor(
      finito(
        taratura.microfoniAperti,
        input.participantsCanUnmute ? Math.max(P, MICROFONI_APERTI_TIPICI) : P
      )
    ),
    0,
    N
  );
  const numLoudest = Math.max(0, Math.floor(finito(istanza.numLoudest, 0)));
  const voci = numLoudest > 0 ? Math.min(M, numLoudest) : M;
  // Chi non ha la webcam vede tutte le webcam; se ce l'hanno tutti, ciascuno
  // vede le altre. Mai oltre il lastN del preset e la griglia.
  const lastN = f.lastN < 0 ? Infinity : f.lastN;
  const V = Math.max(0, Math.min(C < N ? C : C - 1, lastN, f.maxRiquadri));
  // Chi presenta puo' sempre condividere lo schermo: se ne conta una.
  const schermo = taratura.schermo ?? true;

  // Chi guarda: con poche webcam chi parla in primo piano (o lo schermo al suo
  // posto) e le altre piccole; con piu' webcam la griglia, e con uno schermo
  // condiviso il piu' pesante fra la griglia e lo schermo con sei riquadri.
  let downVideo: number;
  let ppsVideo: number;
  const disposizione: StimaCapacita['disposizione'] =
    C <= WEBCAM_PRIMO_PIANO ? 'primoPiano' : 'griglia';
  if (disposizione === 'primoPiano') {
    const palco = schermo ? Math.max(SCHERMO_MBPS, f.primoPiano) : f.primoPiano;
    const altri = Math.max(0, V - 1);
    downVideo = palco + altri * f.riquadro;
    ppsVideo = ppsDi(palco) + altri * f.riquadroPps;
  } else {
    // Una griglia piu' fitta ha riquadri piu' piccoli, ma non costa mai meno
    // di quella da quattro: piu' persone non alleggeriscono la stima.
    const medi = V <= RIQUADRI_MEDI;
    const griglia = medi
      ? V * f.medio
      : Math.max(V * f.riquadro, RIQUADRI_MEDI * f.medio);
    const grigliaPps = medi
      ? V * ppsDi(f.medio)
      : Math.max(V * f.riquadroPps, RIQUADRI_MEDI * ppsDi(f.medio));
    const accanto = Math.min(V, RIQUADRI_CON_SCHERMO);
    const conSchermo = SCHERMO_MBPS + accanto * f.riquadro;
    const conSchermoPps = ppsDi(SCHERMO_MBPS) + accanto * f.riquadroPps;
    downVideo = schermo ? Math.max(griglia, conSchermo) : griglia;
    ppsVideo = schermo ? Math.max(grigliaPps, conSchermoPps) : grigliaPps;
  }
  const downMbps = downVideo + voci * f.voce;
  const ppsPerChiGuarda = ppsVideo + voci * VOCE_PPS;

  // Da telefono: pochi video, a media risoluzione.
  const telefonoVideo = Math.min(V, f.telefonoVideo);
  const telefonoGriglia = telefonoVideo * f.medio;
  const telefonoMbps =
    (schermo
      ? Math.max(
          telefonoGriglia,
          SCHERMO_MBPS + Math.max(0, telefonoVideo - 1) * f.riquadro
        )
      : telefonoGriglia) +
    voci * f.voce;

  // Chi ha la webcam manda lo strato che qualcuno guarda; chi e' in primo
  // piano tutti gli strati. Senza sospensione, sempre tutti. Come per chi
  // guarda, una griglia fitta non pesa meno di quella da quattro.
  const simulcastPps = ppsDi(f.picco) + ppsDi(f.medio) + f.riquadroPps;
  const piccoli = f.sospensione && disposizione === 'griglia' && V > RIQUADRI_MEDI;
  const strato = !f.sospensione ? f.simulcast : piccoli ? f.riquadro : f.medio;
  const inPrimoPiano = disposizione === 'primoPiano' ? 1 : 0;
  const altriWebcam = C - inPrimoPiano;
  const inWebcam = !f.sospensione
    ? altriWebcam * f.simulcast
    : piccoli
      ? Math.max(altriWebcam * f.riquadro, Math.min(altriWebcam, RIQUADRI_MEDI) * f.medio)
      : altriWebcam * f.medio;
  const inWebcamPps = !f.sospensione
    ? altriWebcam * simulcastPps
    : piccoli
      ? Math.max(
          altriWebcam * f.riquadroPps,
          Math.min(altriWebcam, RIQUADRI_MEDI) * ppsDi(f.medio)
        )
      : altriWebcam * ppsDi(f.medio);

  const sottotitoliAttivi = input.liveCaptionsEnabled && istanza.captionsAvailable;
  const vociSottotitoli = sottotitoliAttivi
    ? Math.min(M, Math.max(1, Math.floor(finito(istanza.captionsMaxStreams, 4))))
    : 0;

  // Il ponte: verso chi guarda (e chi registra, un partecipante in piu'; e i
  // sottotitoli, che ricevono le voci) e da chi manda.
  const riceventi = N + (input.recordingEnabled ? 1 : 0);
  const outMbps = riceventi * downMbps + vociSottotitoli * f.voce;
  const outPps = riceventi * ppsPerChiGuarda + vociSottotitoli * VOCE_PPS;
  const inMbps =
    inPrimoPiano * f.simulcast + inWebcam + M * f.voce + (schermo ? SCHERMO_MBPS : 0);
  const inPps =
    inPrimoPiano * simulcastPps +
    inWebcamPps +
    M * VOCE_PPS +
    (schermo ? ppsDi(SCHERMO_MBPS) : 0);

  const core =
    COEFFICIENTI_CORE.base +
    (COEFFICIENTI_CORE.perKpps * (outPps + inPps)) / 1000 +
    COEFFICIENTI_CORE.perMbps * (outMbps + inMbps);
  const coreDelPonte = Math.max(
    1,
    finito(istanza.coresPerBridge, ISTANZA_PREDEFINITA.coresPerBridge)
  );
  const carico = core / (coreDelPonte * SOGLIA_CPU_PONTE);
  const s = soglie(istanza);
  const livello = livelloCapacita(carico, s);
  const pontiIstanza = Math.max(1, Math.floor(finito(istanza.instanceBridges, 1)));
  // Con i ponti collegati l'evento si allarga finche' ogni ponte resta sotto
  // la soglia critica; senza, resta su uno.
  const pontiNecessari = Math.max(1, Math.ceil(carico / s.critica));
  const ponti = istanza.cascading ? Math.min(pontiNecessari, pontiIstanza) : 1;
  const entra = istanza.cascading ? pontiNecessari <= pontiIstanza : carico <= 1;

  const ore =
    input.durationHours !== null && Number.isFinite(input.durationHours)
      ? Math.max(0, input.durationHours)
      : null;
  const gb = (mbps: number) => (mbps * 3600 * (ore ?? 1)) / 8 / 1024;

  return {
    partecipanti: N,
    presentatori: P,
    qualita,
    quotaWebcam,
    webcam: C,
    microfoniAperti: M,
    vociInoltrate: voci,
    numLoudest,
    videoVisti: V,
    disposizione,
    schermo,
    perPartecipante: {
      downMbps,
      telefonoMbps,
      telefonoVideo,
      upMbps: strato + f.voce,
      upPiccoMbps: f.simulcast + f.voce,
      upSempreTutti: !f.sospensione,
    },
    ponte: {
      outMbps,
      inMbps,
      outPps,
      inPps,
      core,
      coreDelPonte,
      carico,
      soglie: s,
      livello,
      ponti,
      pontiNecessari,
      entra,
    },
    istanza: { ponti: pontiIstanza, coreDelPonte, cascading: istanza.cascading },
    registrazione: input.recordingEnabled
      ? {
          core: REGISTRAZIONE.core,
          gbMin: gb(REGISTRAZIONE.mbpsTipici),
          gbMax: gb(REGISTRAZIONE.mbpsMassimi),
          ore,
        }
      : null,
    sottotitoli: sottotitoliAttivi
      ? { core: vociSottotitoli * SOTTOTITOLI_CORE_PER_VOCE, voci: vociSottotitoli }
      : null,
  };
}

/**
 * Il primo cambio che porta il carico sotto la soglia di attenzione: una
 * qualita' video piu' bassa, poi meno webcam accese, poi meno partecipanti.
 */
function suggerisci(
  input: InputCapacita,
  istanza: CapacitaIstanza,
  stima: StimaSenzaSuggerimento,
  taratura: TaraturaCapacita
): SuggerimentoCapacita | null {
  if (stima.ponte.livello === 'ampio') return null;
  const sotto = (i: InputCapacita) => {
    const c = calcola(i, istanza, taratura).ponte.carico;
    return c < stima.ponte.soglie.attenzione ? c : null;
  };
  for (const qualita of ORDINE_QUALITA.slice(ORDINE_QUALITA.indexOf(stima.qualita) + 1)) {
    const carico = sotto({ ...input, videoQuality: qualita });
    if (carico !== null) return { tipo: 'qualita', qualita, carico };
  }
  if (input.participantsCanStartVideo) {
    for (const quota of [...PROFILI_WEBCAM].reverse()) {
      if (quota >= stima.quotaWebcam) continue;
      const carico = sotto({ ...input, expectedSenderRatioPct: quota });
      if (carico !== null) return { tipo: 'webcam', quota, carico };
    }
  }
  // Il numero piu' alto di partecipanti che ci sta, cercato a meta'.
  if (sotto({ ...input, maxParticipants: PARTECIPANTI_MIN }) === null) return null;
  let si = PARTECIPANTI_MIN;
  let no = stima.partecipanti;
  while (no - si > 1) {
    const mezzo = Math.floor((si + no) / 2);
    if (sotto({ ...input, maxParticipants: mezzo }) !== null) si = mezzo;
    else no = mezzo;
  }
  const carico = sotto({ ...input, maxParticipants: si });
  return carico === null ? null : { tipo: 'partecipanti', partecipanti: si, carico };
}

/** La stima di un evento sull'istanza, con il suggerimento per alleggerirlo. */
export function stimaCapacita(
  input: InputCapacita,
  istanza: CapacitaIstanza = ISTANZA_PREDEFINITA,
  taratura: TaraturaCapacita = {}
): StimaCapacita {
  const stima = calcola(input, istanza, taratura);
  const suggerimento = suggerisci(input, istanza, stima, taratura);
  return {
    ...stima,
    suggerimento,
    webcamNonAiutano:
      stima.ponte.livello !== 'ampio' &&
      suggerimento?.tipo !== 'webcam' &&
      Math.round(stima.webcam / 2) > MAX_RIQUADRI,
  };
}
