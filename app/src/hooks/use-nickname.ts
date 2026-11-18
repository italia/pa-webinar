// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  difettoDiForma,
  normalizzaNickname,
  type MotivoNickname,
} from '@/lib/live/nickname-rule';

/** Perche' il nickname non e' passato: un motivo delle regole, o la rete. */
/** Perche' il nickname non e' passato: un motivo delle regole, l'evento che non
 *  ne accetta di nuovi (`disabled`) o la rete. `nickname`: quello rifiutato,
 *  quando il rifiuto arriva dalla sala all'ingresso. */
export type ErroreNickname = {
  motivo: MotivoNickname | 'disabled' | 'rete';
  suggerimento?: string;
  nickname?: string;
};

/** Il nickname confermato della visita, per chi non lo salva sull'iscrizione. */
const chiaveVisita = (eventId: string) => `pa-nickname:${eventId}`;

export function leggiNicknameVisita(eventId: string): string | null {
  try {
    return window.sessionStorage.getItem(chiaveVisita(eventId));
  } catch {
    return null;
  }
}

export function salvaNicknameVisita(eventId: string, nickname: string | null): void {
  try {
    if (nickname) window.sessionStorage.setItem(chiaveVisita(eventId), nickname);
    else window.sessionStorage.removeItem(chiaveVisita(eventId));
  } catch {
    /* senza la memoria della scheda il nickname vale fino al ricaricamento */
  }
}

/**
 * Il campo del nickname (lib/live/nickname): cio' che la persona scrive, il
 * nickname confermato dal server e l'esito dell'ultimo controllo.
 *
 * `conferma` lo manda a PUT /api/events/{slug}/nickname: chi si e' iscritto,
 * dal suo browser, lo salva sull'iscrizione; gli altri lo provano soltanto, e
 * la rotta del token lo prende all'ingresso. Risolve con il nickname
 * confermato (null: nessuno) o con false se non e' passato. Il campo vuoto
 * toglie il nickname.
 */
export function useNickname({
  eventSlug,
  eventId,
  token,
  iniziale,
}: {
  eventSlug: string;
  eventId: string;
  /** Il token della persona (iscrizione), se ne ha uno: lo prova alla rotta. */
  token?: string;
  iniziale: string | null;
}) {
  const [valore, setValore] = useState(iniziale ?? '');
  const [confermato, setConfermato] = useState<string | null>(iniziale);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<ErroreNickname | null>(null);

  // Il nickname della visita, dopo un ricaricamento: la scheda lo ricorda.
  // Letto dopo il primo disegno, perche' server e browser partano uguali.
  useEffect(() => {
    if (iniziale !== null || !eventId) return;
    const visita = leggiNicknameVisita(eventId);
    if (visita) {
      setValore(visita);
      setConfermato(visita);
    }
  }, [iniziale, eventId]);

  const scrivi = useCallback((v: string) => {
    setValore(v);
    setErrore(null);
  }, []);

  /** Un nickname rifiutato dalla sala: torna nel campo da rivedere, con il
   *  motivo, e non vale come confermato. */
  const segnalaRifiuto = useCallback((e: ErroreNickname) => {
    if (e.nickname !== undefined) {
      setValore(e.nickname);
      setConfermato(null);
    }
    setErrore(e);
  }, []);

  /** Riparte da un nickname noto (quello in uso in sala). */
  const reimposta = useCallback((v: string | null) => {
    setValore(v ?? '');
    setConfermato(v);
    setErrore(null);
  }, []);

  const daConfermare = normalizzaNickname(valore) !== (confermato ?? '');

  const conferma = useCallback(
    async (richiesto: string = valore): Promise<string | null | false> => {
      const nick = normalizzaNickname(richiesto);
      const difetto = nick ? difettoDiForma(nick) : null;
      if (difetto) {
        setErrore({ motivo: difetto });
        return false;
      }
      setInCorso(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/nickname`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ nickname: nick || null }),
          cache: 'no-store',
        });
        const dati = (await res.json().catch(() => null)) as {
          nickname?: string | null;
          saved?: boolean;
          code?: string;
          reason?: MotivoNickname;
          suggestion?: string;
        } | null;
        if (!res.ok) {
          setErrore(
            dati?.reason
              ? {
                  motivo: dati.reason,
                  ...(dati.suggestion ? { suggerimento: dati.suggestion } : {}),
                }
              : { motivo: dati?.code === 'NICKNAMES_DISABLED' ? 'disabled' : 'rete' }
          );
          return false;
        }
        const nuovo = dati?.nickname ?? null;
        setValore(nuovo ?? '');
        setConfermato(nuovo);
        setErrore(null);
        // Salvato sull'iscrizione lo ritrova il server; altrimenti vale per la
        // visita, e lo ricorda la scheda.
        salvaNicknameVisita(eventId, dati?.saved ? null : nuovo);
        return nuovo;
      } catch {
        setErrore({ motivo: 'rete' });
        return false;
      } finally {
        setInCorso(false);
      }
    },
    [valore, eventSlug, eventId, token]
  );

  return {
    valore,
    scrivi,
    reimposta,
    segnalaRifiuto,
    confermato,
    daConfermare,
    conferma,
    inCorso,
    errore,
    setErrore,
  };
}

export type StatoNickname = ReturnType<typeof useNickname>;
