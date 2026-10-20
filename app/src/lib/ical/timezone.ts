/**
 * Orari locali con TZID e la definizione VTIMEZONE che li accompagna.
 *
 * Un orario `DTSTART;TZID=Europe/Rome:20261021T110000` vale solo se il file
 * definisce `Europe/Rome`: senza VTIMEZONE il client indovina, e in passato
 * un orario UTC rietichettato come ora di Roma ha spostato gli eventi di due
 * ore. Qui le regole si ricavano dal fuso dell'evento con `Intl` (i dati del
 * runtime, gli stessi con cui le email scrivono l'ora): le transizioni
 * dell'anno dell'evento diventano due regole annuali (ora legale e ora
 * solare), e si usano solo se riproducono esattamente le transizioni
 * dell'anno prima e dell'anno dopo. Se il fuso non segue regole cosi'
 * semplici, o se l'evento cade a ridosso di un cambio d'ora (dove un'ora
 * locale e' ambigua), si torna all'istante UTC: sempre corretto, senza fuso
 * dell'evento.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Scarto del fuso dall'UTC, in minuti, all'istante `ms`. */
export function offsetMinutes(timeZone: string, ms: number): number {
  const parti: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parti[p.type] = Number(p.value);
  }
  const locale = Date.UTC(
    parti.year!,
    parti.month! - 1,
    parti.day!,
    parti.hour! % 24,
    parti.minute!,
    parti.second!
  );
  const istante = Math.floor(ms / 1000) * 1000;
  return Math.round((locale - istante) / MINUTE_MS);
}

interface Transizione {
  /** Istante del cambio (ms UTC). */
  at: number;
  from: number;
  to: number;
}

/** I cambi d'ora fra due istanti, al minuto. */
function transizioni(timeZone: string, da: number, a: number): Transizione[] {
  const trovate: Transizione[] = [];
  let t = da;
  let off = offsetMinutes(timeZone, t);
  while (t < a) {
    const prossimo = Math.min(t + DAY_MS, a);
    const offProssimo = offsetMinutes(timeZone, prossimo);
    if (offProssimo !== off) {
      // Ricerca binaria del primo minuto con il nuovo scarto.
      let lo = t;
      let hi = prossimo;
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
        if (offsetMinutes(timeZone, mid) === off) lo = mid;
        else hi = mid;
      }
      trovate.push({ at: hi, from: off, to: offProssimo });
      off = offProssimo;
    }
    t = prossimo;
  }
  return trovate;
}

interface Regola {
  month: number; // 1-12
  /** Settimana nel mese: 1..4, oppure -1 per l'ultima. */
  week: number;
  weekday: number; // 0 = domenica
  /** Minuti dalla mezzanotte locale (nello scarto di partenza). */
  minutes: number;
  from: number;
  to: number;
}

/** La regola annuale di una transizione: «l'ultima domenica di marzo alle 2». */
function regolaDi(tr: Transizione): Regola {
  const locale = new Date(tr.at + tr.from * MINUTE_MS);
  const day = locale.getUTCDate();
  const giorniNelMese = new Date(
    Date.UTC(locale.getUTCFullYear(), locale.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return {
    month: locale.getUTCMonth() + 1,
    week: day > giorniNelMese - 7 ? -1 : Math.ceil(day / 7),
    weekday: locale.getUTCDay(),
    minutes: locale.getUTCHours() * 60 + locale.getUTCMinutes(),
    from: tr.from,
    to: tr.to,
  };
}

/** Il giorno (ms UTC della mezzanotte locale) in cui la regola scatta in `year`. */
function giornoDellaRegola(r: Regola, year: number): number {
  if (r.week === -1) {
    const ultimo = new Date(Date.UTC(year, r.month, 0));
    const indietro = (ultimo.getUTCDay() - r.weekday + 7) % 7;
    return ultimo.getTime() - indietro * DAY_MS;
  }
  const primo = new Date(Date.UTC(year, r.month - 1, 1));
  const avanti = (r.weekday - primo.getUTCDay() + 7) % 7;
  return primo.getTime() + (avanti + (r.week - 1) * 7) * DAY_MS;
}

/** L'istante UTC in cui la regola scatta in `year`. */
function istanteDellaRegola(r: Regola, year: number): number {
  return giornoDellaRegola(r, year) + r.minutes * MINUTE_MS - r.from * MINUTE_MS;
}

function scarto(min: number): string {
  const segno = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  return `${segno}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

function due(n: number): string {
  return String(n).padStart(2, '0');
}

/** Data e ora locali nel formato iCalendar, senza `Z`. */
function oraLocale(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${due(d.getUTCMonth() + 1)}${due(d.getUTCDate())}` +
    `T${due(d.getUTCHours())}${due(d.getUTCMinutes())}${due(d.getUTCSeconds())}`
  );
}

/** Istante UTC nel formato iCalendar (`…Z`). */
export function oraUtc(date: Date): string {
  return `${oraLocale(date.getTime())}Z`;
}

export interface FusoCalendario {
  /** Le righe VTIMEZONE da mettere nel VCALENDAR. */
  vtimezone: string[];
  /** `DTSTART;TZID=…:…` per un istante. */
  property: (name: string, date: Date) => string;
}

function osservanza(
  tipo: 'STANDARD' | 'DAYLIGHT',
  r: Regola | null,
  fisso?: number
): string[] {
  if (!r) {
    const off = scarto(fisso ?? 0);
    return [
      `BEGIN:${tipo}`,
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${off}`,
      `TZOFFSETTO:${off}`,
      `END:${tipo}`,
    ];
  }
  // DTSTART sulla prima occorrenza della regola, come chiede RFC 5545.
  const inizio = giornoDellaRegola(r, 1970) + r.minutes * MINUTE_MS;
  const settimana = r.week === -1 ? '-1' : String(r.week);
  return [
    `BEGIN:${tipo}`,
    `DTSTART:${oraLocale(inizio)}`,
    `RRULE:FREQ=YEARLY;BYMONTH=${r.month};BYDAY=${settimana}${WEEKDAYS[r.weekday]}`,
    `TZOFFSETFROM:${scarto(r.from)}`,
    `TZOFFSETTO:${scarto(r.to)}`,
    `END:${tipo}`,
  ];
}

interface DefinizioneFuso {
  /** I cambi d'ora dell'anno prima, dell'anno e dell'anno dopo. */
  tutte: Transizione[];
  /** La VTIMEZONE, o null se le regole non si scrivono con sicurezza. */
  vtimezone: string[] | null;
}

/**
 * Le regole dipendono solo da fuso e anno: si calcolano una volta per
 * processo (sono circa mille letture di `Intl`), non a ogni invito.
 */
const definizioni = new Map<string, DefinizioneFuso>();
const MAX_DEFINIZIONI = 500;

function definizioneDelFuso(timeZone: string, anno: number): DefinizioneFuso {
  const chiave = `${timeZone}|${anno}`;
  const pronta = definizioni.get(chiave);
  if (pronta) return pronta;

  const tutte = transizioni(timeZone, Date.UTC(anno - 1, 0, 1), Date.UTC(anno + 2, 0, 1));
  let vtimezone: string[] | null = null;
  if (tutte.length === 0) {
    const fisso = offsetMinutes(timeZone, Date.UTC(anno, 0, 1));
    vtimezone = [
      'BEGIN:VTIMEZONE',
      `TZID:${timeZone}`,
      ...osservanza('STANDARD', null, fisso),
      'END:VTIMEZONE',
    ];
  } else {
    const dellAnno = tutte.filter((tr) => new Date(tr.at).getUTCFullYear() === anno);
    if (dellAnno.length === 2 && tutte.length === 6) {
      const [r1, r2] = dellAnno.map(regolaDi) as [Regola, Regola];
      // Le regole devono riprodurre ogni cambio d'ora dei tre anni.
      const coerenti =
        r1.to === r2.from &&
        r2.to === r1.from &&
        r1.from !== r1.to &&
        tutte.every((tr) => {
          const r = tr.to === r1.to ? r1 : r2;
          return istanteDellaRegola(r, new Date(tr.at).getUTCFullYear()) === tr.at;
        });
      if (coerenti) {
        const legale = r1.to > r1.from ? r1 : r2;
        const solare = legale === r1 ? r2 : r1;
        vtimezone = [
          'BEGIN:VTIMEZONE',
          `TZID:${timeZone}`,
          ...osservanza('DAYLIGHT', legale),
          ...osservanza('STANDARD', solare),
          'END:VTIMEZONE',
        ];
      }
    }
  }

  const definizione = { tutte, vtimezone };
  if (definizioni.size >= MAX_DEFINIZIONI) definizioni.clear();
  definizioni.set(chiave, definizione);
  return definizione;
}

/**
 * Il fuso da usare per gli istanti dell'evento, oppure null se gli orari
 * devono restare in UTC (fuso sconosciuto, regole non annuali, evento a
 * ridosso di un cambio d'ora).
 */
export function fusoCalendario(timeZone: string, istanti: Date[]): FusoCalendario | null {
  if (!timeZone || timeZone === 'UTC' || timeZone === 'Etc/UTC') return null;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(timeZone)) return null;
  try {
    formatter(timeZone);
  } catch {
    return null;
  }
  if (istanti.length === 0) return null;

  const { tutte, vtimezone } = definizioneDelFuso(timeZone, istanti[0]!.getUTCFullYear());
  if (!vtimezone) return null;

  // Un'ora locale vicina a un cambio d'ora puo' essere ambigua o non
  // esistere: in quel caso l'istante UTC e' l'unica scrittura sicura.
  const MARGINE = 3 * 60 * MINUTE_MS;
  for (const d of istanti) {
    if (tutte.some((tr) => Math.abs(tr.at - d.getTime()) <= MARGINE)) return null;
  }

  return {
    vtimezone,
    property: (name, date) => {
      const off = offsetMinutes(timeZone, date.getTime());
      return `${name};TZID=${timeZone}:${oraLocale(date.getTime() + off * MINUTE_MS)}`;
    },
  };
}
