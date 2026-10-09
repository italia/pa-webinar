/**
 * Il tempo dell'evento come lo legge chi conduce: da quanto si è in onda,
 * quanto manca alla fine prevista, il fuori orario e quando la sala si
 * chiude da sola (la regola di lib/events/lifecycle: un tetto dopo la fine).
 */

/** Gli ultimi minuti prima della fine (o della chiusura) in cui si avvisa. */
export const ULTIMI_MINUTI = 10;

export type FaseOrologio =
  /** Prima della fine prevista. */
  | 'in-orario'
  /** Negli ultimi minuti prima della fine prevista. */
  | 'quasi-fine'
  /** Oltre la fine prevista, con la chiusura ancora lontana (o senza tetto). */
  | 'fuori-orario'
  /** Oltre la fine, negli ultimi minuti prima della chiusura. */
  | 'in-chiusura';

export interface Orologio {
  fase: FaseOrologio;
  /** Da quanto è iniziato l'evento (0 prima dell'inizio). */
  trascorsoMs: number;
  /** Quanto manca alla fine prevista (negativo oltre la fine). */
  mancanoMs: number;
  /** La parte dell'orario previsto già trascorsa, fra 0 e 1. */
  avanzamento: number;
  /** Minuti alla chiusura automatica, se c'è un tetto e si è oltre la fine. */
  minutiAllaChiusura: number | null;
}

export function orologioEvento(args: {
  now: number;
  inizio: number;
  fine: number;
  /** Tetto del fuori orario in minuti dopo la fine; negativo = nessuno. */
  graceMinutes: number;
}): Orologio {
  const { now, inizio, fine, graceMinutes } = args;
  const durata = Math.max(1, fine - inizio);
  const trascorsoMs = Math.max(0, now - inizio);
  const mancanoMs = fine - now;
  const avanzamento = Math.min(1, Math.max(0, (now - inizio) / durata));
  const chiusura = graceMinutes >= 0 ? fine + graceMinutes * 60_000 : null;
  const minutiAllaChiusura =
    now >= fine && chiusura !== null ? Math.max(0, Math.ceil((chiusura - now) / 60_000)) : null;

  let fase: FaseOrologio;
  if (now < fine) {
    fase = mancanoMs <= ULTIMI_MINUTI * 60_000 ? 'quasi-fine' : 'in-orario';
  } else {
    fase = minutiAllaChiusura !== null && minutiAllaChiusura <= ULTIMI_MINUTI ? 'in-chiusura' : 'fuori-orario';
  }
  return { fase, trascorsoMs, mancanoMs, avanzamento, minutiAllaChiusura };
}

function pad(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

/** `h:mm:ss` oltre l'ora, `mm:ss` sotto. */
export function formatDurata(ms: number): string {
  const totale = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totale / 3600);
  const m = Math.floor((totale % 3600) / 60);
  const s = totale % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Minuti interi, per difetto: «mancano 48 min» finché non sono 47. */
export function minutiInteri(ms: number): number {
  return Math.floor(Math.abs(ms) / 60_000);
}
