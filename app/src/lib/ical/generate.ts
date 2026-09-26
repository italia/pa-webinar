/**
 * iCal generation for event invitations.
 * Attached to confirmation, reminder and date-change emails, and served by
 * the public `calendar.ics` download.
 */

import ical, { ICalCalendarMethod } from 'ical-generator';

import { appBaseUrl } from '@/lib/env';

export interface EventICalInput {
  /** Id dell'evento: con l'host del portale forma l'UID, uguale in ogni file. */
  eventId: string;
  /** `Event.updatedAt` al momento dell'invio: da qui la SEQUENCE. */
  updatedAt: Date;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  url: string;
  organizerName: string;
}

/**
 * Origine della SEQUENCE: secondi dal 1 gennaio 2024 UTC. Un valore piccolo
 * resta nell'intero a 32 bit di RFC 5545 per decenni, e nessun evento puo'
 * essere stato modificato prima di questa data.
 */
const SEQUENCE_EPOCH_MS = Date.UTC(2024, 0, 1);

/** Content-Type degli allegati .ics: il `method` deve coincidere con METHOD nel file. */
export const ICS_ATTACHMENT_CONTENT_TYPE = 'text/calendar; charset=utf-8; method=PUBLISH';

/**
 * La revisione del file di calendario per un evento.
 *
 * Deriva da `Event.updatedAt`, che Prisma aggiorna a ogni scrittura
 * dell'evento, spostamento di data compreso: cresce sempre, e un file spedito
 * dopo una modifica ha una SEQUENCE piu' alta di tutti quelli spediti prima.
 * Cresce anche per modifiche che non toccano le date: e' innocuo, il client
 * riapplica la stessa voce. Nessuna colonna in piu' nello schema.
 */
export function icsSequence(updatedAt: Date): number {
  return Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH_MS) / 1000));
}

/**
 * UID stabile: lo stesso evento ha lo stesso UID nella conferma, in ogni
 * promemoria, nell'avviso di cambio data e nel file scaricato. Con un UID
 * casuale per file il calendario aggiungeva una voce nuova a ogni allegato, e
 * dopo un cambio di data restava anche quella vecchia.
 */
export function icsUid(eventId: string): string {
  return `${eventId}@${appBaseUrl()?.host || 'localhost'}`;
}

/**
 * L'organizzatore nel file: l'indirizzo di piattaforma (`SMTP_FROM`), mai
 * l'email personale del moderatore. Il file arriva a ogni iscritto e si
 * inoltra; con l'email del moderatore ognuno ne riceveva una copia, e i client
 * gli mandavano le risposte di partecipazione. `||`: il chart lascia la chiave
 * vuota finche' non la si configura.
 */
export function calendarOrganizerEmail(): string {
  return process.env.SMTP_FROM || 'noreply@dominio.gov.it';
}

/**
 * Generate an iCal (.ics) string for an event.
 *
 * Times are emitted as UTC instants (`…Z`), NOT as local times tagged with a
 * TZID. Setting `timezone` here used to produce
 *
 *     DTSTART;TZID=Europe/Rome:20260722T091500
 *
 * for an event starting at 09:15Z — the UTC wall clock relabelled as Rome time,
 * because ical-generator does not convert the Date and we ship no VTIMEZONE
 * component for the TZID to resolve against. Calendar clients therefore booked
 * the event two hours early in summer (one in winter). Reproduced on a real
 * invitation before the fix.
 *
 * A UTC instant is unambiguous and needs no VTIMEZONE: every client renders it
 * in the reader's own zone, which is also what you want for an online event
 * whose audience is not necessarily in the organiser's country. `timezone`
 * stays on the input because callers use it to render the human-readable time
 * in the email body.
 *
 * METHOD:PUBLISH, not REQUEST: the file carries no ATTENDEE, so it is a
 * published event to add to one's calendar, not an invitation to answer.
 * With REQUEST and no attendee, clients either refused it or sent RSVP
 * replies to the organizer. Same UID and a growing SEQUENCE in every file,
 * so a later file updates the entry instead of adding a second one.
 */
export function generateEventICal(input: EventICalInput): string {
  const calendar = ical({
    name: input.title,
    method: ICalCalendarMethod.PUBLISH,
    prodId: { company: 'PA Webinar', product: 'pa-webinar' },
  });

  calendar.createEvent({
    id: icsUid(input.eventId),
    sequence: icsSequence(input.updatedAt),
    start: input.startsAt,
    end: input.endsAt,
    summary: input.title,
    description: input.description,
    url: input.url,
    organizer: {
      name: input.organizerName,
      email: calendarOrganizerEmail(),
    },
  });

  return calendar.toString();
}
