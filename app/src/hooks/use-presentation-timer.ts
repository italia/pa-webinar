'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface StatoTimer {
  active: boolean;
  /** Durata impostata, in secondi. */
  duration: number;
  /** Secondi rimasti. */
  remaining: number;
  /** Mostrato a tutta la sala, non solo a chi conduce. */
  visible: boolean;
  paused: boolean;
}

export type AzioneTimer = 'start' | 'pause' | 'resume' | 'reset' | 'visibility';

const SPENTO: StatoTimer = { active: false, duration: 0, remaining: 0, visible: false, paused: false };

/**
 * Il timer degli interventi della sala: uno stato condiviso per evento. Lo
 * aggiorna un solo componente montato nella sala (`TimerInterventiSync`:
 * letture dal server ogni 5 secondi e conto alla rovescia fra una lettura e
 * l'altra); lo leggono la striscia del tempo, la scheda Regia e la fascia per
 * il pubblico. A ogni secondo si ridisegnano solo loro, non tutta la sala.
 */
class StoreTimer {
  private stato: StatoTimer = SPENTO;
  private scarto = 0;
  private ascoltatori = new Set<() => void>();

  leggi = (): StatoTimer => this.stato;
  leggiScarto = (): number => this.scarto;

  /** Lo scarto cambia di poco a ogni lettura: si aggiorna (e si ridisegna)
   *  solo quando si sposta di più di un secondo. */
  scriviScarto(ms: number): void {
    if (Math.abs(ms - this.scarto) <= 1000) return;
    this.scarto = ms;
    for (const fn of this.ascoltatori) fn();
  }

  iscrivi = (fn: () => void): (() => void) => {
    this.ascoltatori.add(fn);
    return () => this.ascoltatori.delete(fn);
  };

  scrivi(prossimo: StatoTimer | ((s: StatoTimer) => StatoTimer)): void {
    this.stato = typeof prossimo === 'function' ? prossimo(this.stato) : prossimo;
    for (const fn of this.ascoltatori) fn();
  }
}

const stores = new Map<string, StoreTimer>();

function storeDi(eventSlug: string): StoreTimer {
  let s = stores.get(eventSlug);
  if (!s) {
    s = new StoreTimer();
    stores.set(eventSlug, s);
  }
  return s;
}

async function leggiDalServer(eventSlug: string): Promise<void> {
  try {
    const prima = Date.now();
    const res = await fetch(`/api/events/${eventSlug}/timer`);
    if (!res.ok) return;
    const dati = (await res.json()) as StatoTimer & { serverNow?: string };
    const dopo = Date.now();
    const { serverNow, ...stato } = dati;
    const store = storeDi(eventSlug);
    store.scrivi(stato);
    // L'ora del server a metà del giro di andata e ritorno.
    const server = serverNow ? new Date(serverNow).getTime() : NaN;
    if (!Number.isNaN(server)) store.scriviScarto(server - (prima + dopo) / 2);
  } catch {
    /* si riprova al giro dopo */
  }
}

/** Il timer della sala, letto dallo stato condiviso. */
export function useTimerInterventi(eventSlug: string): StatoTimer {
  const store = storeDi(eventSlug);
  return useSyncExternalStore(store.iscrivi, store.leggi, () => SPENTO);
}

/**
 * Lo scarto fra l'orologio del server e quello di questo browser (ms). Le ore
 * della sala (inizio, fine, avvio della registrazione) sono del server: con
 * lo scarto tutti vedono la stessa durata e la stessa chiusura, anche con
 * l'orologio del computer fuori di qualche minuto.
 */
export function useScartoOrologio(eventSlug: string): number {
  const store = storeDi(eventSlug);
  return useSyncExternalStore(store.iscrivi, store.leggiScarto, () => 0);
}

/** I comandi di chi conduce: avvio, pausa, ripresa, azzeramento, visibilità. */
export function useComandiTimer(eventSlug: string, token: string) {
  return useCallback(
    async (action: AzioneTimer, duration?: number, visible?: boolean) => {
      const res = await fetch(`/api/events/${eventSlug}/timer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, duration, visible }),
      });
      await leggiDalServer(eventSlug);
      return res.ok;
    },
    [eventSlug, token],
  );
}

/**
 * Tiene aggiornato lo stato condiviso: va montato una volta, nella sala
 * (non in attesa né sulle schermate di chiusura). Non disegna nulla.
 */
export function TimerInterventiSync({ eventSlug }: { eventSlug: string }) {
  const timer = useTimerInterventi(eventSlug);

  useEffect(() => {
    void leggiDalServer(eventSlug);
    const id = setInterval(() => void leggiDalServer(eventSlug), 5000);
    return () => clearInterval(id);
  }, [eventSlug]);

  useEffect(() => {
    if (!timer.active || timer.paused || timer.remaining <= 0) return;
    const id = setInterval(() => {
      storeDi(eventSlug).scrivi((t) => ({ ...t, remaining: Math.max(0, t.remaining - 1) }));
    }, 1000);
    return () => clearInterval(id);
  }, [eventSlug, timer.active, timer.paused, timer.remaining]);

  return null;
}
