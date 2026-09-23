import type { EventSchedule, EventStatus, Unsub } from '@pa-webinar/lobby';

import { Listeners } from './shared';

/** App event status (waiting-room.tsx) → lobby EventStatus. */
export type AppEventStatus = 'PUBLISHED' | 'LIVE' | 'ENDED' | 'IDLE' | 'PROVISIONING';

/** Oltre le 24 ore non si arma niente: `setTimeout` oltre i 24,8 giorni
 *  trabocca e scatta subito, e una pagina aperta per un giorno intero prima
 *  dell'evento non e' il caso da servire. */
const ORIZZONTE_MS = 24 * 60 * 60 * 1000;

/**
 * Stato dell'applicazione + stato della sala → stato della piazza.
 *
 * Tre attese diverse, e il cancello le disegna diverse perche' a chi guarda
 * dicono cose diverse:
 *
 * - `scheduled` — non e' ancora ora: lucchetto e conto alla rovescia.
 * - `preparing` — l'ora e' passata ma la stanza non c'e': cordone.
 * - `live` — si entra.
 *
 * Il conto alla rovescia non scende mai sotto zero, quindi passata l'ora
 * d'inizio mostrarlo direbbe «Inizia tra 00:00» a tempo indefinito: da li' in
 * poi l'attesa e' della stanza, non dell'orologio — e vale per un evento che
 * si sta scaldando tanto quanto per uno gia' avviato.
 */
function mapStatus(s: AppEventStatus, salaPronta: boolean, oraPassata: boolean): EventStatus {
  if (s === 'ENDED') return 'ended';
  if (s === 'LIVE') return salaPronta ? 'live' : 'preparing';
  return oraPassata ? 'preparing' : 'scheduled';
}

/**
 * Real EventSchedule mapping the waiting-room event status. The React wrapper
 * calls `update()` whenever the `event.status` prop changes, so the gate opens
 * on the LIVE transition with no refresh.
 */
export class EventStatusSchedule implements EventSchedule {
  private status: EventStatus;
  private readonly listeners = new Listeners<EventStatus>();

  private salaPronta: boolean;
  private appStatus: AppEventStatus;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: AppEventStatus,
    private readonly startsAtMs: number,
    private readonly host: boolean,
    salaPronta = true,
  ) {
    this.salaPronta = salaPronta;
    this.appStatus = initial;
    this.status = mapStatus(initial, salaPronta, this.oraPassata());
    this.armaOraInizio();
  }

  getStatus(): EventStatus {
    return this.status;
  }

  getStartsAt(): number {
    return this.startsAtMs;
  }

  isHost(): boolean {
    return this.host;
  }

  on(_ev: 'statusChange', cb: (s: EventStatus) => void): Unsub {
    return this.listeners.add(cb);
  }

  /** Push a new app status and/or room readiness; emits if what the piazza
   *  shows would change. */
  update(appStatus: AppEventStatus, salaPronta = this.salaPronta): void {
    this.salaPronta = salaPronta;
    this.appStatus = appStatus;
    this.applica();
  }

  /** Ferma il risveglio all'ora d'inizio. Il wrapper la chiama smontando. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private oraPassata(): boolean {
    return Date.now() >= this.startsAtMs;
  }

  /** Senza questo, un evento che attraversa la propria ora d'inizio mentre
   *  nessuno tocca lo stato resterebbe col conto alla rovescia fermo a zero. */
  private armaOraInizio(): void {
    if (this.oraPassata()) return;
    const attesa = this.startsAtMs - Date.now();
    if (attesa > ORIZZONTE_MS) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.applica();
    }, attesa);
  }

  private applica(): void {
    const next = mapStatus(this.appStatus, this.salaPronta, this.oraPassata());
    if (next === this.status) return;
    this.status = next;
    this.listeners.emit(next);
  }
}
