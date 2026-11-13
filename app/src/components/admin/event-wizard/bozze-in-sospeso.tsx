// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';

/**
 * I moduli del wizard che si confermano con un pulsante («Aggiungi»: enti,
 * persone, inviti, categorie, argomenti incollati) tengono cio' che si scrive
 * in uno stato loro, finche' non lo si conferma. Chi compila e passa al passo
 * dopo senza confermare lo perdeva senza saperlo.
 *
 * Ogni modulo montato si registra qui e dice se ha qualcosa di scritto e non
 * aggiunto. Il wizard, prima di cambiare passo (anche all'indietro: il passo
 * lasciato si smonta e la bozza con lui) o di salvare, chiede il primo modulo
 * in sospeso nell'ordine della pagina: se c'e', resta dov'e', il modulo
 * mostra il perche' e il fuoco va sul suo pulsante. Si conferma o si svuota,
 * e si va avanti.
 */

export interface BozzaInSospeso {
  messaggio: string;
  /** Porta chi compila al modulo: apre la sezione e mette il fuoco. */
  mostra: () => void;
}

interface Voce {
  controllo: () => BozzaInSospeso | null;
  /** Il pulsante che conferma il modulo: dice dove sta nella pagina. */
  elemento: () => HTMLElement | null;
}

export interface RegistroBozze {
  registra: (voce: Voce) => () => void;
  /** Il primo modulo compilato e non aggiunto, nell'ordine della pagina. */
  primaInSospeso: () => BozzaInSospeso | null;
}

function primaNellaPagina(a: HTMLElement | null, b: HTMLElement | null): number {
  if (!a || !b || a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function creaRegistroBozze(): RegistroBozze {
  const voci = new Set<Voce>();
  return {
    registra(voce) {
      voci.add(voce);
      return () => {
        voci.delete(voce);
      };
    },
    primaInSospeso() {
      const aperte = [...voci]
        .map((voce) => ({ esito: voce.controllo(), elemento: voce.elemento() }))
        .filter(
          (v): v is { esito: BozzaInSospeso; elemento: HTMLElement | null } =>
            v.esito !== null
        )
        .sort((a, b) => primaNellaPagina(a.elemento, b.elemento));
      return aperte[0]?.esito ?? null;
    },
  };
}

export const RegistroBozzeContext = createContext<RegistroBozze | null>(null);

/**
 * Registra un modulo da confermare. `inSospeso` dice se c'e' qualcosa di
 * scritto e non aggiunto (false se il pulsante non si puo' premere: non si
 * chiede un gesto impossibile); `pulsante` e' il pulsante che lo conferma,
 * dove va il fuoco; `segnala` mostra il messaggio accanto al modulo, e lo
 * toglie (null) quando il modulo torna vuoto.
 */
export function useBozzaInSospeso(
  inSospeso: boolean,
  pulsante: RefObject<HTMLElement | null>,
  segnala: (messaggio: string | null) => void
) {
  const registro = useContext(RegistroBozzeContext);
  const t = useTranslations('admin.wizard');
  const messaggio = t('unaddedEntry');
  const stato = useRef({ inSospeso, segnala, messaggio });
  // Prima che il browser dipinga: un clic che segue un aggiornamento
  // asincrono (un caricamento finito) legge gia' lo stato nuovo.
  useLayoutEffect(() => {
    stato.current = { inSospeso, segnala, messaggio };
  });

  // L'avviso dato si toglie quando il modulo torna vuoto: chi ha svuotato i
  // campi ha fatto cio' che diceva.
  const segnalato = useRef(false);
  useEffect(() => {
    if (!inSospeso && segnalato.current) {
      segnalato.current = false;
      stato.current.segnala(null);
    }
  }, [inSospeso]);

  useEffect(() => {
    if (!registro) return;
    return registro.registra({
      elemento: () => pulsante.current,
      controllo: () => {
        const { inSospeso: aperto, segnala: avvisa, messaggio: testo } = stato.current;
        if (!aperto) return null;
        return {
          messaggio: testo,
          mostra: () => {
            segnalato.current = true;
            avvisa(testo);
            const el = pulsante.current;
            if (!el) return;
            // Il modulo puo' stare in una sezione ripiegata.
            const sezione = el.closest('details');
            if (sezione && !sezione.open) sezione.open = true;
            el.scrollIntoView?.({ block: 'center' });
            el.focus({ preventScroll: true });
          },
        };
      },
    });
  }, [registro, pulsante]);
}
