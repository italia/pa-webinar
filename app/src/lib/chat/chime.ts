/**
 * Il suono di avviso della chat: due note brevi generate dal browser (Web
 * Audio), senza file da scaricare. Al massimo uno ogni due secondi e mezzo,
 * cosi' una raffica di messaggi non diventa una sirena.
 *
 * Il browser lascia suonare solo una pagina con cui si e' gia' interagito: in
 * sala e' sempre cosi' (per entrare si preme un pulsante). Se rifiuta, tace.
 */

type AudioContextCtor = typeof AudioContext;

let contesto: AudioContext | null = null;
let ultimo = 0;
const PAUSA_MS = 2500;

export function playChatChime(opts: { force?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const ora = Date.now();
  if (!opts.force && ora - ultimo < PAUSA_MS) return;
  ultimo = ora;
  try {
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    contesto ??= new Ctor();
    const ctx = contesto;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime + 0.01;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const inizio = t0 + i * 0.11;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, inizio);
      gain.gain.setValueAtTime(0.0001, inizio);
      gain.gain.exponentialRampToValueAtTime(0.09, inizio + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, inizio + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(inizio);
      osc.stop(inizio + 0.25);
    });
  } catch {
    // Audio non disponibile (browser, impostazioni): l'avviso resta visivo.
  }
}
