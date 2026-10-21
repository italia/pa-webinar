/**
 * Il programma nel wizard: gli argomenti preparati prima dell'evento, con la
 * durata prevista e chi interviene, e il loro passaggio verso l'API
 * dell'agenda (PUT /api/events/{id}/agenda con `{base, plan}`).
 *
 * Chi interviene si indica con una chiave che vale anche per le persone non
 * ancora salvate: `primary` per l'organizzatore principale, `e:<email>` per
 * una persona con un indirizzo (l'indirizzo resta lo stesso anche quando un
 * cambio di ruolo le da' una concessione nuova), `g:<id>` per una concessione
 * senza indirizzo. Al salvataggio la chiave diventa la concessione.
 */

import {
  durataProgramma,
  orariProgramma,
  parsePlannedMinutes,
} from '@/lib/agenda/programme';
import type { PersonRole } from '@/lib/events/grant-profile';
import { fromDatetimeLocalInTz, toDatetimeLocalInTz } from '@/lib/utils/date-format';

/** Un argomento del programma, come lo tiene il modulo. */
export interface AgendaDraft {
  /** L'argomento salvato; assente per uno nuovo. */
  id?: string;
  /** Chiave stabile della riga, anche per quelle nuove: spostando una riga
   *  il fuoco resta sul suo pulsante. */
  key: string;
  label: string;
  /** La durata come la si e' scritta, in minuti: vuota vuol dire nessuna. */
  minutes: string;
  /** Chi interviene (vedi sopra), o nessuno. */
  speakerKey: string | null;
}

export interface StepProgrammeValue {
  agenda: AgendaDraft[];
}

/** Un argomento come lo manda il salvataggio. */
export interface VocePiano {
  id?: string;
  label: string;
  plannedMinutes: number | null;
  speakerGrantId: string | null;
  speakerPrimary: boolean;
}

/** Un argomento salvato, come lo conosce lo scatto del wizard. */
export interface VoceSalvata {
  id: string;
  label: string;
  plannedMinutes: number | null;
  speakerGrantId: string | null;
  speakerPrimary: boolean;
}

export const CHIAVE_PRINCIPALE = 'primary';

let contatore = 0;
/** Una chiave per una riga nuova, unica nella pagina. */
export function nuovaChiave(): string {
  contatore += 1;
  return `r${Date.now().toString(36)}${contatore.toString(36)}`;
}

export function nuovaVoce(label = ''): AgendaDraft {
  return { key: nuovaChiave(), label, minutes: '', speakerKey: null };
}

/** La chiave di una persona dell'evento: l'indirizzo, o la concessione. */
export function chiavePersona(p: {
  email?: string | null;
  grantId?: string | null;
}): string | null {
  const email = (p.email ?? '').trim().toLowerCase();
  if (email) return `e:${email}`;
  return p.grantId ? `g:${p.grantId}` : null;
}

/** Una persona che si puo' scegliere come chi interviene. */
export interface OpzioneRelatore {
  key: string;
  name: string;
  role: PersonRole;
  /** Compare nella pagina pubblica: altrimenti il programma mostra solo
   *  l'argomento. */
  publicListed: boolean;
}

/** Le persone dell'evento come le legge il programma. */
export interface PersoneDelModulo {
  moderatorName?: string | null;
  moderatorPublicListed?: boolean;
  moderators: ReadonlyArray<{
    name: string;
    email: string;
    grantId?: string | null;
    organizer: boolean;
    publicListed: boolean;
  }>;
  speakers: ReadonlyArray<{
    name: string;
    email: string;
    grantId?: string | null;
    publicListed: boolean;
  }>;
}

/** Le persone fra cui scegliere: l'organizzatore principale, poi le persone
 *  del passo nell'ordine dell'elenco. */
export function opzioniRelatore(form: PersoneDelModulo): OpzioneRelatore[] {
  const out: OpzioneRelatore[] = [];
  const principale = (form.moderatorName ?? '').trim();
  if (principale) {
    out.push({
      key: CHIAVE_PRINCIPALE,
      name: principale,
      role: 'organizer',
      publicListed: !!form.moderatorPublicListed,
    });
  }
  for (const m of form.moderators) {
    const key = chiavePersona(m);
    if (key) {
      out.push({
        key,
        name: m.name,
        role: m.organizer ? 'organizer' : 'moderator',
        publicListed: !!m.publicListed,
      });
    }
  }
  for (const s of form.speakers) {
    const key = chiavePersona(s);
    if (key)
      out.push({ key, name: s.name, role: 'speaker', publicListed: !!s.publicListed });
  }
  return out;
}

/**
 * Le persone fra cui scegliere nel programma: come opzioniRelatore, ma
 * l'organizzatore principale c'e' sempre, anche senza nome (cancellarlo e
 * riscriverlo non deve togliere i suoi interventi). Il nome vuoto lo
 * sostituisce chi mostra l'elenco.
 */
export function opzioniConPrincipale(form: PersoneDelModulo): OpzioneRelatore[] {
  const tutte = opzioniRelatore(form);
  if (tutte.some((o) => o.key === CHIAVE_PRINCIPALE)) return tutte;
  return [
    {
      key: CHIAVE_PRINCIPALE,
      name: '',
      role: 'organizer',
      publicListed: !!form.moderatorPublicListed,
    },
    ...tutte,
  ];
}

/** Una riga che si salva: ha un titolo. Le righe vuote si lasciano. */
export function haTitolo(v: Pick<AgendaDraft, 'label'>): boolean {
  return v.label.trim().length > 0;
}

/** Gli argomenti da salvare: quelli con un titolo (le righe vuote si
 *  lasciano), con la durata letta dal campo. */
export function vociCompilate(agenda: readonly AgendaDraft[]): Array<{
  id?: string;
  label: string;
  plannedMinutes: number | null;
  speakerKey: string | null;
}> {
  return agenda.filter(haTitolo).map((v) => ({
    ...(v.id ? { id: v.id } : {}),
    label: v.label.trim().slice(0, 500),
    // Una durata non valida la ferma la validazione del passo: qui, per
    // sicurezza, vale come nessuna.
    plannedMinutes: parsePlannedMinutes(v.minutes) ?? null,
    speakerKey: v.speakerKey,
  }));
}

/**
 * Il programma da mandare, con le chiavi tradotte in concessioni da
 * `concessione` (che risponde null per una persona che non ha, o non ha piu',
 * una concessione: l'argomento resta senza chi interviene).
 */
export function pianoDaInviare(
  agenda: readonly AgendaDraft[],
  concessione: (chiave: string) => string | null
): VocePiano[] {
  return vociCompilate(agenda).map(({ speakerKey, ...v }) => {
    if (speakerKey === CHIAVE_PRINCIPALE) {
      return { ...v, speakerGrantId: null, speakerPrimary: true };
    }
    return {
      ...v,
      speakerGrantId: speakerKey ? concessione(speakerKey) : null,
      speakerPrimary: false,
    };
  });
}

/**
 * La concessione di una chiave fra quelle note: `g:` per id (o la concessione
 * che l'ha sostituita con un cambio di ruolo), `e:` per indirizzo. Con piu'
 * concessioni per lo stesso indirizzo (un cambio di ruolo la cui revoca non
 * e' ancora riuscita) vale l'ultima creata.
 */
export function concessioneDaChiave(
  chiave: string,
  concessioni: ReadonlyArray<{ id: string; email: string | null; replaces?: string }>
): string | null {
  if (chiave.startsWith('g:')) {
    const id = chiave.slice(2);
    const sostituta = concessioni.filter((g) => g.replaces === id).at(-1);
    if (sostituta) return sostituta.id;
    return concessioni.some((g) => g.id === id) ? id : null;
  }
  if (chiave.startsWith('e:')) {
    const email = chiave.slice(2);
    const trovate = concessioni.filter(
      (g) => (g.email ?? '').trim().toLowerCase() === email
    );
    return trovate.at(-1)?.id ?? null;
  }
  return null;
}

/** Il programma salvato tradotto nelle righe del modulo. */
export function agendaDalServer(
  voci: readonly VoceSalvata[],
  concessioni: ReadonlyArray<{ id: string; email: string | null }>
): AgendaDraft[] {
  return voci.map((v) => {
    const g = v.speakerGrantId
      ? concessioni.find((c) => c.id === v.speakerGrantId)
      : undefined;
    return {
      id: v.id,
      key: v.id,
      label: v.label,
      minutes: v.plannedMinutes ? String(v.plannedMinutes) : '',
      speakerKey: v.speakerPrimary
        ? CHIAVE_PRINCIPALE
        : g
          ? chiavePersona({ email: g.email, grantId: g.id })
          : null,
    };
  });
}

/** Gli orari del programma nel modulo. */
export interface OrariModulo {
  /** L'inizio previsto di ogni riga del modulo, nell'ordine: null per una
   *  riga senza titolo e dal primo argomento senza durata in poi. */
  inizi: Array<Date | null>;
  /** I minuti previsti in tutto, se ogni argomento ha la durata. */
  totale: number | null;
  /** La fine prevista del programma, se si puo' dire. */
  fine: Date | null;
}

/**
 * Gli orari del programma come li mostrera' la pagina pubblica: contano solo
 * le righe con un titolo, cioe' quelle che si salvano. Una riga vuota non ha
 * orario e non sposta quelli degli argomenti dopo. Senza un inizio valido
 * nessun orario, ma il totale si conosce lo stesso.
 */
export function orariDelModulo(
  agenda: readonly AgendaDraft[],
  inizio: Date | null
): OrariModulo {
  const voci = agenda.flatMap((v, riga) =>
    haTitolo(v) ? [{ riga, plannedMinutes: parsePlannedMinutes(v.minutes) ?? null }] : []
  );
  const orari = inizio ? orariProgramma(inizio, voci) : [];
  const inizi: Array<Date | null> = agenda.map(() => null);
  voci.forEach((v, k) => {
    inizi[v.riga] = orari[k]?.start ?? null;
  });
  const totale = durataProgramma(voci);
  return { inizi, totale, fine: totale !== null ? (orari.at(-1)?.end ?? null) : null };
}

/** Vero se il programma da mandare e' diverso da quello salvato. */
export function pianoCambiato(
  piano: readonly VocePiano[],
  salvato: readonly VoceSalvata[]
): boolean {
  if (piano.length !== salvato.length) return true;
  return piano.some((v, i) => {
    const s = salvato[i]!;
    return (
      v.id !== s.id ||
      v.label !== s.label ||
      v.plannedMinutes !== s.plannedMinutes ||
      v.speakerGrantId !== s.speakerGrantId ||
      v.speakerPrimary !== s.speakerPrimary
    );
  });
}

/**
 * Le righe del modulo con gli id degli argomenti appena salvati, nell'ordine:
 * un salvataggio successivo (dopo un fallimento parziale) li aggiorna invece
 * di ricrearli. Solo se le righe con un titolo sono quante quelle salvate.
 */
export function conIdSalvati(
  agenda: readonly AgendaDraft[],
  salvato: readonly VoceSalvata[]
): AgendaDraft[] {
  const compilate = agenda.filter(haTitolo);
  if (compilate.length !== salvato.length) return [...agenda];
  let i = 0;
  return agenda.map((v) => (haTitolo(v) ? { ...v, id: salvato[i++]!.id } : v));
}

/** Le chiavi di chi interviene che non sono piu' fra le persone del passo:
 *  la persona e' stata tolta. */
export function chiaviOrfane(
  agenda: readonly AgendaDraft[],
  opzioni: readonly OpzioneRelatore[]
): Set<string> {
  const note = new Set(opzioni.map((o) => o.key));
  return new Set(
    agenda.map((v) => v.speakerKey).filter((k): k is string => !!k && !note.has(k))
  );
}

/**
 * Il modulo senza le scelte di chi interviene rimaste senza persona (tolta
 * nel passo «Persone»), e le righe che l'hanno persa. L'organizzatore
 * principale resta sempre una scelta, anche senza nome: cancellarlo e
 * riscriverlo non toglie i suoi interventi.
 */
export function senzaRelatoriAssenti<T extends PersoneDelModulo & { agenda?: readonly AgendaDraft[] }>(
  form: T
): { form: T; righe: string[] } {
  const orfane = chiaviOrfane(form.agenda ?? [], opzioniConPrincipale(form));
  const righe: string[] = [];
  const agenda = (form.agenda ?? []).map((v) => {
    if (!v.speakerKey || !orfane.has(v.speakerKey)) return v;
    righe.push(v.key);
    return { ...v, speakerKey: null };
  });
  return righe.length === 0 ? { form, righe } : { form: { ...form, agenda }, righe };
}

/** I relatori che non hanno ancora un intervento nel programma: un argomento
 *  con un titolo (una riga senza non si salva). */
export function relatoriSenzaIntervento(
  form: PersoneDelModulo & { agenda?: readonly AgendaDraft[] }
): OpzioneRelatore[] {
  const assegnate = new Set(
    (form.agenda ?? []).filter(haTitolo).map((v) => v.speakerKey).filter(Boolean)
  );
  return opzioniRelatore(form).filter((o) => o.role === 'speaker' && !assegnate.has(o.key));
}

/** Una riga appena aggiunta e ancora intatta: senza argomento, senza chi
 *  interviene, senza durata e mai salvata. */
export function rigaIntatta(v: AgendaDraft | undefined): boolean {
  return !!v && !v.id && !haTitolo(v) && !v.speakerKey && !v.minutes.trim();
}

/**
 * Il programma con un intervento di una persona in fondo: nella riga vuota
 * appena aggiunta, se c'e' (non resta una riga in piu' da togliere), altrimenti
 * in una riga nuova. Con l'indice della riga, per portarci il fuoco.
 */
export function conIntervento(
  agenda: readonly AgendaDraft[],
  speakerKey: string
): { agenda: AgendaDraft[]; indice: number } {
  const ultima = agenda.length - 1;
  if (rigaIntatta(agenda[ultima])) {
    return {
      agenda: agenda.map((v, i) => (i === ultima ? { ...v, speakerKey } : v)),
      indice: ultima,
    };
  }
  return { agenda: [...agenda, { ...nuovaVoce(), speakerKey }], indice: agenda.length };
}

/**
 * La descrizione sembra contenere gia' un programma: un titolo «Programma» o
 * «Agenda» (anche in inglese), o almeno due righe che cominciano con un
 * orario («10:00», «- 10.30», «| 11:00 |»). Nella pagina comparirebbe due
 * volte, e senza orari calcolati ne' persone.
 */
export function descrizioneConProgramma(testo: string | null | undefined): boolean {
  const righe = (testo ?? '').split(/\r?\n/);
  const titolo = /^\s*(?:#{1,6}\s*|\*\*|__)?\s*(?:programma|programme|program|agenda)\b[\s:*_]*$/i;
  if (righe.some((r) => titolo.test(r))) return true;
  // Un orario, non una data («12.05.2026») ne' il numero di un paragrafo
  // («1.10»): con il punto l'ora ha due cifre, o e' del mattino («9.30»).
  const orario =
    /^\s*(?:[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\*\*)?(?:ore\s+)?(?:(?:[01]?\d|2[0-3]):|(?:[01]\d|2[0-3]|0?[7-9])\.)[0-5]\d\b(?![.:/]\d)/i;
  return righe.filter((r) => orario.test(r)).length >= 2;
}

/** Errori del programma per il suo passo: una durata scritta che non e' una
 *  durata. Le righe senza titolo non contano (non si salvano), e ad agenda
 *  spenta nemmeno il programma (non si salva: il passo non lo fa cambiare). */
export function erroriProgramma(form: {
  agendaEnabled: boolean;
  agenda?: readonly AgendaDraft[];
}): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.agendaEnabled) return errs;
  (form.agenda ?? []).forEach((v, i) => {
    if (haTitolo(v) && parsePlannedMinutes(v.minutes) === undefined) {
      errs[`agenda.${i}.minutes`] = 'invalid';
    }
  });
  return errs;
}

/** L'ora («hh:mm») di un istante nel fuso dell'evento. */
export function oraNelFuso(d: Date, tz: string): string {
  return toDatetimeLocalInTz(d, tz).slice(11, 16);
}

/** Data e ora del modulo (`AAAA-MM-GGThh:mm` nel fuso dell'evento) come
 *  istante, o null finche' non e' valida. */
export function istanteDalModulo(locale: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(locale)) return null;
  try {
    const d = fromDatetimeLocalInTz(locale, tz);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
