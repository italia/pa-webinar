'use client';

import { useEffect, useRef, useState } from 'react';

import type { Luogo, Presenze } from '@/lib/live/presence';

/** Ogni quanto la scheda dice che c'è: più spesso in attesa, dove i numeri si
 *  guardano, meno in diretta, dove servono solo a chi aspetta. La finestra
 *  del server (lib/live/presence) copre più di due segnali persi. */
const INTERVALLO_MS: Record<Luogo, number> = { attesa: 15_000, diretta: 30_000 };

function nuovoId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

function lascia(slug: string, id: string, luogo: Luogo, token: string | undefined): void {
  try {
    void fetch(`/api/events/${slug}/presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ id, luogo, lascia: true }),
      keepalive: true,
    });
  } catch {
    /* la finestra del server lo toglierà comunque */
  }
}

/**
 * Dice al server dove si trova questa pagina (sala d'attesa o diretta) e
 * restituisce quanti sono in diretta e quanti in attesa (vedi
 * lib/live/presence). L'identificativo è casuale e vale per questo caricamento
 * della pagina: una scheda duplicata conta per sé. Cambiare luogo si segnala
 * subito e sposta lo stesso identificativo; chiudere la pagina, o uscire
 * dalla sala, lo toglie dal conto.
 */
export function usePresenze(
  slug: string,
  luogo: Luogo,
  attivo: boolean,
  token?: string,
): Presenze | null {
  const [presenze, setPresenze] = useState<Presenze | null>(null);
  const idRef = useRef<string | null>(null);
  if (idRef.current === null && typeof window !== 'undefined') idRef.current = nuovoId();

  useEffect(() => {
    const id = idRef.current;
    if (!attivo || !id) return;
    let annullato = false;
    const segnala = async () => {
      try {
        const res = await fetch(`/api/events/${slug}/presence`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id, luogo }),
        });
        if (!res.ok || annullato) return;
        const dati = (await res.json()) as { inDiretta: number | null; inAttesa: number | null };
        setPresenze(
          dati.inDiretta === null || dati.inAttesa === null
            ? null
            : { inDiretta: dati.inDiretta, inAttesa: dati.inAttesa },
        );
      } catch {
        /* si riprova al giro dopo */
      }
    };
    void segnala();
    const timer = setInterval(() => void segnala(), INTERVALLO_MS[luogo]);
    return () => {
      annullato = true;
      clearInterval(timer);
    };
  }, [slug, luogo, attivo, token]);

  // Uscire dalla sala (fine, errore, «esci») toglie subito dal conto.
  const eraAttivo = useRef(attivo);
  useEffect(() => {
    const id = idRef.current;
    if (eraAttivo.current && !attivo && id) {
      lascia(slug, id, luogo, token);
      setPresenze(null);
    }
    eraAttivo.current = attivo;
  }, [attivo, slug, luogo, token]);

  // Chiudere la pagina, o andare altrove, toglie subito dal conto.
  useEffect(() => {
    const id = idRef.current;
    if (!attivo || !id) return;
    const alChiudere = () => lascia(slug, id, luogo, token);
    window.addEventListener('pagehide', alChiudere);
    return () => window.removeEventListener('pagehide', alChiudere);
  }, [slug, luogo, attivo, token]);

  return presenze;
}
