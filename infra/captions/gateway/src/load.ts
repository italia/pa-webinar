/**
 * Il governo del carico: quando il motore non sta al passo, i sottotitoli
 * arrivano sempre più tardi e diventano inutili. Il ritardo misurato su ogni
 * frammento decide lo stato:
 *
 * - `ok`: si trascrivono fino a `maxStreams` voci;
 * - `degraded`: ritardo alto, si dimezzano le voci trascritte (restano quelle
 *   che parlano più di recente);
 * - `paused`: ritardo troppo alto per un tempo prolungato, la trascrizione si
 *   sospende del tutto per un periodo che raddoppia a ogni ricaduta; poi si
 *   riprova da capo;
 * - `unavailable`: il motore non risponde.
 *
 * Solo logica pura con un orologio iniettato, perché si possa provare.
 */

export type LoadState = 'ok' | 'degraded' | 'paused' | 'unavailable';

export interface LoadOptions {
  maxStreams: number;
  degradeLagMs: number;
  pauseLagMs: number;
  pauseCooldownMs: number;
  maxPauseMs: number;
  /** Finestra su cui si calcola il p95 del ritardo. */
  windowMs?: number;
  /** Per quanto il ritardo deve restare sopra la soglia prima di sospendere. */
  sustainMs?: number;
  /** Dopo questo tempo senza sospensioni, la successiva riparte dalla durata minima. */
  forgiveMs?: number;
  now?: () => number;
}

export interface LoadSnapshot {
  state: LoadState;
  streamLimit: number;
  lagP95Ms: number | null;
  /** Fine della sospensione in corso (epoch ms). */
  pausedUntil: number | null;
  /** Da quando lo stato è quello attuale (epoch ms). */
  since: number;
  reason: string | null;
}

export class LoadGovernor {
  private samples: Array<[number, number]> = [];
  private state: LoadState = 'ok';
  private since: number;
  private reason: string | null = null;
  private pausedUntil: number | null = null;
  private pauses = 0;
  private lastPauseEnd: number | null = null;
  private overSince: number | null = null;
  private engineOk = true;
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly sustainMs: number;
  private readonly forgiveMs: number;

  constructor(private readonly opts: LoadOptions) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? 10_000;
    this.sustainMs = opts.sustainMs ?? 5_000;
    this.forgiveMs = opts.forgiveMs ?? 600_000;
    this.since = this.now();
  }

  recordLag(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.samples.push([this.now(), Math.max(0, ms)]);
  }

  setEngineAvailable(ok: boolean): void {
    this.engineOk = ok;
  }

  private p95(): number | null {
    const cutoff = this.now() - this.windowMs;
    this.samples = this.samples.filter(([t]) => t >= cutoff);
    if (this.samples.length === 0) return null;
    const sorted = this.samples.map(([, v]) => v).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null;
  }

  private enter(state: LoadState, reason: string | null): void {
    if (state !== this.state) {
      this.state = state;
      this.since = this.now();
    }
    this.reason = reason;
  }

  evaluate(): LoadSnapshot {
    const now = this.now();
    const lag = this.p95();

    if (!this.engineOk) {
      this.overSince = null;
      this.enter('unavailable', 'engine-unreachable');
    } else if (this.pausedUntil !== null && now < this.pausedUntil) {
      // Sospensione in corso: non si guarda il ritardo, che non viene più misurato.
      this.enter('paused', 'overload');
    } else {
      if (this.pausedUntil !== null) {
        // Fine della sospensione: si riparte senza i campioni di prima.
        this.lastPauseEnd = this.pausedUntil;
        this.pausedUntil = null;
        this.samples = [];
        this.overSince = null;
        this.enter('ok', null);
      } else if (lag !== null && lag >= this.opts.pauseLagMs) {
        this.overSince ??= now;
        if (now - this.overSince >= this.sustainMs) {
          if (this.lastPauseEnd !== null && now - this.lastPauseEnd > this.forgiveMs) this.pauses = 0;
          const duration = Math.min(this.opts.maxPauseMs, this.opts.pauseCooldownMs * 2 ** this.pauses);
          this.pauses += 1;
          this.pausedUntil = now + duration;
          this.overSince = null;
          this.samples = [];
          this.enter('paused', 'overload');
        } else {
          this.enter('degraded', 'lag');
        }
      } else if (lag !== null && lag >= this.opts.degradeLagMs) {
        this.overSince = null;
        this.enter('degraded', 'lag');
      } else {
        this.overSince = null;
        this.enter('ok', null);
      }
    }

    const streamLimit =
      this.state === 'ok'
        ? this.opts.maxStreams
        : this.state === 'degraded'
          ? Math.max(1, Math.floor(this.opts.maxStreams / 2))
          : 0;
    return {
      state: this.state,
      streamLimit,
      lagP95Ms: lag,
      pausedUntil: this.state === 'paused' ? this.pausedUntil : null,
      since: this.since,
      reason: this.reason,
    };
  }
}
