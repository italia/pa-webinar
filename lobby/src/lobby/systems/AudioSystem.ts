/**
 * Procedural audio — no asset files, synthesised with the Web Audio API.
 *
 *  - a gentle low-volume chiptune ambient loop (geeky, unobtrusive),
 *  - footstep ticks while the player walks (throttled),
 *  - small blips for jump / emote.
 *
 * Browsers block audio until a user gesture, so nothing is created until
 * `resume()` is called (from the first click/keypress). A mute toggle and a low
 * default volume keep it polite.
 */

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
  private enabled = true;

  /** Start (or resume) audio — must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.loopTimer && this.ctx) {
      this.loopTimer = setInterval(() => this.tickMusic(), 380);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Toggle mute; returns the new enabled state. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.enabled ? MASTER_VOL : 0,
        this.ctx.currentTime,
        0.05,
      );
    }
    return this.enabled;
  }

  /** Footstep ticks while moving (call every frame with dt + moving flag). */
  footstep(dtMs: number, moving: boolean): void {
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

  emote(): void {
    this.blip(523, 0.08, 'square', 0.12);
    this.scheduleBlip(0.09, 784, 0.1, 'square', 0.12);
  }

  /** Small confirmation chime (e.g. entering the call). */
  chime(): void {
    this.blip(523, 0.12, 'triangle', 0.2);
    this.scheduleBlip(0.12, 659, 0.14, 'triangle', 0.2);
    this.scheduleBlip(0.26, 784, 0.2, 'triangle', 0.2);
  }

  destroy(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
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

  private tickMusic(): void {
    if (!this.ctx || !this.musicGain) return;
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
    if (!this.ctx || !this.sfxGain) return;
    this.note(freq, dur, this.ctx.currentTime + delay, type, vol, this.sfxGain);
  }

  private sweep(from: number, to: number, dur: number, vol: number): void {
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
