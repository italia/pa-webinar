/**
 * Rientro automatico nella videochiamata dopo una caduta della connessione.
 *
 * Le cadute brevi le assorbe Jitsi da sé: con la WebSocket XMPP la sessione
 * riprende (Prosody la tiene in sospeso per un minuto, `smacks`) e il bridge
 * ricollega i media, senza uscire dalla conferenza e senza un nuovo posto in
 * sala. Quando invece la conferenza è persa davvero (sessione scaduta sul
 * server, Prosody o Jicofo riavviati), Jitsi mostra la sua finestra «Sei stato
 * disconnesso» e ricarica la propria pagina dopo 10-30 secondi, con le scelte
 * di partenza (microfono e videocamera spenti) e con il token di allora, anche
 * se è scaduto. La sala fa prima e meglio: rimonta la chiamata appena il
 * portale risponde, con un token nuovo (il portale ricontrolla chi può
 * entrare, come per ogni ingresso) e con microfono e videocamera come li
 * aveva la persona.
 *
 * Qui stanno le regole, senza React, per poterle verificare da sole.
 */

/**
 * Una chiamata rimontata che non arriva in sala entro questo tempo si
 * rimonta da capo. Largo: a rete lenta la pagina della videochiamata può
 * metterci, e ogni nuovo montaggio chiede un nuovo posto in sala.
 */
export const ATTESA_INGRESSO_MS = 45_000;

/** Da quando il rientro dura così, il testo suggerisce di controllare la rete. */
export const RIENTRO_LUNGO_MS = 30_000;

/**
 * Per quanto la sala riprova da sola. Dopo, la persona trova la schermata di
 * uscita con «Rientra»: una sala che riprova per sempre, a rete assente da
 * ore, non serve a nessuno.
 */
export const DURATA_MASSIMA_RIENTRO_MS = 10 * 60_000;

/** Quanto aspettare la risposta del portale prima di considerarla persa. */
export const ATTESA_RISPOSTA_MS = 5_000;

/**
 * Prove di fila senza risposta dal portale, a chiamata in corso, prima di dire
 * che la connessione è instabile: una sola può essere un singhiozzo.
 */
export const PROVE_FALLITE_INSTABILE = 2;

/**
 * Attesa prima del tentativo `n` (da 1). Il primo parte presto, ma sparso su
 * qualche secondo: quando cade la connessione di tutti insieme (un nodo del
 * cluster che si sposta) non rientrano tutti nello stesso istante. Poi a passi
 * crescenti, fino a un tetto. `caso` in [0, 1).
 */
export function attesaTentativo(n: number, caso: number): number {
  const passi = [500, 2_000, 4_000, 8_000, 15_000];
  const base = passi[Math.min(Math.max(n, 1), passi.length) - 1] ?? 15_000;
  const sparso = n <= 1 ? 2_500 : 2_000;
  return base + Math.round(Math.min(Math.max(caso, 0), 1) * sparso);
}

/**
 * Se un errore della videochiamata (evento `errorOccurred` dell'IFrame API)
 * vuol dire conferenza persa: gli errori che Jitsi stesso considera fatali,
 * della connessione o della conferenza. Sono quelli per cui Jitsi
 * ricaricherebbe la sua pagina: la sala rientra prima, a modo suo.
 */
export function erroreDaRientro(evento: unknown): boolean {
  const errore = (
    evento as { error?: { isFatal?: unknown; type?: unknown } } | null | undefined
  )?.error;
  if (!errore || errore.isFatal !== true) return false;
  return errore.type === 'CONNECTION' || errore.type === 'CONFERENCE';
}

/** Microfono e videocamera della persona: true = acceso. */
export interface StatoMedia {
  audio: boolean;
  video: boolean;
}

/** Lo stato aggiornato da un cambio riferito da Jitsi (`muted` del suo evento). */
export function conCambioMedia(
  stato: StatoMedia,
  mezzo: keyof StatoMedia,
  muto: unknown
): StatoMedia {
  if (typeof muto !== 'boolean') return stato;
  const acceso = !muto;
  return stato[mezzo] === acceso ? stato : { ...stato, [mezzo]: acceso };
}

/**
 * Cosa dice la sala della connessione, a chiamata in corso: `instabile` quando
 * il browser si dice offline o il portale non risponde da qualche prova. Jitsi
 * intanto prova a riprendere da sé: la sala lo dice con discrezione, senza
 * toccare la chiamata.
 */
export function connessioneInstabile(proveFallite: number, online: boolean): boolean {
  return !online || proveFallite >= PROVE_FALLITE_INSTABILE;
}

/** Una risposta del portale, con il corpo già letto (null se non è JSON). */
export interface RispostaJson {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Una richiesta al portale con un tempo massimo che vale anche per la lettura
 * del corpo: a rete caduta sia la richiesta sia il corpo possono restare
 * appesi per minuti. Un errore di rete o il tempo scaduto danno null; una
 * risposta del server, anche di errore, arriva con il suo stato. `attesaMs`
 * a 0: nessun tempo massimo.
 *
 * Il tempo lo conta un AbortController e non `AbortSignal.timeout`: questa
 * gira nel browser di chi partecipa, e nei browser meno recenti (Safari prima
 * della 16) quella funzione manca. Lì ogni richiesta fallirebbe e il rientro
 * non arriverebbe mai.
 */
export async function richiestaJson(
  url: string,
  {
    method = 'GET',
    body,
    attesaMs = ATTESA_RISPOSTA_MS,
  }: { method?: string; body?: string; attesaMs?: number } = {}
): Promise<RispostaJson | null> {
  const controllo = new AbortController();
  const timer = attesaMs > 0 ? setTimeout(() => controllo.abort(), attesaMs) : null;
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined
        ? { body, headers: { 'Content-Type': 'application/json' } }
        : {}),
      cache: 'no-store',
      signal: controllo.signal,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch (errore) {
      // Un corpo che non è JSON (la pagina d'errore di un proxy) è comunque
      // una risposta; un corpo che non arriva no.
      if (!(errore instanceof SyntaxError)) return null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Lo stato dell'evento in una risposta di `/lifecycle`, se c'è. */
export function statoEvento(risposta: RispostaJson | null): string | null {
  if (!risposta?.ok) return null;
  const status = (risposta.data as { status?: unknown } | null)?.status;
  return typeof status === 'string' ? status : null;
}
