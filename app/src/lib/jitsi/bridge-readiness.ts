/**
 * Come si legge lo stato del ponte video, e perche' non basta un confronto.
 *
 * La pagina di stato pubblica questo valore come telemetria: `ready` quando i
 * bridge accesi coprono quelli richiesti, `scaling` mentre si accendono,
 * `standby` quando nessuno ne ha chiesti — e `standby` esce anche quando il
 * conto va in errore. Il numero degli accesi viene da una fotografia che un
 * lavoro periodico aggiorna: se quel lavoro e' fermo, o se due eventi si
 * contendono i bridge, «scaling» resta scritto su una sala che funziona.
 *
 * Da qui la regola: chi decide qualcosa su questo valore deve poter
 * distinguere il NO dal SILENZIO. `false` vuol dire «si sta accendendo
 * adesso», e nient'altro; tutto il resto e' `null`, cioe' «non lo so». Un
 * confronto secco con `'ready'` schiaccia silenzio ed errore sul no, e chi ci
 * lega un cancello finisce per chiudere la porta a una conferenza sana.
 */
export type StatoPonte = boolean | null;

export function leggiStatoPonte(valore: unknown): StatoPonte {
  if (valore === 'ready') return true;
  if (valore === 'scaling') return false;
  return null;
}
