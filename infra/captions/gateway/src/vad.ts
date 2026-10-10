/**
 * Dove c'è voce, misurato sul segnale.
 *
 * Il bridge non dice quando una persona tace: con il microfono aperto il
 * client manda audio di continuo, cinquanta pacchetti al secondo anche nelle
 * pause, e solo un microfono spento smette di mandarne. La fine della frase
 * si decide quindi sull'audio decodificato: un frame è voce quando la sua
 * energia supera sia una soglia assoluta sia, di un margine, il rumore di
 * fondo di quella voce.
 *
 * Il rumore di fondo è il livello più basso degli ultimi secondi: il parlato
 * ha sempre dei vuoti tra sillabe e parole, un rumore costante no, e così un
 * ventilatore o un brusio non tengono aperta la frase per sempre.
 */

/** Sotto questo livello un frame conta come silenzio digitale. */
const FLOOR_DBFS = -100;
/**
 * Il tetto della soglia. Quando nella finestra c'è solo parlato (un client
 * che non manda le pause, i secondi prima di spegnere il microfono) il
 * "rumore di fondo" è la sillaba più bassa, e la soglia salirebbe sopra la
 * voce sommessa; un rumore vero, dopo la soppressione del browser, resta
 * comunque sotto.
 */
const MAX_THRESHOLD_DBFS = -35;
/** La finestra su cui si stima il rumore di fondo, in secondi di audio. */
const NOISE_WINDOW_SECONDS = 3;
const SAMPLE_RATE = 16000;

export interface VoiceDetectorOptions {
  /** Soglia assoluta: sotto, mai voce. */
  minDbfs: number;
  /** Quanto la voce deve stare sopra il rumore di fondo. */
  marginDb: number;
}

/** Livello RMS di un tratto PCM16 little-endian, in dBFS. */
export function levelDbfs(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return FLOOR_DBFS;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples);
  return rms > 0 ? Math.max(FLOOR_DBFS, 20 * Math.log10(rms)) : FLOOR_DBFS;
}

export class VoiceDetector {
  /** I livelli dei frame recenti, con la loro durata: i frame Opus non sono sempre da 20 ms. */
  private readonly window: Array<{ level: number; seconds: number }> = [];
  private windowSeconds = 0;

  constructor(private readonly options: VoiceDetectorOptions) {}

  /** La soglia per il prossimo frame: il rumore si stima sui frame precedenti. */
  threshold(): number {
    let floor = Infinity;
    for (const frame of this.window) floor = Math.min(floor, frame.level);
    if (floor === Infinity) floor = FLOOR_DBFS;
    return Math.max(this.options.minDbfs, Math.min(floor + this.options.marginDb, MAX_THRESHOLD_DBFS));
  }

  /** Registra un frame e dice se contiene voce. */
  push(pcm: Buffer): boolean {
    const level = levelDbfs(pcm);
    const voiced = level > this.threshold();
    const seconds = pcm.length / 2 / SAMPLE_RATE;
    this.window.push({ level, seconds });
    this.windowSeconds += seconds;
    while (this.windowSeconds > NOISE_WINDOW_SECONDS && this.window.length > 1) {
      this.windowSeconds -= this.window.shift()?.seconds ?? 0;
    }
    return voiced;
  }
}
