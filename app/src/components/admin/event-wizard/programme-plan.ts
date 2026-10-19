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

import { parsePlannedMinutes } from '@/lib/agenda/programme';
import type { PersonRole } from '@/lib/events/grant-profile';
import { fromDatetimeLocalInTz } from '@/lib/utils/date-format';

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

/** Le persone fra cui scegliere: l'organizzatore principale, poi le persone
 *  del passo nell'ordine dell'elenco. */
export function opzioniRelatore(form: {
  moderatorName?: string | null;
  moderatorPublicListed?: boolean;
  moderators: Array<{
    name: string;
    email: string;
    grantId?: string | null;
    organizer: boolean;
    publicListed: boolean;
  }>;
  speakers: Array<{
    name: string;
    email: string;
    grantId?: string | null;
    publicListed: boolean;
  }>;
}): OpzioneRelatore[] {
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

/** Gli argomenti da salvare: quelli con un titolo (le righe vuote si
 *  lasciano), con la durata letta dal campo. */
export function vociCompilate(agenda: readonly AgendaDraft[]): Array<{
  id?: string;
  label: string;
  plannedMinutes: number | null;
  speakerKey: string | null;
}> {
  return agenda
    .map((v) => ({ ...v, label: v.label.trim() }))
    .filter((v) => v.label.length > 0)
    .map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      label: v.label.slice(0, 500),
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
  const compilate = agenda.filter((v) => v.label.trim());
  if (compilate.length !== salvato.length) return [...agenda];
  let i = 0;
  return agenda.map((v) => (v.label.trim() ? { ...v, id: salvato[i++]!.id } : v));
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

/** Errori del programma per il passo «Persone»: una durata scritta che non e'
 *  una durata. Le righe senza titolo non contano (non si salvano). */
export function erroriProgramma(form: {
  agendaEnabled: boolean;
  agenda?: readonly AgendaDraft[];
}): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.agendaEnabled) return errs;
  (form.agenda ?? []).forEach((v, i) => {
    if (v.label.trim() && parsePlannedMinutes(v.minutes) === undefined) {
      errs[`agenda.${i}.minutes`] = 'invalid';
    }
  });
  return errs;
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
