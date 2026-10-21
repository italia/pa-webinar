'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import {
  ATTESA_INGRESSO_MS,
  DURATA_MASSIMA_RIENTRO_MS,
  RIENTRO_LUNGO_MS,
  attesaTentativo,
  richiestaJson,
  statoEvento,
} from '@/lib/jitsi/riconnessione';

/**
 * Un rientro automatico nella chiamata dopo una caduta: il tentativo in corso,
 * da quando dura, e se la chiamata è già rimontata e aspetta solo di entrare.
 */
export interface StatoRientro {
  tentativo: number;
  dal: number;
  montata: boolean;
}

export type EsitoToken = 'fatto' | 'rete' | 'gestito';

interface OpzioniRientro {
  /** La persona è in sala (fase della chiamata): fuori, un rientro si annulla. */
  inSala: boolean;
  slug: string;
  /** Chiede al portale un token nuovo: 'fatto', 'rete' (si riprova) o
   *  'gestito' (il portale ha dato una risposta definitiva e la sala ha già
   *  cambiato schermata: evento non più aperto agli ingressi, link non
   *  valido). */
  richiediToken: () => Promise<EsitoToken>;
  /** L'evento risulta concluso. */
  onConcluso: () => void;
  /** Il rientro dura troppo: la scelta passa alla persona. */
  onRinuncia: () => void;
}

export interface Rientro {
  rientro: StatoRientro | null;
  /** Lo stesso stato, per i gestori degli eventi che non si ricreano. */
  rientroRef: MutableRefObject<StatoRientro | null>;
  /** Cambia a ogni rimontaggio della chiamata: va usata come sua chiave. */
  montaggio: number;
  /** Il rientro dura da un po': conviene suggerire di guardare la rete. */
  lungo: boolean;
  /** Fa partire un rientro; false se ce n'è già uno in corso. */
  avvia: () => boolean;
  /** La chiamata è di nuovo dentro: il rientro è finito. */
  concludi: () => void;
}

/**
 * Il rientro dopo una caduta (lib/jitsi/riconnessione). A ogni tentativo: il
 * portale risponde? l'evento è concluso? Poi un token nuovo, come a ogni
 * ingresso: decide il portale chi può entrare e in quale stato dell'evento
 * (chi conduce anche prima dell'avvio, chi partecipa trova la sala d'attesa
 * se il bridge è stato spento), e il token porta le regole correnti della
 * sala. Infine la chiamata si rimonta. Un tentativo a vuoto (rete ancora
 * assente) fa partire il prossimo, con un'attesa che cresce, e subito quando
 * il browser torna online; una chiamata rimontata che non entra in tempo si
 * rimonta da capo. Dopo DURATA_MASSIMA_RIENTRO_MS la scelta passa alla
 * persona. Niente sala d'attesa, niente consensi, niente clic.
 */
export function useRientro({
  inSala,
  slug,
  richiediToken,
  onConcluso,
  onRinuncia,
}: OpzioniRientro): Rientro {
  const [rientro, setRientro] = useState<StatoRientro | null>(null);
  const rientroRef = useRef<StatoRientro | null>(null);
  const [montaggio, setMontaggio] = useState(0);
  const [lungo, setLungo] = useState(false);

  const aggiorna = useCallback((prossimo: StatoRientro | null) => {
    rientroRef.current = prossimo;
    setRientro(prossimo);
  }, []);

  // I gestori cambiano a ogni render del chiamante: si leggono da qui, così
  // un tentativo già programmato non riparte da capo.
  const gestori = useRef({ richiediToken, onConcluso, onRinuncia });
  useEffect(() => {
    gestori.current = { richiediToken, onConcluso, onRinuncia };
  });

  // Troppo a lungo: il rientro finisce e la scelta passa alla persona.
  const rinunciaSeScaduto = useCallback(
    (corrente: StatoRientro): boolean => {
      if (Date.now() - corrente.dal <= DURATA_MASSIMA_RIENTRO_MS) return false;
      aggiorna(null);
      gestori.current.onRinuncia();
      return true;
    },
    [aggiorna]
  );

  const avvia = useCallback(() => {
    if (rientroRef.current) return false;
    aggiorna({ tentativo: 1, dal: Date.now(), montata: false });
    return true;
  }, [aggiorna]);

  const concludi = useCallback(() => {
    if (rientroRef.current) aggiorna(null);
  }, [aggiorna]);

  // Fuori dalla sala (fine, uscita, errore, sala d'attesa) un rientro in
  // corso non ha più senso.
  useEffect(() => {
    if (!inSala && rientroRef.current) aggiorna(null);
  }, [inSala, aggiorna]);

  // Un tentativo, e il prossimo se va a vuoto.
  useEffect(() => {
    if (!inSala || !rientro || rientro.montata) return;
    let annullato = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const prossimo = () => {
      const corrente = rientroRef.current;
      if (annullato || !corrente || rinunciaSeScaduto(corrente)) return;
      aggiorna({ ...corrente, tentativo: corrente.tentativo + 1 });
    };

    const prova = async () => {
      timer = null;
      const inizio = rientroRef.current;
      if (annullato || !inizio || rinunciaSeScaduto(inizio)) return;
      const status = statoEvento(await richiestaJson(`/api/events/${slug}/lifecycle`));
      if (annullato) return;
      if (!status) {
        prossimo();
        return;
      }
      if (status === 'ENDED') {
        aggiorna(null);
        gestori.current.onConcluso();
        return;
      }
      const esito = await gestori.current.richiediToken();
      if (annullato || esito === 'gestito') return;
      if (esito === 'rete') {
        prossimo();
        return;
      }
      const corrente = rientroRef.current;
      if (!corrente) return;
      setMontaggio((n) => n + 1);
      aggiorna({ ...corrente, montata: true });
    };

    timer = setTimeout(
      () => void prova(),
      attesaTentativo(rientro.tentativo, Math.random())
    );
    // Rete tornata: si prova subito, sempre un po' sparsi fra chi rientra.
    const tornataOnline = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = setTimeout(() => void prova(), attesaTentativo(1, Math.random()));
    };
    window.addEventListener('online', tornataOnline);
    return () => {
      annullato = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', tornataOnline);
    };
  }, [inSala, rientro, slug, aggiorna, rinunciaSeScaduto]);

  // La chiamata rimontata che non arriva in sala in tempo si rimonta da capo.
  useEffect(() => {
    if (!inSala || !rientro?.montata) return;
    const timer = setTimeout(() => {
      const corrente = rientroRef.current;
      if (!corrente?.montata || rinunciaSeScaduto(corrente)) return;
      aggiorna({ ...corrente, tentativo: corrente.tentativo + 1, montata: false });
    }, ATTESA_INGRESSO_MS);
    return () => clearTimeout(timer);
  }, [inSala, rientro, aggiorna, rinunciaSeScaduto]);

  // Il testo del rientro cambia se dura: allora conviene guardare la rete.
  const dal = rientro?.dal ?? null;
  useEffect(() => {
    setLungo(false);
    if (dal === null) return;
    const timer = setTimeout(() => setLungo(true), RIENTRO_LUNGO_MS);
    return () => clearTimeout(timer);
  }, [dal]);

  return { rientro, rientroRef, montaggio, lungo, avvia, concludi };
}
