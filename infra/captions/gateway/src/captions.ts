/**
 * Dal flusso di frammenti del motore ai sottotitoli.
 *
 * Il motore in streaming emette testo solo in coda (non riscrive le parole
 * già date) e mette lui la punteggiatura. Qui il testo si raccoglie in un
 * sottotitolo alla volta: ogni aggiornamento manda il testo intero del
 * sottotitolo corrente, perché il client sostituisce il provvisorio a ogni
 * messaggio. Un sottotitolo si chiude alla fine della frase (pausa della voce)
 * o quando diventa troppo lungo per due righe; in quel caso si spezza su un
 * confine di frase, di inciso o almeno di parola.
 */

export interface CaptionUpdate {
  messageId: string;
  text: string;
  final: boolean;
  /** La lingua del testo, quando la si conosce (quella della sessione del motore). */
  language?: string;
}

export interface AliasRule {
  /** La forma giusta, come nel glossario. */
  term: string;
  /** Come il riconoscimento la scrive sbagliata. */
  aliases: string[];
}

const SENTENCE_END = /[.!?…](?=\s)/g;
const LANGUAGE_TAG = /<[a-z]{2,3}-[A-Z]{2}>/g;
const CLAUSE_END = /[,;:](?=\s)/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sostituisce le forme sbagliate con il termine del glossario, a parola
 * intera e senza badare alle maiuscole. È deterministico: non inventa nulla
 * che il motore non abbia già scritto.
 */
export function makeRewriter(rules: AliasRule[]): (text: string) => string {
  const pairs: Array<[RegExp, string]> = [];
  for (const rule of rules) {
    const aliases = rule.aliases.map((a) => a.trim()).filter((a) => a.length > 0);
    if (!rule.term.trim() || aliases.length === 0) continue;
    // Le forme più lunghe per prime: "a bi ci" prima di "bi".
    aliases.sort((a, b) => b.length - a.length);
    const pattern = aliases.map((a) => escapeRegExp(a).replace(/\s+/g, '\\s+')).join('|');
    pairs.push([new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu'), rule.term]);
  }
  if (pairs.length === 0) return (text) => text;
  return (text) => pairs.reduce((acc, [re, term]) => acc.replace(re, term), text);
}

/** Un punto di taglio: su un confine di frase o d'inciso, su uno spazio permesso, o forzato. */
export interface Cut {
  at: number;
  kind: 'boundary' | 'space' | 'forced';
}

/**
 * Dove spezzare un testo troppo lungo: subito dopo l'ultimo confine utile
 * entro `limit`. Sullo spazio si evitano i punti che `forbidden` vieta,
 * finché ne resta uno non troppo vicino all'inizio; se non ce n'è, il taglio
 * è forzato sull'ultimo spazio.
 */
export function chooseCut(text: string, limit: number, forbidden?: (at: number) => boolean): Cut {
  const head = text.slice(0, limit + 1);
  for (const re of [SENTENCE_END, CLAUSE_END]) {
    let last = -1;
    for (const m of head.matchAll(re)) last = m.index + m[0].length;
    // Un confine troppo vicino all'inizio lascerebbe un sottotitolo di due
    // parole; un punto dentro un termine riscritto («p. a.») non è un confine.
    if (last >= limit / 3 && !forbidden?.(last)) return { at: last, kind: 'boundary' };
  }
  const space = head.lastIndexOf(' ');
  if (space <= 0) return { at: limit, kind: 'forced' };
  if (!forbidden) return { at: space, kind: 'space' };
  for (let at = space; at >= limit / 3; at = head.lastIndexOf(' ', at - 1)) {
    if (!forbidden(at)) return { at, kind: 'space' };
  }
  return { at: space, kind: 'forced' };
}

/** Parole da aspettare dopo un taglio in diretta, se le regole guardano avanti. */
const LOOKAHEAD_WORDS = 4;
/** Parole per lato con cui si giudica un taglio: bastano alle regole, e il costo resta fisso. */
const WINDOW_WORDS = 8;
/** Oltre questa lunghezza (in multipli del limite) non si rimanda più il taglio. */
const MAX_WAIT_FACTOR = 1.5;
// Le ultime e le prime parole intorno al taglio; ogni parola è seguita da
// spazi, così l'espressione non ha modi diversi di dividere la stessa parola.
const LEFT_WINDOW = new RegExp(`(?:\\S+\\s+){0,${WINDOW_WORDS - 1}}\\S+\\s*$`);
const RIGHT_WINDOW = new RegExp(`^\\s*(?:\\S+\\s+){0,${WINDOW_WORDS - 1}}\\S+`);

export class CaptionAssembler {
  private current = '';
  /** Tutto il testo arrivato dall'ultimo `commit` del motore, per riconoscere la coda del definitivo. */
  private sinceCommit = '';
  private counter = 0;
  private messageId: string;
  /** La lingua del testo aperto: le regole di riscrittura e l'etichetta dei sottotitoli. */
  private language: string | null = null;

  constructor(
    private readonly opts: {
      idPrefix: string;
      maxChars: number;
      rewrite?: (text: string, language: string | null) => string;
      /**
       * Se le regole di riscrittura di questa lingua dipendono dalle parole
       * che seguono (i numeri in italiano: «alle tre» è un'ora solo se dopo
       * viene «e mezza»): in diretta il taglio aspetta qualche parola.
       */
      readsAhead?: (language: string | null) => boolean;
    },
  ) {
    this.messageId = this.nextId();
  }

  private nextId(): string {
    this.counter += 1;
    return `${this.opts.idPrefix}-${this.counter}`;
  }

  private render(text: string): string {
    // In lingua `auto` il modello chiude la frase con il tag della lingua
    // riconosciuta ("<it-IT>"): ai sottotitoli non serve.
    const clean = text.replace(LANGUAGE_TAG, ' ').replace(/\s+/g, ' ').trim();
    return this.opts.rewrite ? this.opts.rewrite(clean, this.language) : clean;
  }

  private update(text: string, final: boolean): CaptionUpdate {
    const u: CaptionUpdate = { messageId: this.messageId, text: this.render(text), final };
    if (this.language) u.language = this.language;
    return u;
  }

  /**
   * Spezzare qui cambierebbe il testo riscritto: un numero detto in più parole
   * («duemila | ventisei») o un termine del glossario («pago | pa») diventerebbe
   * due pezzi sbagliati, e un'ora perderebbe il suo «alle». Si confronta una
   * finestra di parole intorno al taglio, non tutto il testo.
   */
  private splitChangesText(text: string, at: number): boolean {
    const left = LEFT_WINDOW.exec(text.slice(0, at))?.[0] ?? '';
    const right = RIGHT_WINDOW.exec(text.slice(at))?.[0] ?? '';
    return `${this.render(left)} ${this.render(right)}`.trim() !== this.render(left + right);
  }

  /** Il primo spazio oltre il limite (fino a 1,5 volte) dove il taglio non cambia il testo. */
  private cutPastLimit(text: string, limit: number): number | null {
    const end = Math.min(text.length, Math.floor(limit * MAX_WAIT_FACTOR));
    for (let at = text.indexOf(' ', limit + 1); at > 0 && at <= end; at = text.indexOf(' ', at + 1)) {
      if (!this.splitChangesText(text, at)) return at;
    }
    return null;
  }

  /** In diretta, se le regole guardano avanti: dopo il taglio non sono ancora arrivate abbastanza parole. */
  private tooFewAfter(text: string, at: number, final: boolean): boolean {
    if (final || this.opts.readsAhead?.(this.language) !== true) return false;
    return text.slice(at).trim().split(/\s+/, LOOKAHEAD_WORDS).length < LOOKAHEAD_WORDS;
  }

  /**
   * Chiude i sottotitoli troppo lunghi. `final`: non arriverà altro testo.
   * Il limite vale sulle parole trascritte, prima della riscrittura: un
   * sottotitolo con numeri detti a voce esce più corto del limite.
   */
  private split(final: boolean): CaptionUpdate[] {
    const updates: CaptionUpdate[] = [];
    const limit = this.opts.maxChars;
    while (this.current.trim().length > limit) {
      const trimmed = this.current.replace(/^\s+/, '');
      const cut = chooseCut(trimmed, limit, this.opts.rewrite ? (i) => this.splitChangesText(trimmed, i) : undefined);
      // Ogni taglio entro il limite cambierebbe il testo: meglio uno spazio
      // poco oltre, se c'è.
      const past = cut.kind === 'forced' ? this.cutPastLimit(trimmed, limit) : null;
      const chosen = past ?? cut.at;
      // In diretta si rimanda finché dopo il taglio non sono arrivate abbastanza
      // parole (le regole potrebbero ancora cambiare idea, e l'ultima parola
      // può essere a metà), o finché un taglio forzato non trova di meglio:
      // meglio aspettare che riprendersi parole già mostrate.
      const wait = this.tooFewAfter(trimmed, chosen, final) || (cut.kind === 'forced' && past === null && !final);
      if (wait && trimmed.length < limit * MAX_WAIT_FACTOR) break;
      const at = chosen;
      updates.push(this.update(trimmed.slice(0, at), true));
      this.current = trimmed.slice(at);
      this.messageId = this.nextId();
    }
    return updates;
  }

  /** Chiude il sottotitolo aperto, spezzandolo se serve. */
  private close(): CaptionUpdate[] {
    const updates = this.split(true);
    if (this.open) {
      updates.push(this.update(this.current, true));
      this.messageId = this.nextId();
    }
    this.current = '';
    this.sinceCommit = '';
    return updates;
  }

  /** C'è un sottotitolo aperto, cioè testo non ancora chiuso. */
  get open(): boolean {
    return this.current.trim().length > 0;
  }

  /**
   * Testo nuovo dal motore, nella lingua della sessione che l'ha prodotto.
   * Restituisce gli aggiornamenti da inviare, nell'ordine.
   */
  push(delta: string, language?: string | null): CaptionUpdate[] {
    if (!delta) return [];
    const updates: CaptionUpdate[] = [];
    if (language !== undefined && language !== this.language) {
      // Un sottotitolo non mescola due lingue: quello aperto si chiude con la sua.
      if (this.open) updates.push(...this.close());
      this.language = language;
    }
    this.current += delta;
    this.sinceCommit += delta;
    updates.push(...this.split(false));
    if (this.open) updates.push(this.update(this.current, false));
    return updates;
  }

  /**
   * Fine della frase. `transcript` è il testo definitivo del motore per tutto
   * il tratto dall'ultimo commit: se allunga quanto già ricevuto, la parte in
   * più (di solito la punteggiatura finale) si aggiunge prima di chiudere.
   */
  finish(transcript?: string, language?: string | null): CaptionUpdate[] {
    if (language !== undefined && language !== this.language) {
      // Il sottotitolo aperto è di una sessione nata dopo, in un'altra lingua:
      // questa fine arriva in ritardo, e il suo testo è già stato chiuso
      // quando è cambiata la lingua. Senza niente di aperto, è testo nuovo.
      if (this.open) return [];
      this.language = language;
    }
    const updates: CaptionUpdate[] = [];
    if (transcript) {
      const got = this.sinceCommit.replace(/\s+/g, ' ').trim();
      const full = transcript.replace(/\s+/g, ' ').trim();
      if (full.length > got.length && full.startsWith(got)) this.current += full.slice(got.length);
    }
    updates.push(...this.close());
    return updates;
  }
}
