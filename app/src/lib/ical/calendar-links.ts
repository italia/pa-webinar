/**
 * Generate "Add to Calendar" URLs for Google, Outlook, and Yahoo.
 * Used both server-side (in email templates) and client-side (in UI dropdown).
 */

import { markdownToPlainText } from '@/lib/utils/markdown-text';

export interface CalendarLinkInput {
  title: string;
  description: string;
  /** Oltre, la descrizione (gia' resa testo) si taglia su una parola: serve
   *  a chi mette il link in una pagina, dove l'indirizzo non deve crescere. */
  descriptionMax?: number;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string;
}

/** La descrizione (scritta in Markdown) come testo, poi il link per entrare. */
function dettagli(input: CalendarLinkInput): string {
  let testo = markdownToPlainText(input.description, { paragrafi: true });
  const massimo = input.descriptionMax;
  if (massimo !== undefined && testo.length > massimo) {
    const tagliato = testo.slice(0, massimo);
    const spazio = tagliato.search(/\s\S*$/);
    testo = `${(spazio > massimo * 0.6 ? tagliato.slice(0, spazio) : tagliato).trimEnd()}…`;
  }
  return testo ? `${testo}\n\n${input.joinUrl}` : input.joinUrl;
}

function toGoogleDateFormat(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function generateGoogleCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${toGoogleDateFormat(input.startsAt)}/${toGoogleDateFormat(input.endsAt)}`,
    details: dettagli(input),
    location: input.joinUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function generateOutlookCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: input.title,
    startdt: input.startsAt.toISOString(),
    enddt: input.endsAt.toISOString(),
    body: dettagli(input),
    location: input.joinUrl,
  });
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

export function generateYahooCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    v: '60',
    title: input.title,
    st: toGoogleDateFormat(input.startsAt),
    et: toGoogleDateFormat(input.endsAt),
    desc: dettagli(input),
    in_loc: input.joinUrl,
  });
  return `https://calendar.yahoo.com/?${params.toString()}`;
}

export function generateIcsDownloadUrl(
  eventSlug: string,
  baseUrl: string,
): string {
  return `${baseUrl}/api/events/${eventSlug}/calendar.ics`;
}
