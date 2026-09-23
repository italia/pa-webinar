/**
 * Come si legge lo stato del ponte video, e perche' non basta un confronto.
 *
 * La pagina di stato pubblica questo valore come telemetria: `ready` quando i
 * bridge accesi coprono quelli richiesti, `scaling` mentre si accendono,
 * `standby` quando nessuno ne ha chiesti — e `standby` esce anche quando il
 * conto va in errore. Il numero degli accesi viene da una fotografia che un
 * lavoro periodico aggiorna: se quel lavoro e' fermo, o se due eventi si
 * contendono i bridge, «si sta accendendo» resta scritto su una sala che
 * funziona benissimo.
 *
 * Da qui due regole.
 *
 * La prima: chi decide qualcosa su questo valore deve poter distinguere il NO
 * dal SILENZIO. `false` vuol dire «si sta accendendo adesso», e nient'altro;
 * tutto il resto e' `null`, cioe' «non lo so». Un confronto secco con `ready`
 * schiaccia silenzio ed errore sul no, e chi ci lega un cancello finisce per
 * chiudere la porta a una conferenza sana.
 *
 * La seconda: una prova batte una stima. Se sui ponti c'e' gia' qualcuno che
 * parla, un ponte acceso c'e' — non importa cosa dica il conteggio delle
 * repliche. E' il solo modo di non restare fuori da una sala piena mentre una
 * fotografia vecchia sostiene che si stia ancora accendendo.
 *
 * Il conteggio dei presenti e' per servizio, non per stanza: dice «il servizio
 * sta portando traffico», non «questa stanza e' allestita». Vale come prova
 * che un ponte acceso esiste, non come garanzia che la stanza sia allestita.
 *
 * Entrambe le regole valgono solo su una fotografia fresca: quando la sonda
 * dichiara il proprio dato vecchio, la risposta e' «non lo so».
 */
export type StatoPonte = boolean | null;

export interface MetricheSala {
  jvbStatus?: unknown;
  jvbParticipants?: unknown;
  jvbStale?: unknown;
}

export function leggiStatoPonte(metriche: MetricheSala | null | undefined): StatoPonte {
  if (!metriche) return null;

  // Una fotografia vecchia non dice niente, in nessuno dei due versi. Se il
  // lavoro che la aggiorna e' fermo, «si sta accendendo» puo' essere rimasto
  // scritto su una sala che funziona, e un conteggio di presenti puo'
  // sopravvivere a una conferenza finita da un pezzo.
  if (metriche.jvbStale === true) return null;

  // Prova positiva: c'e' traffico, quindi un ponte acceso c'e'.
  const presenti = metriche.jvbParticipants;
  if (typeof presenti === 'number' && presenti > 0) return true;

  if (metriche.jvbStatus === 'ready') return true;
  if (metriche.jvbStatus === 'scaling') return false;
  return null;
}

/** La stessa lettura per il registratore, che non ha una prova equivalente:
 *  nessuno «passa da Jibri», quindi restano solo i due valori netti. */
export function leggiStatoRegistratore(valore: unknown): StatoPonte {
  if (valore === 'ready') return true;
  if (valore === 'scaling') return false;
  return null;
}
