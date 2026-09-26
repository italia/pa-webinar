/**
 * Stato dell'ingresso dalla sala d'attesa: se si entra, e — quando no — perche'.
 *
 * Due ragioni diverse per non entrare, che la sala tiene distinte:
 *   - la SALA non e' pronta (evento non avviato, ponte video che si accende):
 *     non dipende dalla persona, e il pulsante resta spento con il suo stato
 *     (conto alla rovescia, «la sala si sta preparando»);
 *   - il MODULO e' incompleto (nome, email, consenso alla registrazione per
 *     partecipante): dipende dalla persona, e va detto cosa manca e dove.
 *
 * Pura, cosi' la regola si verifica senza montare il componente.
 */

/** Cio' che, a sala aperta, trattiene ancora dall'entrare: un campo del modulo. */
export type BloccoModulo = 'name' | 'email' | 'consent';

export interface StatoIngressoInput {
  /** L'evento e' avviato (LIVE). */
  canEnterLive: boolean;
  /** La sala ammette l'ingresso: ponte pronto, o attesa lunga scaduta. */
  ingressoConsentito: boolean;
  nameValid: boolean;
  emailValid: boolean;
  /** Serve il consenso alla registrazione per partecipante. */
  multitrackRequired: boolean;
  multitrackConsent: boolean;
  /** C'e' stato un tentativo d'ingresso (pulsante, cancello della piazza). */
  ingressoTentato: boolean;
  /** Il nome e' quello definitivo: il browser ha gia' restituito quello
   *  salvato l'ultima volta. Prima, un campo vuoto non vuol dire «manca». */
  nomeNoto: boolean;
}

export interface StatoIngresso {
  /** Si entra davvero con un clic. */
  canEnter: boolean;
  /** Si entrerebbe adesso, se il modulo fosse completo. */
  ingressoAperto: boolean;
  /** Il primo campo da completare, nell'ordine della pagina; null se completo. */
  bloccoModulo: BloccoModulo | null;
  /** Il nome va chiesto: a sala aperta, o dopo un tentativo. */
  nomeDaChiedere: boolean;
  /** Il nome manca dopo un tentativo: la richiesta diventa un errore. */
  nomeSegnalato: boolean;
  /** Il blocco il cui messaggio e' sullo schermo, da usare come descrizione
   *  del pulsante: il nome solo quando lo si sta chiedendo. */
  bloccoSpiegato: BloccoModulo | null;
}

export function statoIngresso(i: StatoIngressoInput): StatoIngresso {
  const bloccoModulo: BloccoModulo | null = !i.nameValid
    ? 'name'
    : !i.emailValid
      ? 'email'
      : i.multitrackRequired && !i.multitrackConsent
        ? 'consent'
        : null;
  const ingressoAperto = i.canEnterLive && i.ingressoConsentito;
  // Prima che la sala apra — conto alla rovescia, sala in preparazione —
  // chiedere il nome sarebbe un errore segnalato a chi non ha ancora niente
  // da fare. E prima di aver letto il nome salvato, la richiesta
  // lampeggerebbe a chi il nome lo ha gia' dato l'ultima volta.
  const nomeDaChiedere =
    i.nomeNoto && !i.nameValid && (ingressoAperto || i.ingressoTentato);
  return {
    canEnter: bloccoModulo === null && i.ingressoConsentito,
    ingressoAperto,
    bloccoModulo,
    nomeDaChiedere,
    nomeSegnalato: !i.nameValid && i.ingressoTentato,
    bloccoSpiegato: bloccoModulo === 'name' && !nomeDaChiedere ? null : bloccoModulo,
  };
}

/**
 * Cosa annunciare al lettore di schermo nell'istante in cui la sala apre.
 * Restituisce la chiave i18n (spazio `waiting`) o null.
 */
export function annuncioApertura(opts: {
  appenaAperta: boolean;
  canEnter: boolean;
  bloccoModulo: BloccoModulo | null;
}): 'roomJustOpened' | 'roomOpenNameMissing' | 'roomOpen' | null {
  if (!opts.appenaAperta) return null;
  if (opts.canEnter) return 'roomJustOpened';
  if (opts.bloccoModulo === 'name') return 'roomOpenNameMissing';
  // Email o consenso: la sala e' aperta, e il pulsante — che il lettore
  // raggiunge subito dopo — porta con se' la descrizione di cio' che manca.
  if (opts.bloccoModulo) return 'roomOpen';
  return null;
}
