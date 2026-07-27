'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { mutate as globalMutate } from 'swr';

import type { LiveEnvelope, LiveFlags, PokeablePanel } from '@/lib/live-state/pubsub';

/**
 * Aggancio ai cambiamenti di stato della sala live via SSE.
 *
 * Va montato **una volta sola**, nel contenitore della sala: i pannelli si
 * smontano al cambio scheda, e legarci lo stream aprirebbe e chiuderebbe una
 * connessione a ogni click.
 *
 * Non tiene stato proprio: scrive nella stessa cache SWR che i pannelli già
 * usano. Due sorgenti di verità per lo stesso dato divergono sempre, e la
 * differenza si vede solo in sala.
 *
 * `pushLive` dice se il canale è davvero vivo: finché è falso i pannelli
 * continuano a interrogare il server come prima. Diventa falso anche quando lo
 * stream tace troppo a lungo o il server dichiara di non avere Redis — il
 * polling è la rete sotto, non un ripiego da spegnere in fretta.
 */

/** Oltre questo silenzio si torna al polling: il keepalive del server è 25s. */
const SILENZIO_MASSIMO_MS = 40_000;

/** Un rinfresco per pannello ogni tre secondi: un voto non deve valere una GET. */
const THROTTLE_MS = 3_000;

/** Le chiavi SWR di un pannello, per evento. Il confronto è per prefisso perché
 *  l'agenda aggiunge l'identificativo dell'ospite alla propria. */
function prefissoChiave(slug: string, panel: PokeablePanel): string {
  const base = `/api/events/${slug}`;
  switch (panel) {
    case 'qa':
      return `${base}/questions`;
    case 'polls':
      return `${base}/polls`;
    case 'agenda':
      return `${base}/agenda`;
    case 'wordcloud':
      return `${base}/wordcloud`;
  }
}

/**
 * Il canale è uno solo per sala, ma a doverlo sapere sono i pannelli, che
 * stanno diversi livelli più in basso. Passare una prop lungo tutta la catena
 * avrebbe toccato ogni componente in mezzo senza che a nessuno serva.
 */
export const LivePushContext = createContext(false);

/** Vero quando il canale sta consegnando: il pannello può spegnere il proprio
 *  intervallo di interrogazione. Falso è sempre una risposta sicura — significa
 *  soltanto continuare a fare quello che si faceva prima. */
export function useLivePush(): boolean {
  return useContext(LivePushContext);
}

export interface LiveStateHook {
  /** Vero quando il canale è aperto e sta consegnando: i pannelli possono
   *  spegnere il proprio intervallo. */
  pushLive: boolean;
  /** Ultimi flag arrivati dal canale, o null se non ne sono ancora arrivati. */
  flags: LiveFlags | null;
  /** Ultimo stato dell'evento arrivato dal canale. */
  eventStatus: string | null;
}

export function useLiveState(eventSlug: string, attivo = true): LiveStateHook {
  const [pushLive, setPushLive] = useState(false);
  const [flags, setFlags] = useState<LiveFlags | null>(null);
  const [eventStatus, setEventStatus] = useState<string | null>(null);

  const ultimoMessaggioRef = useRef<number>(0);
  const ultimoRinfrescoRef = useRef<Record<string, number>>({});

  const rinfresca = useCallback(
    (panel: PokeablePanel) => {
      const adesso = Date.now();
      const ultimo = ultimoRinfrescoRef.current[panel] ?? 0;
      if (adesso - ultimo < THROTTLE_MS) return;
      ultimoRinfrescoRef.current[panel] = adesso;

      const prefisso = prefissoChiave(eventSlug, panel);
      // Un piccolo scarto casuale: con trecento partecipanti in sala, senza,
      // rileggerebbero tutti nella stessa manciata di millisecondi.
      const scarto = Math.floor(Math.random() * 500);
      setTimeout(() => {
        void globalMutate(
          (chiave) => typeof chiave === 'string' && chiave.startsWith(prefisso),
        );
      }, scarto);
    },
    [eventSlug],
  );

  useEffect(() => {
    if (!attivo || !eventSlug) return;

    const sorgente = new EventSource(`/api/events/${eventSlug}/live/stream`);
    let vivo = true;

    sorgente.onmessage = (evento: MessageEvent<string>) => {
      ultimoMessaggioRef.current = Date.now();
      let busta: LiveEnvelope | { op: 'hello'; pushAvailable: boolean };
      try {
        busta = JSON.parse(evento.data);
      } catch {
        return;
      }

      switch (busta.op) {
        case 'hello':
          // Senza Redis il server non pubblichera' mai nulla: restare in ascolto
          // spegnendo il polling lascerebbe i pannelli fermi per sempre.
          if (vivo) setPushLive(busta.pushAvailable);
          break;
        case 'flags':
          if (vivo) setFlags(busta.flags);
          void globalMutate(`/api/events/${eventSlug}/flags`, busta.flags, {
            revalidate: false,
          });
          break;
        case 'eventStatus':
          if (vivo) setEventStatus(busta.status);
          break;
        case 'poke':
          rinfresca(busta.panel);
          break;
      }
    };

    sorgente.onerror = () => {
      // EventSource riprova da solo; nel frattempo i pannelli tornano a
      // interrogare il server, altrimenti resterebbero fermi durante il buco.
      if (vivo) setPushLive(false);
    };

    // Guardia: un canale che tace piu' del keepalive e' un canale morto, e la
    // riconnessione automatica non sempre se ne accorge. Si guarda solo a
    // scheda visibile: in secondo piano il browser rallenta i timer.
    const guardia = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const ultimo = ultimoMessaggioRef.current;
      if (ultimo > 0 && Date.now() - ultimo > SILENZIO_MASSIMO_MS && vivo) {
        setPushLive(false);
      }
    }, 5_000);

    return () => {
      vivo = false;
      clearInterval(guardia);
      sorgente.close();
      setPushLive(false);
    };
  }, [eventSlug, attivo, rinfresca]);

  return { pushLive, flags, eventStatus };
}
