/**
 * I limiti per indirizzo di quello che si fa nella sala e nella piazza
 * (presenza, reazioni, voti, domande, valutazioni, token degli ospiti),
 * scalati insieme.
 *
 * I valori scritti nelle rotte valgono per un ufficio: qualche persona dietro
 * la stessa uscita su internet. Quando il pubblico e' nello stesso luogo e
 * passa tutto dal suo Wi-Fi, una sala intera ha un indirizzo solo, e quei
 * limiti ne fermerebbero la maggior parte. `ROOM_RATE_LIMIT_MULTIPLIER` li
 * moltiplica tutti. Vale per tutta l'installazione, non per un evento, e sta
 * nella configurazione del pod: chi la gestisce lo imposta prima di un evento
 * cosi' e lo riporta a 1 dopo, sapendo che alza anche quanto puo' fare da solo
 * chi abusa da un indirizzo. I limiti per persona (per iscrizione, mittente,
 * votante) non cambiano.
 */

const avvisati = new Set<string>();

/**
 * Un intero da una variabile d'ambiente, lato server. Mancante: il
 * predefinito. Oltre il massimo: il massimo, perche' chi ha scritto un numero
 * grande voleva un limite largo. Qualunque altra cosa: il predefinito. Negli
 * ultimi due casi un avviso, una volta per ogni valore sbagliato.
 */
function interoDaAmbiente(
  nome: string,
  {
    predefinito,
    minimo,
    massimo,
  }: { predefinito: number; minimo: number; massimo: number }
): number {
  const testo = process.env[nome]?.trim() ?? '';
  if (testo === '') return predefinito;
  let valore = predefinito;
  let avviso = `non e' un intero: uso ${predefinito}`;
  if (/^\d+$/.test(testo)) {
    const n = Number(testo);
    if (n > massimo) {
      valore = massimo;
      avviso = `oltre ${massimo}: uso ${massimo}`;
    } else if (n < minimo) {
      avviso = `sotto ${minimo}: uso ${predefinito}`;
    } else {
      return n;
    }
  }
  if (!avvisati.has(`${nome}=${testo}`)) {
    avvisati.add(`${nome}=${testo}`);
    console.warn(`[rate-limit] ${nome}="${testo}" ${avviso}`);
  }
  return valore;
}

/** Nella piazza, duecento browser dietro un indirizzo. */
const MOLTIPLICATORE_MASSIMO = 100;

export function moltiplicatoreSala(): number {
  return interoDaAmbiente('ROOM_RATE_LIMIT_MULTIPLIER', {
    predefinito: 1,
    minimo: 1,
    massimo: MOLTIPLICATORE_MASSIMO,
  });
}

/** Il limite per indirizzo di un'azione della sala, scalato per il luogo. */
export function limiteDellaSala(base: number): number {
  return base * moltiplicatoreSala();
}

/**
 * Token da ospite al minuto per indirizzo: GUEST_JWT_RATE_LIMIT_PER_MINUTE,
 * 120 se manca, scalato con gli altri limiti della sala. Zero resta zero,
 * come prima del moltiplicatore: il limitatore lascia comunque passare la
 * prima richiesta di ogni minuto.
 */
export function limiteTokenOspiti(): number {
  return limiteDellaSala(
    interoDaAmbiente('GUEST_JWT_RATE_LIMIT_PER_MINUTE', {
      predefinito: 120,
      minimo: 0,
      massimo: Number.MAX_SAFE_INTEGER,
    })
  );
}
