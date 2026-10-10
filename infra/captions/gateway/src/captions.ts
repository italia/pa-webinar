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

/** Dove spezzare un testo troppo lungo: subito dopo l'ultimo confine utile entro `limit`. */
export function splitPoint(text: string, limit: number): number {
  const head = text.slice(0, limit + 1);
  for (const re of [SENTENCE_END, CLAUSE_END]) {
    let last = -1;
    for (const m of head.matchAll(re)) last = m.index + m[0].length;
    // Un confine troppo vicino all'inizio lascerebbe un sottotitolo di due parole.
    if (last >= limit / 3) return last;
  }
  const space = head.lastIndexOf(' ');
  return space > 0 ? space : limit;
}

export class CaptionAssembler {
  private current = '';
  /** Tutto il testo arrivato dall'ultimo `commit` del motore, per riconoscere la coda del definitivo. */
  private sinceCommit = '';
  private counter = 0;
  private messageId: string;

  constructor(
    private readonly opts: {
      idPrefix: string;
      maxChars: number;
      rewrite?: (text: string) => string;
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
    return this.opts.rewrite ? this.opts.rewrite(clean) : clean;
  }

  /** C'è un sottotitolo aperto, cioè testo non ancora chiuso. */
  get open(): boolean {
    return this.current.trim().length > 0;
  }

  /** Testo nuovo dal motore. Restituisce gli aggiornamenti da inviare, nell'ordine. */
  push(delta: string): CaptionUpdate[] {
    if (!delta) return [];
    this.current += delta;
    this.sinceCommit += delta;
    const updates: CaptionUpdate[] = [];
    while (this.current.trim().length > this.opts.maxChars) {
      const trimmed = this.current.replace(/^\s+/, '');
      const at = splitPoint(trimmed, this.opts.maxChars);
      const head = trimmed.slice(0, at);
      updates.push({ messageId: this.messageId, text: this.render(head), final: true });
      this.current = trimmed.slice(at);
      this.messageId = this.nextId();
    }
    if (this.open) {
      updates.push({ messageId: this.messageId, text: this.render(this.current), final: false });
    }
    return updates;
  }

  /**
   * Fine della frase. `transcript` è il testo definitivo del motore per tutto
   * il tratto dall'ultimo commit: se allunga quanto già ricevuto, la parte in
   * più (di solito la punteggiatura finale) si aggiunge prima di chiudere.
   */
  finish(transcript?: string): CaptionUpdate[] {
    const updates: CaptionUpdate[] = [];
    if (transcript) {
      const got = this.sinceCommit.replace(/\s+/g, ' ').trim();
      const full = transcript.replace(/\s+/g, ' ').trim();
      if (full.length > got.length && full.startsWith(got)) {
        updates.push(...this.push(full.slice(got.length)).filter((u) => u.final));
      }
    }
    if (this.open) {
      updates.push({ messageId: this.messageId, text: this.render(this.current), final: true });
      this.messageId = this.nextId();
    }
    this.current = '';
    this.sinceCommit = '';
    return updates;
  }
}
