/**
 * Suoni sintetizzati con la Web Audio API, senza file:
 *
 *  - un motivetto chiptune basso e discreto,
 *  - i suoni della piazza: il mormorio della fontana e qualche uccello,
 *  - i passi mentre si cammina,
 *  - piccoli suoni per il salto, ogni gesto, un fumetto e il cancello che si
 *    apre.
 *
 * Spenti, non gira niente: né il contesto audio (sospeso), né il motivetto,
 * né la fontana, né gli uccelli. Si accendono solo con un gesto della
 * persona (il browser lo pretende), e a volume basso.
 */

import type { EmoteType } from '../ports/types';

// Pentatonic-ish arpeggio (A minor pentatonic) — pleasant, never grating.
const MELODY = [220, 262, 294, 330, 392, 330, 294, 262];
const PAD = [110, 165, 220]; // soft chord under the melody
const STEP_INTERVAL_MS = 270;
const MASTER_VOL = 0.5;

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private stepAccum = STEP_INTERVAL_MS;
  private enabled = false;
  private fontana: AudioBufferSourceNode | null = null;
  private uccelliTimer: ReturnType<typeof setTimeout> | null = null;
  private distrutto = false;
  private ultimoPop = 0;

  /** Si suona solo se acceso e con il contesto audio davvero in funzione. */
  private suona(): boolean {
    return this.enabled && !this.distrutto && this.ctx !== null && this.ctx.state === 'running';
  }

  /** Riprende l'audio, solo se è acceso. Il browser lo concede dopo un gesto
   *  della persona: finché il contesto non gira davvero, motivetto, fontana e
   *  uccelli non partono (le note si accumulerebbero e suonerebbero tutte
   *  insieme alla ripresa). */
  resume(): void {
    if (!this.enabled || this.distrutto) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    // Sempre, anche se risulta già «running»: una sospensione appena chiesta
    // può essere ancora in corso.
    void ctx
      .resume()
      .then(() => this.avviaCicli())
      .catch(() => undefined);
  }

  private avviaCicli(): void {
    if (!this.enabled || this.distrutto || !this.ctx || this.ctx.state !== 'running') return;
    if (!this.loopTimer) this.loopTimer = setInterval(() => this.tickMusic(), 380);
    this.avviaAmbiente();
  }

  /** Acceso o spento, deciso da fuori (la pagina che ospita la piazza
   *  ricorda la scelta). Spento, ferma tutto e sospende il contesto. */
  setEnabled(on: boolean): boolean {
    if (on === this.enabled) return this.enabled;
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? MASTER_VOL : 0, this.ctx.currentTime, 0.05);
    }
    if (on) {
      this.resume();
    } else {
      this.fermaTutto();
      // Se nel frattempo si è riacceso, la sospensione arrivata dopo va
      // annullata: altrimenti il pulsante direbbe «acceso» e non si sentirebbe
      // niente.
      const ctx = this.ctx;
      if (ctx) {
        void ctx
          .suspend()
          .then(() => {
            if (this.enabled) this.resume();
          })
          .catch(() => undefined);
      }
    }
    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Il contesto audio gira davvero (il browser l'ha concesso). */
  inFunzione(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Toggle mute; returns the new enabled state. */
  toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  /** Ferma motivetto, fontana e uccelli (il contesto resta, sospeso). */
  private fermaTutto(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
    if (this.uccelliTimer) clearTimeout(this.uccelliTimer);
    this.uccelliTimer = null;
    try {
      this.fontana?.stop();
    } catch {
      /* già ferma */
    }
    this.fontana = null;
  }

  /** Footstep ticks while moving (call every frame with dt + moving flag). */
  footstep(dtMs: number, moving: boolean): void {
    if (!this.suona()) return;
    if (!moving) {
      this.stepAccum = STEP_INTERVAL_MS;
      return;
    }
    this.stepAccum += dtMs;
    if (this.stepAccum < STEP_INTERVAL_MS) return;
    this.stepAccum = 0;
    this.step = (this.step + 1) % 2;
    this.blip(this.step === 0 ? 130 : 98, 0.07, 'triangle', 0.16);
  }

  jump(): void {
    this.sweep(220, 540, 0.18, 0.18);
  }

  /** Un suono diverso per ogni gesto. */
  emote(type: EmoteType = 'wave'): void {
    switch (type) {
      case 'heart':
        this.blip(659, 0.12, 'sine', 0.14);
        this.scheduleBlip(0.12, 880, 0.18, 'sine', 0.14);
        break;
      case 'clap':
        // Tre battiti di rumore breve.
        for (const d of [0, 0.11, 0.22]) this.rumore(d, 0.05, 1800, 0.22);
        break;
      case 'laugh':
        for (const [i, f] of [587, 523, 587, 523].entries()) this.scheduleBlip(i * 0.08, f, 0.07, 'triangle', 0.13);
        break;
      case 'idea':
        this.scheduleBlip(0, 784, 0.08, 'sine', 0.12);
        this.scheduleBlip(0.07, 1047, 0.16, 'sine', 0.12);
        break;
      default:
        this.blip(523, 0.08, 'square', 0.12);
        this.scheduleBlip(0.09, 784, 0.1, 'square', 0.12);
    }
  }

  /** Un fumetto che compare: un «pop» leggero. Più fumetti insieme (la chat
   *  recuperata dopo un'interruzione) fanno un pop solo, non una raffica. */
  pop(): void {
    const ora = performance.now();
    if (ora - this.ultimoPop < 250) return;
    this.ultimoPop = ora;
    this.sweep(380, 720, 0.07, 0.08);
  }

  /** Il cancello si apre: un piccolo jingle in salita. */
  gateOpen(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.scheduleBlip(i * 0.11, f, 0.18, 'triangle', 0.18));
  }

  /** Small confirmation chime (e.g. entering the call). */
  chime(): void {
    this.blip(523, 0.12, 'triangle', 0.2);
    this.scheduleBlip(0.12, 659, 0.14, 'triangle', 0.2);
    this.scheduleBlip(0.26, 784, 0.2, 'triangle', 0.2);
  }

  destroy(): void {
    this.fermaTutto();
    this.distrutto = true;
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
  }

  // ── internals ──
  private init(): void {
    const Ctor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? MASTER_VOL : 0;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16; // ambient sits low under SFX
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  // ── ambiente: la fontana e gli uccelli ──
  private avviaAmbiente(): void {
    if (!this.ctx || !this.musicGain) return;
    if (!this.uccelliTimer) this.programmaUccello();
    if (this.fontana) return;
    // La fontana: rumore filtrato in banda, basso e costante.
    const ctx = this.ctx;
    const durata = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * durata, ctx.sampleRate);
    const dati = buffer.getChannelData(0);
    for (let i = 0; i < dati.length; i++) dati[i] = Math.random() * 2 - 1;
    const sorgente = ctx.createBufferSource();
    sorgente.buffer = buffer;
    sorgente.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = 900;
    filtro.Q.value = 0.6;
    const volume = ctx.createGain();
    volume.gain.value = 0.05;
    sorgente.connect(filtro).connect(volume).connect(this.musicGain);
    sorgente.start();
    this.fontana = sorgente;
  }

  private programmaUccello(): void {
    if (this.distrutto || !this.enabled) return;
    this.uccelliTimer = setTimeout(() => {
      this.uccelliTimer = null;
      this.cinguettio();
      this.programmaUccello();
    }, 5000 + Math.random() * 9000);
  }

  private cinguettio(): void {
    if (!this.suona()) return;
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    const base = 2200 + Math.random() * 900;
    const note = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < note; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const inizio = t + i * 0.12;
      o.frequency.setValueAtTime(base, inizio);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, inizio + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, inizio);
      g.gain.linearRampToValueAtTime(0.25, inizio + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, inizio + 0.09);
      o.connect(g).connect(this.musicGain);
      o.start(inizio);
      o.stop(inizio + 0.12);
    }
  }

  /** Un colpo di rumore breve (l'applauso). */
  private rumore(delay: number, dur: number, freq: number, vol: number): void {
    if (!this.suona()) return;
    if (!this.ctx || !this.sfxGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const dati = buffer.getChannelData(0);
    for (let i = 0; i < dati.length; i++) dati[i] = (Math.random() * 2 - 1) * (1 - i / dati.length);
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t);
  }

  private tickMusic(): void {
    // Un contesto sospeso dal sistema (una telefonata, un'altra app) ha
    // l'orologio fermo: le note si accumulerebbero e suonerebbero insieme.
    if (!this.suona() || !this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    const note = MELODY[this.step % MELODY.length] ?? 220;
    this.note(note, 0.32, t, 'triangle', 0.5, this.musicGain);
    // A soft pad chord at the start of every bar.
    if (this.step % MELODY.length === 0) {
      for (const f of PAD) this.note(f, 1.4, t, 'sine', 0.18, this.musicGain);
    }
    this.step = (this.step + 1) % 64;
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.suona()) return;
    if (!this.ctx || !this.sfxGain) return;
    this.note(freq, dur, this.ctx.currentTime, type, vol, this.sfxGain);
  }

  private scheduleBlip(
    delay: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ): void {
    if (!this.suona()) return;
    if (!this.ctx || !this.sfxGain) return;
    this.note(freq, dur, this.ctx.currentTime + delay, type, vol, this.sfxGain);
  }

  private sweep(from: number, to: number, dur: number, vol: number): void {
    if (!this.suona()) return;
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private note(
    freq: number,
    dur: number,
    when: number,
    type: OscillatorType,
    vol: number,
    out: GainNode,
  ): void {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(out);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
}
