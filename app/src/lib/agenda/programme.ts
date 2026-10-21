/**
 * Il programma dell'incontro: l'agenda preparata prima dell'evento, con gli
 * orari previsti e chi interviene, come la mostra la pagina pubblica.
 *
 * Funzioni pure, usate dal server (pagina pubblica, dati strutturati) e dal
 * browser (anteprima e modulo del wizard).
 */

import { personPhotoPath } from '@/lib/events/person-photo';

import type { AgendaStatus } from './status';

/** Chi interviene su un argomento, come lo vede il pubblico. */
export interface RelatoreProgramma {
  name: string;
  organization: string | null;
  /** La foto (percorso dell'app), solo se la persona e' presentata. */
  photoUrl: string | null;
}

/** Un argomento del programma pubblico. Gli orari li calcola chi lo mostra. */
export interface VoceProgramma {
  id: string;
  label: string;
  plannedMinutes: number | null;
  status: AgendaStatus;
  /** Solo se la persona compare nella pagina pubblica; altrimenti null. */
  speaker: RelatoreProgramma | null;
}

/** L'inizio e la fine previsti di un argomento, se si possono dire. */
export interface OrarioVoce {
  start: Date | null;
  end: Date | null;
}

/**
 * Gli orari previsti, a partire dall'inizio dell'evento e sommando le durate.
 * L'inizio di un argomento si conosce solo se tutti quelli prima hanno una
 * durata; la fine, se anche lui ce l'ha. Dal primo argomento senza durata in
 * poi non si mostra piu' nessun orario: sarebbe un'ora inventata.
 */
export function orariProgramma(
  startsAt: Date,
  voci: ReadonlyArray<{ plannedMinutes: number | null }>
): OrarioVoce[] {
  let cursore: number | null = startsAt.getTime();
  return voci.map((v) => {
    const start: number | null = cursore;
    const end: number | null =
      start !== null && v.plannedMinutes ? start + v.plannedMinutes * 60_000 : null;
    cursore = end;
    return {
      start: start === null ? null : new Date(start),
      end: end === null ? null : new Date(end),
    };
  });
}

/** La durata prevista del programma, se ogni argomento ne ha una. */
export function durataProgramma(
  voci: ReadonlyArray<{ plannedMinutes: number | null }>
): number | null {
  if (voci.length === 0 || voci.some((v) => !v.plannedMinutes)) return null;
  return voci.reduce((somma, v) => somma + (v.plannedMinutes ?? 0), 0);
}

/**
 * Minuti scritti in un campo: vuoto vuol dire nessuna durata (null), un intero
 * tra 1 e 600 (la misura che accetta il server) e' la durata, il resto non e'
 * valido (undefined): si dice, non si cancella in silenzio la durata che
 * c'era. Il campo e' di testo: uno di tipo numero con dentro «1e» o lettere
 * varrebbe '' e sembrerebbe vuoto.
 */
export function parsePlannedMinutes(raw: string): number | null | undefined {
  const testo = raw.trim();
  if (testo === '') return null;
  if (!/^\d{1,3}$/.test(testo)) return undefined;
  const n = Number(testo);
  return n >= 1 && n <= 600 ? n : undefined;
}

/** La persona di una concessione, come la legge il programma. */
interface ConcessioneRelatore {
  name: string;
  organization: string | null;
  photoId: string | null;
  publicListed: boolean;
  revokedAt: Date | null;
}

/**
 * Chi interviene su un argomento, se la pagina pubblica lo puo' dire: una
 * persona presentata (publicListed) e non revocata, o l'organizzatore
 * principale se e' presentato anche lui. Altrimenti null, e il programma
 * mostra solo l'argomento. Il nome di una concessione e' cifrato: lo decifra
 * chi chiama.
 */
export function relatoreDelProgramma(
  voce: { speakerPrimary: boolean; speaker: ConcessioneRelatore | null },
  evento: {
    moderatorName: string | null;
    moderatorPublicListed: boolean;
    moderatorOrganization: string | null;
    moderatorPhotoId: string | null;
  },
  decifra: (cifrato: string) => string | null
): RelatoreProgramma | null {
  if (voce.speakerPrimary) {
    if (!evento.moderatorPublicListed || !evento.moderatorName) return null;
    return {
      name: evento.moderatorName,
      organization: evento.moderatorOrganization,
      photoUrl: evento.moderatorPhotoId ? personPhotoPath(evento.moderatorPhotoId) : null,
    };
  }
  const g = voce.speaker;
  if (!g || !g.publicListed || g.revokedAt !== null) return null;
  return {
    name: decifra(g.name) ?? g.name,
    organization: g.organization,
    photoUrl: g.photoId ? personPhotoPath(g.photoId) : null,
  };
}
