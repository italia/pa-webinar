/**
 * Indicatore «sta scrivendo» della chat: regole pure, senza React né rete.
 *
 * Il protocollo ha tre pezzi:
 *   - chi scrive avvisa con `POST /chat/typing` al più ogni `TYPING_PING_MS`
 *     finché compone (`shouldPing`);
 *   - lo stream SSE della chat consegna gli avvisi come `event: typing` con un
 *     `TypingPayload` (mai come `event: message`: un client della versione
 *     precedente lo aggiungerebbe alla lista come messaggio);
 *   - chi legge tiene una mappa di chi sta scrivendo (`applyTyping`), la sfoltisce
 *     quando un avviso non si rinnova entro `TYPING_TTL_MS` (`pruneTyping`) e la
 *     svuota per chi ha appena inviato (`clearTyping`).
 *
 * Non esiste un avviso di «ho smesso»: si smette di mostrare una persona quando
 * i suoi avvisi non arrivano più. Un avviso perso costa qualche secondo di
 * indicatore mancante, mai un indicatore acceso per sempre.
 *
 * Le funzioni non mutano la mappa ricevuta: ne restituiscono una nuova quando
 * qualcosa cambia e la STESSA istanza quando nulla cambia, così uno stato React
 * aggiornato con il risultato non provoca un nuovo render a vuoto.
 */

/** Intervallo minimo fra due avvisi di chi sta scrivendo. */
export const TYPING_PING_MS = 3000;

/** Dopo quanto, senza un nuovo avviso, una persona smette di risultare attiva.
 *  Più largo di `TYPING_PING_MS`: un avviso in ritardo non fa lampeggiare
 *  l'indicatore. */
export const TYPING_TTL_MS = 5000;

/** Oltre queste lunghezze un avviso ricevuto è considerato malformato. I nomi
 *  validati dal server restano molto sotto; la chiave è di 16 caratteri. */
const SENDER_KEY_MAX = 64;
const SENDER_NAME_MAX = 200;

/** Quello che lo stream consegna con `event: typing`. */
export interface TypingPayload {
  /** Chiave opaca del mittente (la stessa `senderKey` dei messaggi). */
  senderKey: string;
  /** Il nome con cui la sala vede i suoi messaggi. */
  senderName: string;
}

export interface TypingEntry {
  name: string;
  /** Istante (ms, stesso orologio di `now`) oltre il quale non è più attiva. */
  until: number;
}

/**
 * Chi sta scrivendo. La chiave è opaca: si legge e si modifica solo con le
 * funzioni di questo modulo. Combina chiave e nome del mittente perché un posto
 * condiviso (il link primario del moderatore) ha la stessa chiave per più
 * persone, che si distinguono solo per il nome.
 */
export type TypingState = Map<string, TypingEntry>;

export type TypingLabel =
  | { kind: 'none' }
  | { kind: 'one'; name: string }
  | { kind: 'two'; a: string; b: string }
  | { kind: 'many' };

/** Chi è il client stesso, per non mostrargli il proprio «sta scrivendo». */
export interface TypingSelf {
  key?: string;
  name?: string;
}

function entryKey(senderKey: string, senderName: string): string {
  return `${senderKey}\n${senderName}`;
}

/**
 * Un avviso ricevuto ridotto alla forma attesa, o null se non lo è. Copia solo i
 * due campi noti: un campo in più, pubblicato da un'altra versione, non arriva
 * a chi lo legge.
 */
export function parseTypingPayload(raw: unknown): TypingPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const { senderKey, senderName } = raw as Record<string, unknown>;
  if (typeof senderKey !== 'string' || typeof senderName !== 'string') return null;
  if (senderKey.length === 0 || senderKey.length > SENDER_KEY_MAX) return null;
  const name = senderName.trim();
  if (name.length === 0 || name.length > SENDER_NAME_MAX) return null;
  return { senderKey, senderName: name };
}

/**
 * Se è ora di mandare un nuovo avviso. `lastPingAt` è 0 (o un istante qualunque
 * nel passato lontano) prima del primo. Un orologio tornato indietro conta come
 * «è ora»: altrimenti gli avvisi si fermerebbero finché non lo raggiunge.
 */
export function shouldPing(lastPingAt: number, now: number): boolean {
  return now < lastPingAt || now - lastPingAt >= TYPING_PING_MS;
}

/**
 * Registra un avviso: la persona risulta attiva fino a `now + TYPING_TTL_MS`.
 *
 * Il client ignora sé stesso: per chiave quando la conosce (la riceve nella
 * risposta al primo messaggio inviato), altrimenti per nome. Con la chiave
 * nota il nome non conta: per un relatore o un moderatore nominale il server
 * usa il nome registrato, che può non coincidere con quello del client.
 */
export function applyTyping(
  state: TypingState,
  payload: TypingPayload,
  now: number,
  self?: TypingSelf,
): TypingState {
  const valid = parseTypingPayload(payload);
  if (!valid) return state;
  if (self?.key) {
    if (valid.senderKey === self.key) return state;
  } else {
    const selfName = self?.name?.trim();
    if (selfName && valid.senderName === selfName) return state;
  }
  const next = new Map(state);
  next.set(entryKey(valid.senderKey, valid.senderName), {
    name: valid.senderName,
    until: now + TYPING_TTL_MS,
  });
  return next;
}

/** Toglie chi non ha rinnovato l'avviso in tempo. */
export function pruneTyping(state: TypingState, now: number): TypingState {
  let next: TypingState | null = null;
  for (const [key, entry] of state) {
    if (entry.until > now) continue;
    next ??= new Map(state);
    next.delete(key);
  }
  return next ?? state;
}

/**
 * Toglie un mittente il cui messaggio è appena arrivato: ha smesso di scrivere,
 * e l'indicatore non deve restare acceso accanto al suo messaggio. Con il nome
 * si toglie solo quella persona; senza, ogni persona con quella chiave.
 */
export function clearTyping(
  state: TypingState,
  senderKey: string,
  senderName?: string,
): TypingState {
  if (!senderKey) return state;
  const name = senderName?.trim();
  if (name) {
    const key = entryKey(senderKey, name);
    if (!state.has(key)) return state;
    const next = new Map(state);
    next.delete(key);
    return next;
  }
  const prefix = `${senderKey}\n`;
  let next: TypingState | null = null;
  for (const key of state.keys()) {
    if (!key.startsWith(prefix)) continue;
    next ??= new Map(state);
    next.delete(key);
  }
  return next ?? state;
}

/**
 * Cosa mostrare. Il testo lo compone il client con le sue traduzioni: qui si
 * decide solo la forma. Da tre persone in su non si elencano i nomi.
 */
export function typingLabel(names: string[]): TypingLabel {
  if (names.length === 0) return { kind: 'none' };
  if (names.length === 1) return { kind: 'one', name: names[0]! };
  if (names.length === 2) return { kind: 'two', a: names[0]!, b: names[1]! };
  return { kind: 'many' };
}
