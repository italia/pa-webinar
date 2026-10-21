/**
 * L'invito di calendario personale (iCalendar METHOD:REQUEST) che accompagna
 * le email di partecipazione: conferma d'iscrizione, promemoria, avviso di
 * cambio data, link di moderatori e relatori, reinvio dell'invito.
 *
 * Diverso dal file pubblico di `calendar.ics` (generate.ts, METHOD:PUBLISH):
 * qui c'e' un destinatario (ATTENDEE) e il suo link personale per entrare in
 * sala, quindi Gmail e Outlook mostrano la scheda «aggiungi / accetta» invece
 * di un allegato da aprire. Nel file non c'e' nessun dato personale oltre a
 * quelli di chi lo riceve: il suo indirizzo e il suo link.
 *
 * - UID stabile per evento, tipo di posto e indirizzo: ogni invio successivo
 *   (promemoria, cambio data, reinvio) aggiorna la stessa voce. L'indirizzo
 *   entra nell'UID solo come HMAC legato all'evento: l'UID si vede e si
 *   inoltra, e non deve ne' rivelare l'indirizzo ne' collegare la stessa
 *   persona fra eventi diversi. Il tipo di posto tiene separati il link da
 *   relatore e quello da iscritto della stessa persona: il promemoria
 *   dell'iscrizione non sostituisce il link da relatore nel calendario.
 * - SEQUENCE da `Event.updatedAt` (icsSequence): cresce a ogni modifica.
 * - ORGANIZER e' l'indirizzo di piattaforma (`SMTP_FROM`), lo stesso mittente
 *   dell'email; RSVP=FALSE: la piattaforma non legge le risposte, e Outlook
 *   non propone di mandarne una a una casella che non risponde.
 * - CLASS:PRIVATE: la voce porta un link personale, e chi vede il calendario
 *   condiviso di qualcun altro vede «occupato», non il link.
 * - Il link in LOCATION solo per gli iscritti (un posto in sala). Il link di
 *   moderatori e relatori e' una credenziale durevole: sta in URL e nella
 *   descrizione, che si leggono aprendo la voce, e non in LOCATION, che i
 *   promemoria del calendario mostrano a schermo anche durante una
 *   condivisione. Per loro LOCATION e' la pagina pubblica dell'evento.
 */

import { createHash, createHmac } from 'crypto';

import { tryGetAppSecret } from '@/lib/auth/app-secret';
import { appBaseUrl } from '@/lib/env';
import type { EmailLocale } from '@/lib/email/lingua';
import { calendarOrganizerEmail, icsSequence } from '@/lib/ical/generate';
import { fusoCalendario, oraUtc } from '@/lib/ical/timezone';
import { markdownToPlainText } from '@/lib/utils/markdown-text';

/** Il metodo iTIP dell'invito: deve coincidere con METHOD nel file. */
export const CALENDAR_INVITE_METHOD = 'REQUEST' as const;

/** A che titolo la persona riceve l'invito. */
export type CalendarSeat = 'registration' | 'primary' | 'grant';

export interface EventInvitationInput {
  eventId: string;
  /** `Event.updatedAt` al momento dell'invio: da qui la SEQUENCE. */
  updatedAt: Date;
  title: string;
  /** La descrizione dell'evento, in Markdown. */
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** Il link personale per entrare in sala. */
  joinUrl: string;
  eventPageUrl: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName?: string | null;
  seat: CalendarSeat;
  /** La lingua dei testi dell'invito. */
  locale: EmailLocale;
  /** Una riga sopra la descrizione: per esempio che il link e' personale. */
  note?: string | null;
  /** Il link anche in LOCATION (vero per gli iscritti; vedi in testa). */
  linkInLocation?: boolean;
  /** L'istante di generazione (DTSTAMP); di norma adesso. */
  now?: Date;
}

const COPY: Record<EmailLocale, { join: string; page: string }> = {
  it: { join: 'Per entrare in sala', page: 'Pagina dell’evento' },
  en: { join: 'To join the room', page: 'Event page' },
  fr: { join: 'Pour entrer dans la salle', page: 'Page de l’événement' },
  de: { join: 'Zum Betreten des Raums', page: 'Veranstaltungsseite' },
  es: { join: 'Para entrar en la sala', page: 'Página del evento' },
};

/** Testo iCalendar (RFC 5545 §3.3.11): barra, punto e virgola, virgola, a capo. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Valore di un parametro (CN): fra virgolette, senza virgolette ne' controlli. */
function paramValue(value: string): string {
  return `"${value.replace(/[\u0000-\u001F\u007F"]/g, '').trim()}"`;
}

/** Un URI in una proprieta': niente spazi ne' a capo. */
function uriValue(value: string): string {
  return value.replace(/[\s\u0000-\u001F\u007F]/g, '');
}

/**
 * Piega una riga a 75 ottetti (RFC 5545 §3.1) senza spezzare un carattere
 * UTF-8: le righe successive cominciano con uno spazio.
 */
export function foldIcsLine(line: string): string {
  const parti: string[] = [];
  let corrente = '';
  let ottetti = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (ottetti + n > 75) {
      parti.push(corrente);
      corrente = ' ';
      ottetti = 1;
    }
    corrente += ch;
    ottetti += n;
  }
  parti.push(corrente);
  return parti.join('\r\n');
}

function host(): string {
  return appBaseUrl()?.host || 'localhost';
}

/**
 * L'UID dell'invito per un posto: `<evento>.<tipo>.<hmac>@<host>`. L'HMAC
 * lega indirizzo, evento e tipo di posto con il segreto dell'istanza; senza
 * segreto (sviluppo) un hash semplice.
 */
export function invitationUid(
  eventId: string,
  seat: CalendarSeat,
  email: string
): string {
  const materiale = `calendar-invite:${eventId}:${seat}:${email.trim().toLowerCase()}`;
  const segreto = tryGetAppSecret();
  const digest = (segreto ? createHmac('sha256', segreto) : createHash('sha256'))
    .update(materiale)
    .digest('hex')
    .slice(0, 32);
  return `${eventId}.${seat}.${digest}@${host()}`;
}

/** Quello che serve dell'evento per l'invito, come lo leggono i chiamanti. */
export interface EventoCalendario {
  id: string;
  updatedAt: Date;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

/**
 * L'invito di un iscritto: il link della sala senza la firma dell'email (un
 * posto, non l'identita'), in LOCATION, URL e descrizione. Un solo punto per
 * conferma, promemoria, cambio data e reinvio: lo stesso UID per la stessa
 * persona in tutti.
 */
export function registrationInvite(
  event: EventoCalendario,
  opts: {
    title: string;
    description: string;
    /** Il link della sala, `/live?token=…`, senza firma. */
    roomUrl: string;
    eventPageUrl: string;
    organizerName: string;
    attendeeEmail: string;
    locale: EmailLocale;
  }
): ReturnType<typeof calendarInvite> {
  return calendarInvite({
    eventId: event.id,
    updatedAt: event.updatedAt,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    title: opts.title,
    description: opts.description,
    joinUrl: opts.roomUrl,
    eventPageUrl: opts.eventPageUrl,
    organizerName: opts.organizerName,
    attendeeEmail: opts.attendeeEmail,
    seat: 'registration',
    locale: opts.locale,
  });
}

/**
 * L'invito pronto per la coda, oppure undefined se non si riesce a comporlo:
 * un difetto dell'invito non deve fermare l'email che lo accompagna (un link
 * personale, una conferma). Nel log solo il tipo di errore, mai i dati.
 */
export function calendarInvite(
  input: EventInvitationInput
): { method: typeof CALENDAR_INVITE_METHOD; content: string } | undefined {
  try {
    return { method: CALENDAR_INVITE_METHOD, content: generateEventInvitation(input) };
  } catch (err) {
    console.error('[ical] calendar invitation not built', {
      eventId: input.eventId,
      seat: input.seat,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return undefined;
  }
}

/** L'invito iCalendar (METHOD:REQUEST) per una persona, con righe CRLF. */
export function generateEventInvitation(input: EventInvitationInput): string {
  for (const d of [input.startsAt, input.endsAt, input.updatedAt]) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      throw new RangeError('invalid event date');
    }
  }
  const c = COPY[input.locale];
  const joinUrl = uriValue(input.joinUrl);
  const eventPageUrl = uriValue(input.eventPageUrl);
  const testo = markdownToPlainText(input.description, { paragrafi: true });
  const descrizione = [
    `${c.join}:`,
    joinUrl,
    ...(input.note ? ['', input.note] : []),
    ...(testo ? ['', testo] : []),
    '',
    `${c.page}: ${eventPageUrl}`,
  ].join('\n');

  const fuso = fusoCalendario(input.timezone, [input.startsAt, input.endsAt]);
  const quando = (name: string, date: Date) =>
    fuso ? fuso.property(name, date) : `${name}:${oraUtc(date)}`;

  const attendee = [
    'ATTENDEE',
    'CUTYPE=INDIVIDUAL',
    'ROLE=REQ-PARTICIPANT',
    'PARTSTAT=NEEDS-ACTION',
    'RSVP=FALSE',
    ...(input.attendeeName?.trim() ? [`CN=${paramValue(input.attendeeName)}`] : []),
  ].join(';');

  const righe = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PA Webinar//pa-webinar//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${CALENDAR_INVITE_METHOD}`,
    ...(fuso ? fuso.vtimezone : []),
    'BEGIN:VEVENT',
    `UID:${invitationUid(input.eventId, input.seat, input.attendeeEmail)}`,
    `SEQUENCE:${icsSequence(input.updatedAt)}`,
    `DTSTAMP:${oraUtc(input.now ?? new Date())}`,
    `LAST-MODIFIED:${oraUtc(input.updatedAt)}`,
    quando('DTSTART', input.startsAt),
    quando('DTEND', input.endsAt),
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(descrizione)}`,
    `LOCATION:${escapeIcsText(input.linkInLocation === false ? eventPageUrl : joinUrl)}`,
    `URL:${joinUrl}`,
    `ORGANIZER;CN=${paramValue(input.organizerName)}:mailto:${uriValue(calendarOrganizerEmail())}`,
    `${attendee}:mailto:${uriValue(input.attendeeEmail)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'CLASS:PRIVATE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return righe.map(foldIcsLine).join('\r\n') + '\r\n';
}
