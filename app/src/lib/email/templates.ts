/**
 * HTML email templates for confirmation and reminder emails.
 * Clean inline-styled HTML — no external images or CSS frameworks.
 */

import type { ResolvedEmailTemplate } from './resolve-template';
import type { EmailLocale } from './lingua';

type Locale = EmailLocale;

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailTemplateInput {
  locale: Locale;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventDuration: string;
  joinUrl: string;
  eventPageUrl: string;
  offsetMinutes?: number;
  calendarLinks?: {
    google: string;
    outlook: string;
    yahoo: string;
    icsDownload: string;
  };
  siteName?: string;
  organizationFooter?: string;
  /** Immagine dell'evento (URL assoluto), mostrata come banner in cima. */
  eventImageUrl?: string | null;
}

interface LocaleCopy {
  confirmationSubject: (title: string) => string;
  reminderSubject: (title: string, offsetMinutes: number) => string;
  confirmationHeading: string;
  reminderHeading: string;
  reminderNote: (offsetMinutes: number) => string;
  eventLabel: string;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  joinLabel: string;
  keepNote: string;
  viewEvent: string;
  addToCalendar: string;
  downloadIcs: string;
  footer: string;
  unsubscribe: string;
}

const copy: Record<Locale, LocaleCopy> = {
  it: {
    confirmationSubject: (title) => `Conferma registrazione: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Promemoria: ${title} inizia domani`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Promemoria: ${title} inizia tra ${hours} or${hours === 1 ? 'a' : 'e'}`;
      }
      return `Promemoria: ${title} inizia tra ${offsetMinutes} minuti`;
    },
    confirmationHeading: 'Registrazione confermata',
    reminderHeading: 'Promemoria evento',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'L\u2019evento a cui sei registrato inizia domani. Usa il link qui sotto per accedere.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `L\u2019evento a cui sei registrato inizia tra ${hours} or${hours === 1 ? 'a' : 'e'}. Usa il link qui sotto per accedere.`;
      }
      return `L\u2019evento a cui sei registrato inizia tra ${offsetMinutes} minuti. Usa il link qui sotto per accedere.`;
    },
    eventLabel: 'Evento',
    dateLabel: 'Data',
    timeLabel: 'Ora',
    durationLabel: 'Durata',
    joinLabel: 'Accedi all\u2019evento',
    keepNote:
      'Conserva questa email, contiene il tuo link personale per accedere all\u2019evento.',
    viewEvent: 'Visualizza la pagina dell\u2019evento',
    addToCalendar: 'Aggiungi al tuo calendario:',
    downloadIcs: 'Scarica .ics',
    footer: '',
    unsubscribe:
      'Ricevi questa email perch\u00e9 ti sei registrato all\u2019evento. Nessuna azione ulteriore \u00e8 necessaria per disiscriverti.',
  },
  en: {
    confirmationSubject: (title) => `Registration confirmed: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Reminder: ${title} starts tomorrow`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Reminder: ${title} starts in ${hours} hour${hours === 1 ? '' : 's'}`;
      }
      return `Reminder: ${title} starts in ${offsetMinutes} minutes`;
    },
    confirmationHeading: 'Registration confirmed',
    reminderHeading: 'Event reminder',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'The event you registered for starts tomorrow. Use the link below to join.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `The event you registered for starts in ${hours} hour${hours === 1 ? '' : 's'}. Use the link below to join.`;
      }
      return `The event you registered for starts in ${offsetMinutes} minutes. Use the link below to join.`;
    },
    eventLabel: 'Event',
    dateLabel: 'Date',
    timeLabel: 'Time',
    durationLabel: 'Duration',
    joinLabel: 'Join the event',
    keepNote:
      'Keep this email \u2014 it contains your personal link to access the event.',
    viewEvent: 'View event page',
    addToCalendar: 'Add to your calendar:',
    downloadIcs: 'Download .ics',
    footer: '',
    unsubscribe:
      'You are receiving this email because you registered for the event. No further action is needed to unsubscribe.',
  },
  fr: {
    confirmationSubject: (title) => `Inscription confirmée : ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Rappel : ${title} commence demain`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Rappel : ${title} commence dans ${hours} heure${hours === 1 ? '' : 's'}`;
      }
      return `Rappel : ${title} commence dans ${offsetMinutes} minute${offsetMinutes === 1 ? '' : 's'}`;
    },
    confirmationHeading: 'Inscription confirmée',
    reminderHeading: 'Rappel de l’événement',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'L’événement auquel vous êtes inscrit commence demain. Utilisez le lien ci-dessous pour y accéder.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `L’événement auquel vous êtes inscrit commence dans ${hours} heure${hours === 1 ? '' : 's'}. Utilisez le lien ci-dessous pour y accéder.`;
      }
      return `L’événement auquel vous êtes inscrit commence dans ${offsetMinutes} minute${offsetMinutes === 1 ? '' : 's'}. Utilisez le lien ci-dessous pour y accéder.`;
    },
    eventLabel: 'Événement',
    dateLabel: 'Date',
    timeLabel: 'Heure',
    durationLabel: 'Durée',
    joinLabel: 'Accéder à l’événement',
    keepNote:
      'Conservez cet e-mail : il contient votre lien personnel pour accéder à l’événement.',
    viewEvent: 'Voir la page de l’événement',
    addToCalendar: 'Ajoutez-le à votre agenda :',
    downloadIcs: 'Télécharger le fichier .ics',
    footer: '',
    unsubscribe:
      'Vous recevez cet e-mail parce que vous vous êtes inscrit à l’événement. Aucune autre action n’est nécessaire pour vous désinscrire.',
  },
  de: {
    confirmationSubject: (title) => `Anmeldung bestätigt: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Erinnerung: ${title} beginnt morgen`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Erinnerung: ${title} beginnt in ${hours} Stunde${hours === 1 ? '' : 'n'}`;
      }
      return `Erinnerung: ${title} beginnt in ${offsetMinutes} Minute${offsetMinutes === 1 ? '' : 'n'}`;
    },
    confirmationHeading: 'Anmeldung bestätigt',
    reminderHeading: 'Erinnerung an die Veranstaltung',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'Die Veranstaltung, für die Sie angemeldet sind, beginnt morgen. Nutzen Sie den folgenden Link, um teilzunehmen.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Die Veranstaltung, für die Sie angemeldet sind, beginnt in ${hours} Stunde${hours === 1 ? '' : 'n'}. Nutzen Sie den folgenden Link, um teilzunehmen.`;
      }
      return `Die Veranstaltung, für die Sie angemeldet sind, beginnt in ${offsetMinutes} Minute${offsetMinutes === 1 ? '' : 'n'}. Nutzen Sie den folgenden Link, um teilzunehmen.`;
    },
    eventLabel: 'Veranstaltung',
    dateLabel: 'Datum',
    timeLabel: 'Uhrzeit',
    durationLabel: 'Dauer',
    joinLabel: 'An der Veranstaltung teilnehmen',
    keepNote:
      'Bitte bewahren Sie diese E-Mail auf: Sie enthält Ihren persönlichen Link zur Veranstaltung.',
    viewEvent: 'Seite der Veranstaltung anzeigen',
    addToCalendar: 'Zu Ihrem Kalender hinzufügen:',
    downloadIcs: '.ics herunterladen',
    footer: '',
    unsubscribe:
      'Sie erhalten diese E-Mail, weil Sie sich für die Veranstaltung angemeldet haben. Für eine Abmeldung ist keine weitere Aktion erforderlich.',
  },
  es: {
    confirmationSubject: (title) => `Inscripción confirmada: ${title}`,
    reminderSubject: (title, offsetMinutes) => {
      if (offsetMinutes >= 1440) return `Recordatorio: ${title} comienza mañana`;
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `Recordatorio: ${title} comienza en ${hours} hora${hours === 1 ? '' : 's'}`;
      }
      return `Recordatorio: ${title} comienza en ${offsetMinutes} minuto${offsetMinutes === 1 ? '' : 's'}`;
    },
    confirmationHeading: 'Inscripción confirmada',
    reminderHeading: 'Recordatorio del evento',
    reminderNote: (offsetMinutes) => {
      if (offsetMinutes >= 1440) {
        return 'El evento en el que está inscrito comienza mañana. Utilice el enlace que figura a continuación para acceder.';
      }
      if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `El evento en el que está inscrito comienza en ${hours} hora${hours === 1 ? '' : 's'}. Utilice el enlace que figura a continuación para acceder.`;
      }
      return `El evento en el que está inscrito comienza en ${offsetMinutes} minuto${offsetMinutes === 1 ? '' : 's'}. Utilice el enlace que figura a continuación para acceder.`;
    },
    eventLabel: 'Evento',
    dateLabel: 'Fecha',
    timeLabel: 'Hora',
    durationLabel: 'Duración',
    joinLabel: 'Acceder al evento',
    keepNote:
      'Conserve este correo electrónico: contiene su enlace personal para acceder al evento.',
    viewEvent: 'Ver la página del evento',
    addToCalendar: 'Añada el evento a su calendario:',
    downloadIcs: 'Descargar .ics',
    footer: '',
    unsubscribe:
      'Recibe este correo electrónico porque se ha inscrito en el evento. No es necesaria ninguna otra acción para darse de baja.',
  },
};

/**
 * URL assoluto dell'immagine di un evento, o null.
 *
 * `imageUrl`/`coverImageUrl` sono normalmente già assoluti (li scrive la rotta
 * di upload), ma un valore relativo esiste in configurazioni più vecchie e in
 * un client di posta non risolverebbe: lo ancoriamo al base URL pubblico.
 */
export function absoluteEventImage(
  event: { imageUrl?: string | null; coverImageUrl?: string | null },
  baseUrl: string,
): string | null {
  // Cover-first, come le card in-app e le anteprime social: la copertina 16:9
  // curata vince sulla generica, così un evento mostra la STESSA immagine su
  // ogni canale (prima l'email era imageUrl-first e divergeva dal resto).
  const raw = event.coverImageUrl ?? event.imageUrl;
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Banner dell'evento. Solo URL assoluti http(s): il valore finisce in un
 * `src=` dentro l'HTML dell'email, quindi uno schema arbitrario (`javascript:`,
 * `data:`) non deve poter passare, e un percorso relativo non risolverebbe
 * comunque in un client di posta.
 */
function eventBanner(url: string | null | undefined, alt: string): string {
  if (!url) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  return `
<!-- Banner evento -->
<tr><td style="padding:0;line-height:0;">
  <img src="${escapeHtml(parsed.toString())}" alt="${escapeHtml(alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</td></tr>
`;
}

function layout(
  heading: string,
  body: string,
  footerText: string,
  locale: Locale = 'it',
  siteName = 'PA Webinar',
  banner = '',
): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f7;font-family:'Titillium Web',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" style="background:#f5f6f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:100%;">

<!-- Header -->
<tr><td style="background:#06c;padding:20px 24px;">
  <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(siteName)}</span>
</td></tr>
${banner}
<!-- Heading -->
<tr><td style="padding:32px 24px 8px;">
  <h1 style="margin:0;font-size:24px;color:#17324d;">${heading}</h1>
</td></tr>

<!-- Body -->
<tr><td style="padding:16px 24px 32px;font-size:16px;line-height:1.6;color:#33475b;">
${body}
</td></tr>

<!-- Footer -->
<tr><td style="background:#f5f6f7;padding:16px 24px;font-size:12px;color:#5c6f82;text-align:center;">
  ${footerText}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function detailsTable(
  c: LocaleCopy,
  input: EmailTemplateInput,
): string {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr>
  <td style="padding:8px 12px;font-weight:600;color:#17324d;width:100px;">${c.eventLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventTitle)}</td>
</tr>
<tr style="background:#f5f6f7;">
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.dateLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventDate)}</td>
</tr>
<tr>
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.timeLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventTime)}</td>
</tr>
<tr style="background:#f5f6f7;">
  <td style="padding:8px 12px;font-weight:600;color:#17324d;">${c.durationLabel}</td>
  <td style="padding:8px 12px;">${escapeHtml(input.eventDuration)}</td>
</tr>
</table>`;
}

function calendarLinksSection(
  c: LocaleCopy,
  links: NonNullable<EmailTemplateInput['calendarLinks']>,
): string {
  const linkStyle =
    'color:#0066CC;text-decoration:none;font-size:14px;white-space:nowrap;';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
<tr><td colspan="4" style="padding-bottom:8px;font-size:14px;color:#455B71;">${c.addToCalendar}</td></tr>
<tr>
  <td style="padding-right:16px;"><a href="${links.google}" style="${linkStyle}">📅 Google</a></td>
  <td style="padding-right:16px;"><a href="${links.outlook}" style="${linkStyle}">📅 Outlook</a></td>
  <td style="padding-right:16px;"><a href="${links.yahoo}" style="${linkStyle}">📅 Yahoo</a></td>
  <td><a href="${links.icsDownload}" style="${linkStyle}">⬇️ ${c.downloadIcs}</a></td>
</tr>
</table>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" style="margin:24px 0;"><tr><td>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:#06c;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;">
${label}
</a>
</td></tr></table>`;
}

export function confirmationSubject(
  locale: Locale,
  eventTitle: string,
): string {
  return copy[locale].confirmationSubject(eventTitle);
}

export function reminderSubject(locale: Locale, eventTitle: string, offsetMinutes = 60): string {
  return copy[locale].reminderSubject(eventTitle, offsetMinutes);
}

/**
 * Produces the default (non-overridden) resolved copy for a given template +
 * locale + input. The resolver merges admin overrides on top of this result.
 */
export function baseConfirmationCopy(input: EmailTemplateInput): ResolvedEmailTemplate {
  const c = copy[input.locale];
  return {
    subject: c.confirmationSubject(input.eventTitle),
    heading: c.confirmationHeading,
    bodyIntro: null,
    ctaLabel: c.joinLabel,
    infoNote: c.keepNote,
    footerNote: c.unsubscribe,
  };
}

export function baseReminderCopy(input: EmailTemplateInput): ResolvedEmailTemplate {
  const c = copy[input.locale];
  const offset = input.offsetMinutes ?? 60;
  return {
    subject: c.reminderSubject(input.eventTitle, offset),
    heading: c.reminderHeading,
    bodyIntro: c.reminderNote(offset),
    ctaLabel: c.joinLabel,
    infoNote: null,
    footerNote: c.unsubscribe,
  };
}

export function confirmationHtml(
  input: EmailTemplateInput,
  resolved?: ResolvedEmailTemplate,
): string {
  const c = copy[input.locale];
  const r = resolved ?? baseConfirmationCopy(input);
  const calendarHtml = input.calendarLinks
    ? calendarLinksSection(c, input.calendarLinks)
    : '';
  const footerText = input.organizationFooter || c.footer;
  const intro = r.bodyIntro
    ? `<p style="margin:0 0 16px;">${escapeHtml(r.bodyIntro)}</p>`
    : '';
  const info = r.infoNote
    ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:2px;font-size:14px;color:#664d03;">
  ⚠️ ${escapeHtml(r.infoNote)}
</p>`
    : '';
  const eventName = input.eventTitle
    ? `<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#17324d;">${escapeHtml(input.eventTitle)}</p>`
    : '';
  const body = `
${eventName}
${intro}
${detailsTable(c, input)}
${ctaButton(r.ctaLabel, input.joinUrl)}
${calendarHtml}
${info}
<p style="margin:16px 0 0;font-size:14px;"><a href="${input.eventPageUrl}" style="color:#06c;">${c.viewEvent}</a></p>`;

  return layout(
    escapeHtml(r.heading),
    body,
    `${footerText}<br>${escapeHtml(r.footerNote)}`,
    input.locale,
    input.siteName,
    eventBanner(input.eventImageUrl, input.eventTitle),
  );
}

export function confirmationText(
  input: EmailTemplateInput,
  resolved?: ResolvedEmailTemplate,
): string {
  const c = copy[input.locale];
  const r = resolved ?? baseConfirmationCopy(input);
  const footerText = input.organizationFooter || c.footer;
  const calendarBlock = input.calendarLinks
    ? [
        '',
        c.addToCalendar,
        `Google Calendar: ${input.calendarLinks.google}`,
        `Outlook: ${input.calendarLinks.outlook}`,
        `Yahoo: ${input.calendarLinks.yahoo}`,
        `${c.downloadIcs}: ${input.calendarLinks.icsDownload}`,
      ]
    : [];
  const introLines = r.bodyIntro ? [r.bodyIntro, ''] : [];
  const infoLines = r.infoNote ? [r.infoNote, ''] : [];
  return [
    r.heading,
    '',
    ...introLines,
    `${c.eventLabel}: ${input.eventTitle}`,
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    `${c.durationLabel}: ${input.eventDuration}`,
    '',
    `${r.ctaLabel}: ${input.joinUrl}`,
    ...calendarBlock,
    '',
    ...infoLines,
    `${c.viewEvent}: ${input.eventPageUrl}`,
    '',
    footerText,
    r.footerNote,
  ].join('\n');
}

export function reminderHtml(
  input: EmailTemplateInput,
  resolved?: ResolvedEmailTemplate,
): string {
  const c = copy[input.locale];
  const r = resolved ?? baseReminderCopy(input);
  const calendarHtml = input.calendarLinks
    ? calendarLinksSection(c, input.calendarLinks)
    : '';
  const footerText = input.organizationFooter || c.footer;
  const intro = r.bodyIntro
    ? `<p style="margin:0 0 16px;">${escapeHtml(r.bodyIntro)}</p>`
    : '';
  const info = r.infoNote
    ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:2px;font-size:14px;color:#664d03;">
  ⚠️ ${escapeHtml(r.infoNote)}
</p>`
    : '';
  const eventName = input.eventTitle
    ? `<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#17324d;">${escapeHtml(input.eventTitle)}</p>`
    : '';
  const body = `
${eventName}
${intro}
${detailsTable(c, input)}
${ctaButton(r.ctaLabel, input.joinUrl)}
${calendarHtml}
${info}
<p style="margin:16px 0 0;font-size:14px;"><a href="${input.eventPageUrl}" style="color:#06c;">${c.viewEvent}</a></p>`;

  return layout(
    escapeHtml(r.heading),
    body,
    `${footerText}<br>${escapeHtml(r.footerNote)}`,
    input.locale,
    input.siteName,
    eventBanner(input.eventImageUrl, input.eventTitle),
  );
}

export function reminderText(
  input: EmailTemplateInput,
  resolved?: ResolvedEmailTemplate,
): string {
  const c = copy[input.locale];
  const r = resolved ?? baseReminderCopy(input);
  const footerText = input.organizationFooter || c.footer;
  const calendarBlock = input.calendarLinks
    ? [
        '',
        c.addToCalendar,
        `Google Calendar: ${input.calendarLinks.google}`,
        `Outlook: ${input.calendarLinks.outlook}`,
        `Yahoo: ${input.calendarLinks.yahoo}`,
        `${c.downloadIcs}: ${input.calendarLinks.icsDownload}`,
      ]
    : [];
  const introLines = r.bodyIntro ? [r.bodyIntro, ''] : [];
  const infoLines = r.infoNote ? [r.infoNote, ''] : [];
  return [
    r.heading,
    '',
    ...introLines,
    `${c.eventLabel}: ${input.eventTitle}`,
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    `${c.durationLabel}: ${input.eventDuration}`,
    '',
    `${r.ctaLabel}: ${input.joinUrl}`,
    ...calendarBlock,
    '',
    ...infoLines,
    `${c.viewEvent}: ${input.eventPageUrl}`,
    '',
    footerText,
    r.footerNote,
  ].join('\n');
}

// ── Post-event follow-up emails ──────────────────────────────────────────────

interface PostEventParticipantInput {
  locale: Locale;
  eventTitle: string;
  /** The concluded event page — recap + feedback form live here. */
  eventPageUrl: string;
  siteName?: string;
  organizationFooter?: string;
}

interface PostEventModeratorInput extends PostEventParticipantInput {
  /** Plain-text recap summary (see formatRecapSummary). May be empty. */
  recapSummary: string;
  /** Public recording URL, when available. */
  recordingUrl?: string | null;
}

const postEventCopy: Record<
  Locale,
  {
    participantSubject: (title: string) => string;
    participantHeading: string;
    participantIntro: (title: string) => string;
    participantCta: string;
    moderatorSubject: (title: string) => string;
    moderatorHeading: string;
    moderatorIntro: (title: string) => string;
    recapLabel: string;
    moderatorCta: string;
    recordingCta: string;
  }
> = {
  it: {
    participantSubject: (t) => `Grazie per aver partecipato: ${t}`,
    participantHeading: 'Grazie per la partecipazione',
    participantIntro: (t) =>
      `Grazie per aver partecipato a "${t}". Sulla pagina dell'evento trovi il riepilogo e puoi lasciare un feedback.`,
    participantCta: 'Vedi il riepilogo e lascia un feedback',
    moderatorSubject: (t) => `Evento concluso: ${t}`,
    moderatorHeading: 'Il tuo evento è concluso',
    moderatorIntro: (t) => `L'evento "${t}" è concluso. Ecco un riepilogo sintetico.`,
    recapLabel: 'Riepilogo',
    moderatorCta: 'Apri la pagina evento',
    recordingCta: 'Guarda la registrazione',
  },
  en: {
    participantSubject: (t) => `Thanks for attending: ${t}`,
    participantHeading: 'Thanks for attending',
    participantIntro: (t) =>
      `Thanks for attending "${t}". You'll find the recap and a feedback form on the event page.`,
    participantCta: 'See the recap and leave feedback',
    moderatorSubject: (t) => `Event concluded: ${t}`,
    moderatorHeading: 'Your event has ended',
    moderatorIntro: (t) => `The event "${t}" has ended. Here's a short recap.`,
    recapLabel: 'Recap',
    moderatorCta: 'Open the event page',
    recordingCta: 'Watch the recording',
  },
  fr: {
    participantSubject: (t) => `Merci de votre participation : ${t}`,
    participantHeading: 'Merci de votre participation',
    participantIntro: (t) =>
      `Merci d’avoir participé à « ${t} ». Sur la page de l’événement, vous trouverez le récapitulatif et pourrez laisser votre avis.`,
    participantCta: 'Voir le récapitulatif et donner votre avis',
    moderatorSubject: (t) => `Événement terminé : ${t}`,
    moderatorHeading: 'Votre événement est terminé',
    moderatorIntro: (t) => `L’événement « ${t} » est terminé. Voici un bref récapitulatif.`,
    recapLabel: 'Récapitulatif',
    moderatorCta: 'Ouvrir la page de l’événement',
    recordingCta: 'Voir l’enregistrement',
  },
  de: {
    participantSubject: (t) => `Vielen Dank für Ihre Teilnahme: ${t}`,
    participantHeading: 'Vielen Dank für Ihre Teilnahme',
    participantIntro: (t) =>
      `Vielen Dank für Ihre Teilnahme an „${t}“. Auf der Seite der Veranstaltung finden Sie die Zusammenfassung und können eine Rückmeldung geben.`,
    participantCta: 'Zusammenfassung ansehen und Rückmeldung geben',
    moderatorSubject: (t) => `Veranstaltung beendet: ${t}`,
    moderatorHeading: 'Ihre Veranstaltung ist beendet',
    moderatorIntro: (t) => `Die Veranstaltung „${t}“ ist beendet. Hier eine kurze Zusammenfassung.`,
    recapLabel: 'Zusammenfassung',
    moderatorCta: 'Seite der Veranstaltung öffnen',
    recordingCta: 'Aufzeichnung ansehen',
  },
  es: {
    participantSubject: (t) => `Gracias por su participación: ${t}`,
    participantHeading: 'Gracias por su participación',
    participantIntro: (t) =>
      `Gracias por participar en «${t}». En la página del evento encontrará el resumen y podrá dejar su opinión.`,
    participantCta: 'Ver el resumen y dejar su opinión',
    moderatorSubject: (t) => `Evento finalizado: ${t}`,
    moderatorHeading: 'Su evento ha finalizado',
    moderatorIntro: (t) => `El evento «${t}» ha finalizado. A continuación, un breve resumen.`,
    recapLabel: 'Resumen',
    moderatorCta: 'Abrir la página del evento',
    recordingCta: 'Ver la grabación',
  },
};

export function postEventParticipantEmail(input: PostEventParticipantInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = postEventCopy[input.locale];
  const footer = input.organizationFooter || copy[input.locale].footer;
  const subject = c.participantSubject(input.eventTitle);
  const body = `
<p style="margin:0 0 16px;">${escapeHtml(c.participantIntro(input.eventTitle))}</p>
${ctaButton(c.participantCta, input.eventPageUrl)}`;
  const html = layout(
    escapeHtml(c.participantHeading),
    body,
    footer,
    input.locale,
    input.siteName,
  );
  const text = [
    c.participantHeading,
    '',
    c.participantIntro(input.eventTitle),
    '',
    `${c.participantCta}: ${input.eventPageUrl}`,
    '',
    footer,
  ].join('\n');
  return { subject, html, text };
}

export function postEventModeratorEmail(input: PostEventModeratorInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = postEventCopy[input.locale];
  const footer = input.organizationFooter || copy[input.locale].footer;
  const subject = c.moderatorSubject(input.eventTitle);
  const recapHtml = input.recapSummary
    ? `<pre style="margin:0 0 16px;padding:12px 16px;background:#f5f7fb;border:1px solid #dee5ec;border-radius:4px;font-family:inherit;font-size:14px;white-space:pre-wrap;color:#17324d;">${escapeHtml(input.recapSummary)}</pre>`
    : '';
  const recordingHtml = input.recordingUrl
    ? `<p style="margin:16px 0 0;font-size:14px;"><a href="${input.recordingUrl}" style="color:#06c;">${escapeHtml(c.recordingCta)}</a></p>`
    : '';
  const body = `
<p style="margin:0 0 16px;">${escapeHtml(c.moderatorIntro(input.eventTitle))}</p>
${recapHtml}
${ctaButton(c.moderatorCta, input.eventPageUrl)}
${recordingHtml}`;
  const html = layout(
    escapeHtml(c.moderatorHeading),
    body,
    footer,
    input.locale,
    input.siteName,
  );
  const textLines = [c.moderatorHeading, '', c.moderatorIntro(input.eventTitle), ''];
  if (input.recapSummary) {
    textLines.push(`${c.recapLabel}:`, input.recapSummary, '');
  }
  textLines.push(`${c.moderatorCta}: ${input.eventPageUrl}`);
  if (input.recordingUrl) {
    textLines.push(`${c.recordingCta}: ${input.recordingUrl}`);
  }
  textLines.push('', footer);
  return { subject, html, text: textLines.join('\n') };
}

// ── Accesso dello staff (ADR-014) ───────────────────────────────────────

export interface StaffLoginEmailInput {
  locale: Locale;
  name: string;
  url: string;
  minutes: number;
  siteName?: string;
}

const staffLoginCopy: Record<
  Locale,
  {
    subject: (site: string) => string;
    heading: string;
    intro: (name: string, site: string) => string;
    cta: string;
    expiry: (minutes: number) => string;
    ignore: string;
  }
> = {
  it: {
    subject: (site) => `Il tuo link di accesso a ${site}`,
    heading: 'Accedi all’area di amministrazione',
    intro: (name, site) =>
      `Ciao ${name}, ecco il tuo link per entrare nell’area di amministrazione di ${site}. Vale una sola volta.`,
    cta: 'Entra',
    expiry: (m) => `Il link scade tra ${m} minuti.`,
    ignore: 'Se non aspettavi questo messaggio, ignoralo: senza il link non entra nessuno.',
  },
  en: {
    subject: (site) => `Your sign-in link for ${site}`,
    heading: 'Sign in to the administration area',
    intro: (name, site) =>
      `Hello ${name}, here is your link to sign in to the administration area of ${site}. It works only once.`,
    cta: 'Sign in',
    expiry: (m) => `The link expires in ${m} minutes.`,
    ignore: 'If you were not expecting this message, ignore it: nobody can sign in without the link.',
  },
  fr: {
    subject: (site) => `Votre lien de connexion à ${site}`,
    heading: 'Connexion à l’espace d’administration',
    intro: (name, site) =>
      `Bonjour ${name}, voici votre lien pour accéder à l’espace d’administration de ${site}. Il n’est valable qu’une seule fois.`,
    cta: 'Se connecter',
    expiry: (m) => `Le lien expire dans ${m} minute${m === 1 ? '' : 's'}.`,
    ignore:
      'Si vous n’attendiez pas ce message, ignorez-le : personne ne peut se connecter sans le lien.',
  },
  de: {
    subject: (site) => `Ihr Anmeldelink für ${site}`,
    heading: 'Anmeldung im Verwaltungsbereich',
    intro: (name, site) =>
      `Guten Tag ${name}, hier ist Ihr Link zur Anmeldung im Verwaltungsbereich von ${site}. Er ist nur einmal gültig.`,
    cta: 'Anmelden',
    expiry: (m) => `Der Link läuft in ${m} Minute${m === 1 ? '' : 'n'} ab.`,
    ignore:
      'Falls Sie diese Nachricht nicht erwartet haben, ignorieren Sie sie: Ohne den Link kann sich niemand anmelden.',
  },
  es: {
    subject: (site) => `Su enlace de acceso a ${site}`,
    heading: 'Acceso al área de administración',
    intro: (name, site) =>
      `Hola, ${name}: este es su enlace para acceder al área de administración de ${site}. Solo es válido una vez.`,
    cta: 'Acceder',
    expiry: (m) => `El enlace caduca en ${m} minuto${m === 1 ? '' : 's'}.`,
    ignore:
      'Si no esperaba este mensaje, ignórelo: nadie puede acceder sin el enlace.',
  },
};

export function staffLoginEmail(input: StaffLoginEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = staffLoginCopy[input.locale];
  const site = input.siteName ?? 'PA Webinar';
  const body = `
<p style="margin:0 0 16px;">${escapeHtml(c.intro(input.name, site))}</p>
${ctaButton(c.cta, input.url)}
<p style="margin:16px 0 0;color:#5A768A;font-size:14px;">${escapeHtml(c.expiry(input.minutes))}<br>${escapeHtml(c.ignore)}</p>`;
  const html = layout(escapeHtml(c.heading), body, '', input.locale, site);
  const text = [
    c.heading,
    '',
    c.intro(input.name, site),
    '',
    `${c.cta}: ${input.url}`,
    '',
    c.expiry(input.minutes),
    c.ignore,
  ].join('\n');
  return { subject: c.subject(site), html, text };
}
