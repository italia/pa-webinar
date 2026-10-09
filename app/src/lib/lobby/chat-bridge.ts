/**
 * Il ponte fra la chat dell'evento e la piazza: ogni messaggio diventa un
 * fumetto sopra chi l'ha scritto, una correzione lo aggiorna, un messaggio
 * nascosto lo toglie, chi scrive ha i puntini.
 *
 * Passa le cose una per una, senza stato React: più messaggi arrivati insieme
 * (il recupero dopo un'interruzione dello stream) diventano tutti fumetti, e la
 * sala d'attesa non si ridisegna a ogni messaggio. Ricorda gli ultimi messaggi
 * per mezzo minuto, così chi apre la piazza vede quelli appena scritti, per il
 * tempo che resta loro. L'età si misura con l'orologio di questa pagina (da
 * quando il messaggio è arrivato qui), non con l'ora del server: un orologio
 * del computer sbagliato non accorcia né cancella i fumetti dei messaggi in
 * diretta. Solo per quelli recuperati dopo un'interruzione l'età è una stima.
 * Un messaggio già passato non ricomincia (una chat che si riapre li rilegge
 * tutti).
 */

export interface MessaggioPiazza {
  id: string;
  nome: string;
  testo: string;
  /** Scritto da me: va sul mio avatar, qualunque nome mostri la chat. */
  mio: boolean;
}

export interface AscoltatorePiazza {
  messaggio(m: MessaggioPiazza, etaMs: number): void;
  modificato(id: string, testo: string): void;
  rimosso(id: string): void;
  scrittura(nomi: string[]): void;
}

/** Quanto si ricorda un messaggio (la durata massima di un fumetto). */
const RICORDO_MS = 30_000;
/** Aprendo la piazza compaiono solo i messaggi più giovani di così. */
export const RECENTE_MS = 20_000;

export class PonteChatPiazza {
  private readonly recenti = new Map<string, { m: MessaggioPiazza; alle: number }>();
  private scrivono: string[] = [];
  private ascoltatore: AscoltatorePiazza | null = null;

  constructor(private readonly ora: () => number = () => Date.now()) {}

  /** `etaMs`: 0 per un messaggio in diretta, la stima per uno recuperato. */
  readonly messaggio = (m: MessaggioPiazza, etaMs = 0): void => {
    this.pota();
    const ora = this.ora();
    const voce = this.recenti.get(m.id);
    if (voce) {
      // Già passato: cambia solo se ora si sa che è mio (lo stream era
      // arrivato prima della risposta all'invio).
      if (voce.m.mio || !m.mio) return;
      voce.m = { ...voce.m, mio: true };
      this.ascoltatore?.messaggio(voce.m, ora - voce.alle);
      return;
    }
    const eta = Math.max(0, etaMs);
    if (eta >= RECENTE_MS) return;
    const alle = ora - eta;
    this.recenti.set(m.id, { m, alle });
    this.ascoltatore?.messaggio(m, eta);
  };

  /** Una correzione: conta solo se cambia il testo di un messaggio che può
   *  essere ancora in un fumetto. Un testo vuoto (un allegato senza parole)
   *  lascia quello che c'era. */
  readonly modificato = (id: string, testo: string): void => {
    const voce = this.recenti.get(id);
    if (!voce || !testo || voce.m.testo === testo) return;
    voce.m = { ...voce.m, testo };
    this.ascoltatore?.modificato(id, testo);
  };

  readonly rimosso = (id: string): void => {
    this.recenti.delete(id);
    this.ascoltatore?.rimosso(id);
  };

  readonly scrittura = (nomi: string[]): void => {
    this.scrivono = nomi;
    this.ascoltatore?.scrittura(nomi);
  };

  /** Collega la piazza: riceve subito i messaggi recenti (con la loro età) e
   *  chi sta scrivendo, poi tutto quello che arriva. Restituisce lo scollega. */
  collega(a: AscoltatorePiazza): () => void {
    this.ascoltatore = a;
    this.pota();
    const ora = this.ora();
    for (const { m, alle } of this.recenti.values()) {
      const eta = Math.max(0, ora - alle);
      if (eta < RECENTE_MS) a.messaggio(m, eta);
    }
    a.scrittura(this.scrivono);
    return () => {
      if (this.ascoltatore === a) this.ascoltatore = null;
    };
  }

  private pota(): void {
    const ora = this.ora();
    for (const [id, voce] of this.recenti) {
      if (ora - voce.alle > RICORDO_MS) this.recenti.delete(id);
    }
  }
}
