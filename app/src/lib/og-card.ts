/**
 * Cosa entra nella scheda di anteprima di un link condiviso.
 *
 * Sta fuori dalla rotta che la disegna perche' la decisione — quali campi
 * mostrare, come accorciarli, cosa fare quando un campo e' vuoto — e' l'unica
 * parte che si puo' sbagliare in silenzio: un'immagine viene fuori comunque, e
 * un titolo tagliato a meta' parola o una riga vuota al posto dell'ente non
 * fanno fallire niente. Qui si puo' guardare senza disegnare.
 */
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

/** Oltre questa lunghezza il titolo non ci sta in tre righe leggibili. */
const MAX_TITOLO = 110;
/** I relatori sono una riga sola: oltre, si taglia. */
const MAX_RELATORI = 120;

export interface EventoScheda {
  title: unknown;
  startsAt: Date;
  speakersInfo: unknown;
  organizerName: string | null;
}

export interface ImpostazioniScheda {
  ogShowDate: boolean;
  ogShowSpeakers: boolean;
  ogShowOrganization: boolean;
  organizationName: string;
  defaultTimezone: string;
  primaryColor: string;
}

export interface ContenutoScheda {
  titolo: string;
  ente: string;
  data: string;
  relatori: string;
  /** Il colore istituzionale, gia' validato: un valore non valido arrivato in
   *  configurazione renderebbe la scheda trasparente invece che blu. */
  colore: string;
}

/** Taglia sull'ultimo spazio invece che a meta' parola. */
export function accorcia(testo: string, massimo: number): string {
  const pulito = testo.replace(/\s+/g, ' ').trim();
  if (pulito.length <= massimo) return pulito;
  const tagliato = pulito.slice(0, massimo);
  const spazio = tagliato.lastIndexOf(' ');
  return `${(spazio > massimo * 0.6 ? tagliato.slice(0, spazio) : tagliato).trimEnd()}…`;
}

export function contenutoScheda(
  evento: EventoScheda,
  impostazioni: ImpostazioniScheda,
  locale: string,
): ContenutoScheda {
  const titolo = accorcia(getLocalized(evento.title as LocalizedField, locale), MAX_TITOLO);

  const relatori = impostazioni.ogShowSpeakers
    ? accorcia(getLocalized(evento.speakersInfo as LocalizedField, locale), MAX_RELATORI)
    : '';

  // L'organizzatore dell'evento e' piu' preciso del nome dell'ente quando c'e':
  // una serie ospitata da un'altra struttura va attribuita a quella.
  const ente = impostazioni.ogShowOrganization
    ? (evento.organizerName?.trim() || impostazioni.organizationName.trim())
    : '';

  let data = '';
  if (impostazioni.ogShowDate) {
    try {
      data = new Intl.DateTimeFormat(locale, {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: impostazioni.defaultTimezone || 'Europe/Rome',
      }).format(evento.startsAt);
    } catch {
      // Un fuso o una lingua non riconosciuti non devono far saltare
      // l'anteprima: si ripiega sul formato predefinito.
      data = new Intl.DateTimeFormat('it', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Europe/Rome',
      }).format(evento.startsAt);
    }
  }

  const colore = /^#[0-9a-f]{6}$/i.test(impostazioni.primaryColor)
    ? impostazioni.primaryColor
    : '#0066CC';

  return { titolo, ente, data, relatori, colore };
}

/** Dove andare a prendere la locandina, una volta deciso che si puo'. */
export type OrigineLocandina =
  | { tipo: 'interna'; url: string }
  | { tipo: 'esterna'; url: string };

/** Nomi che, per un processo dentro un cluster, indicano "casa nostra". */
const SUFFISSI_INTERNI = ['.local', '.internal', '.svc', '.cluster.local', '.localdomain'];

/** Letterali di indirizzo che non devono mai diventare una richiesta in uscita. */
function indirizzoPrivato(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 127 ||
    a === 0 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // Il servizio di metadati delle nuvole: l'indirizzo che rende interessante
    // far fare una richiesta a un server al posto proprio.
    (a === 169 && b === 254)
  );
}

/**
 * Decide da dove leggere la locandina di un evento.
 *
 * Due problemi diversi, stessa risposta:
 *
 *  1. quasi sempre l'indirizzo e' quello PUBBLICO di questa stessa
 *     applicazione (e' cosi' che vengono salvati i file caricati dal pannello):
 *     farglielo richiedere dall'esterno significa uscire e rientrare dal
 *     proprio ingresso, cosa che in molte reti non funziona — e la locandina
 *     sparirebbe da ogni anteprima funzionando benissimo in sviluppo. Si
 *     riscrive su loopback.
 *  2. per tutto il resto, l'indirizzo lo decide chi amministra, ma la richiesta
 *     la fa il server, e chiunque puo' innescarla chiedendo l'anteprima. Gli
 *     indirizzi privati e i nomi interni restano fuori: e' la strada per farsi
 *     leggere il servizio di metadati della nuvola o un servizio in cluster.
 */
export function origineLocandina(
  raw: string | null | undefined,
  baseUrl: string | null,
  portaLocale: string,
): OrigineLocandina | null {
  const valore = raw?.trim();
  if (!valore) return null;

  let url: URL;
  try {
    // Un percorso relativo si risolve sulla propria origine pubblica; senza
    // quella, su loopback: e' comunque la stessa applicazione.
    url = new URL(valore, baseUrl ?? `http://127.0.0.1:${portaLocale}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  let base: URL | null = null;
  if (baseUrl) {
    try {
      base = new URL(baseUrl);
    } catch {
      base = null;
    }
  }

  // Un percorso relativo e' nostro per definizione, anche quando l'indirizzo
  // pubblico non e' configurato: e' un file che serviamo noi.
  const relativo = valore.startsWith('/');

  if (relativo || (base && url.host === base.host)) {
    const interna = new URL(`http://127.0.0.1:${portaLocale}`);
    interna.pathname = url.pathname;
    interna.search = url.search;
    return { tipo: 'interna', url: interna.toString() };
  }

  const host = url.hostname.toLowerCase();
  if (indirizzoPrivato(host)) return null;
  if (SUFFISSI_INTERNI.some((s) => host.endsWith(s))) return null;

  return { tipo: 'esterna', url: url.toString() };
}
