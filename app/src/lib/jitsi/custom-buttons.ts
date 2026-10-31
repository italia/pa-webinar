import type { JitsiMeetExternalAPI } from '@/types/jitsi';

/**
 * I pulsanti personalizzati della barra di Jitsi (`customToolbarButtons`).
 *
 * Jitsi tiene un solo elenco: chi lo riscrive con `overwriteConfig` cancella
 * i pulsanti degli altri. Per questo l'elenco ha un solo proprietario, questo
 * registro, una voce per sala: chi vuole un pulsante (i sottotitoli, lo
 * schermo intero) lo dichiara qui, e il registro manda a Jitsi l'elenco
 * intero, sempre nello stesso ordine.
 *
 * Jitsi (stable-10741) aggiorna la configurazione ma continua a disegnare un
 * pulsante gia' montato: per cambiarne icona o testo lo si toglie (lui solo)
 * e lo si rimette, e Jitsi lo ridisegna. Il prezzo: chi lo usa da tastiera perde il
 * fuoco sul pulsante dopo il clic.
 */

export interface CustomToolbarButton {
  id: string;
  icon: string;
  text: string;
}

/**
 * Tra togliere i pulsanti dalla barra e rimetterli. I due comandi arrivano a
 * Jitsi come messaggi separati e ciascuno ridisegna la barra; l'attesa copre
 * un iframe impegnato, che altrimenti li elaborerebbe insieme e lascerebbe il
 * pulsante vecchio fino al clic successivo.
 */
export const REMOUNT_DELAY_MS = 250;

interface Registro {
  /** I pulsanti voluti, per id. */
  voluti: Map<string, CustomToolbarButton>;
  /** Quelli che Jitsi sta disegnando (l'ultimo elenco mandato). */
  montati: Map<string, CustomToolbarButton>;
  /** L'elenco e' gia' stato mandato almeno una volta a questa sala. */
  avviato: boolean;
  /** La conferenza e' aperta: prima Jitsi scarta i comandi, e si aspetta. */
  pronta: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const registri = new WeakMap<JitsiMeetExternalAPI, Registro>();

function registroDi(api: JitsiMeetExternalAPI): Registro {
  let r = registri.get(api);
  if (!r) {
    r = {
      voluti: new Map(),
      montati: new Map(),
      avviato: false,
      pronta: true,
      timer: null,
    };
    registri.set(api, r);
  }
  return r;
}

function manda(api: JitsiMeetExternalAPI, pulsanti: CustomToolbarButton[]): void {
  try {
    api.executeCommand('overwriteConfig', { customToolbarButtons: pulsanti });
  } catch {
    // Una versione di Jitsi senza il comando: restano i pulsanti della
    // configurazione iniziale.
  }
}

function inOrdine(m: Map<string, CustomToolbarButton>): CustomToolbarButton[] {
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function aggiorna(api: JitsiMeetExternalAPI, r: Registro): void {
  if (r.timer) {
    clearTimeout(r.timer);
    r.timer = null;
  }
  const voluti = inOrdine(r.voluti);
  // Un pulsante gia' disegnato con un'altra icona o un altro testo: Jitsi
  // non lo ridisegnerebbe. Si toglie (solo lui: gli altri restano al loro
  // posto) e si rimette poco dopo.
  const cambiati = new Set(
    r.avviato
      ? voluti
          .filter((p) => {
            const m = r.montati.get(p.id);
            return m && (m.icon !== p.icon || m.text !== p.text);
          })
          .map((p) => p.id)
      : []
  );
  r.avviato = true;
  if (cambiati.size === 0) {
    manda(api, voluti);
    r.montati = new Map(voluti.map((p) => [p.id, p]));
    return;
  }
  const senza = voluti.filter((p) => !cambiati.has(p.id));
  manda(api, senza);
  r.montati = new Map(senza.map((p) => [p.id, p]));
  r.timer = setTimeout(() => {
    r.timer = null;
    const ora = inOrdine(r.voluti);
    manda(api, ora);
    r.montati = new Map(ora.map((p) => [p.id, p]));
  }, REMOUNT_DELAY_MS);
}

/**
 * Mette, aggiorna o (con `null`) toglie un pulsante dalla barra di questa
 * sala. Senza cambiamenti non manda nulla; prima che la conferenza sia aperta
 * tiene la richiesta (vedi salaPronta).
 */
export function impostaPulsante(
  api: JitsiMeetExternalAPI,
  id: string,
  pulsante: CustomToolbarButton | null
): void {
  const r = registroDi(api);
  const prima = r.voluti.get(id);
  if (pulsante) {
    if (
      prima &&
      prima.icon === pulsante.icon &&
      prima.text === pulsante.text &&
      r.avviato
    )
      return;
    r.voluti.set(id, pulsante);
  } else {
    if (!prima) return;
    r.voluti.delete(id);
  }
  if (r.pronta) aggiorna(api, r);
}

/**
 * La conferenza e' aperta (`videoConferenceJoined`): da qui Jitsi accetta i
 * comandi, e i pulsanti chiesti nel frattempo arrivano.
 */
export function salaPronta(api: JitsiMeetExternalAPI): void {
  const r = registroDi(api);
  if (r.pronta) return;
  r.pronta = true;
  const uguali =
    r.voluti.size === r.montati.size &&
    [...r.voluti.values()].every((p) => {
      const m = r.montati.get(p.id);
      return m && m.icon === p.icon && m.text === p.text;
    });
  if (!uguali) aggiorna(api, r);
}

/**
 * I pulsanti che la sala ha gia' ricevuto con la configurazione iniziale
 * (`configOverwrite.customToolbarButtons`): il registro parte da quelli, cosi'
 * chi li toglie o li cambia dopo trova lo stato vero di Jitsi.
 */
export function pulsantiIniziali(
  api: JitsiMeetExternalAPI,
  pulsanti: CustomToolbarButton[]
): void {
  const r = registroDi(api);
  r.voluti = new Map(pulsanti.map((p) => [p.id, p]));
  r.montati = new Map(r.voluti);
  r.avviato = true;
  // Prima dell'ingresso nella conferenza Jitsi scarta overwriteConfig: le
  // richieste si tengono e partono con salaPronta.
  r.pronta = false;
}
