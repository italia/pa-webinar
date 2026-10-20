/**
 * L'invito di calendario mandato a parte, con un'email breve:
 *
 * - il reinvio a tutte le persone di un evento (iscritti, moderatore
 *   principale, co-moderatori e relatori con un indirizzo), chiesto
 *   dall'amministrazione: per le iscrizioni raccolte prima che le email
 *   portassero l'invito, o dopo una modifica che i calendari devono ricevere;
 * - l'aggiornamento a chi conduce quando cambia la data: gli iscritti hanno
 *   l'avviso di cambio data (lib/email/notification), moderatori e relatori
 *   ricevono qui il loro invito con la nuova ora.
 *
 * Ogni email porta il link personale e l'invito (lib/ical/invitation): lo
 * stesso UID delle altre email, quindi la voce gia' in calendario si aggiorna
 * invece di raddoppiare.
 *
 * Il reinvio parte una volta sola per persona, orario dell'evento, indirizzo
 * e link: la chiave nella coda li contiene, quindi ripetere la richiesta non
 * rispedisce nulla, mentre dopo un cambio d'orario, un indirizzo corretto o
 * un token rinnovato un nuovo invio e' possibile. Non la SEQUENCE: cresce
 * anche per i cambi di stato del ciclo di vita, e una richiesta ripetuta dopo
 * l'apertura della sala rispedirebbe a tutti. L'aggiornamento dopo un cambio
 * di data non ha chiave: e' una modifica sola, e un ritorno a un orario gia'
 * usato deve comunque arrivare.
 */

import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { emailBaseUrl } from '@/lib/email/links';
import {
  invitoConduzione,
  liveUrlWithToken,
  organizzatoreInvito,
  personalLinkNote,
  NO_SEND_STATUSES,
  type ModeratorLinkRole,
} from '@/lib/email/moderator-link';
import {
  linguaEmail,
  linguaPagina,
  lingueIscrizione,
  type EmailLocale,
} from '@/lib/email/lingua';
import {
  enqueueEmail,
  enqueueEmailOnce,
  type EnqueueEmailInput,
} from '@/lib/email/outbox';
import { escapeHtml } from '@/lib/email/templates';
import { publicRegistrationFor } from '@/lib/events/registration-access';
import { registrationJoinUrl } from '@/lib/events/registration-link';
import { registrationInvite } from '@/lib/ical/invitation';
import { getSettings } from '@/lib/settings';
import { formatDate, formatTimeWithZone } from '@/lib/utils/date-format';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';
import { defaultLocale } from '@/i18n/config';

/** Perche' parte l'email: un invito (reinvio) o una nuova data. */
export type CalendarInviteReason = 'invite' | 'date-change';

interface ReasonCopy {
  subject: (title: string) => string;
  heading: string;
  intro: (title: string) => string;
}

interface InviteCopy {
  reasons: Record<CalendarInviteReason, ReasonCopy>;
  dateLabel: string;
  timeLabel: string;
  cta: string;
}

const COPY: Record<EmailLocale, InviteCopy> = {
  it: {
    reasons: {
      invite: {
        subject: (t) => `Invito per il calendario: ${t}`,
        heading: 'Il tuo invito per il calendario',
        intro: (t) =>
          `Ti mandiamo «${t}» come invito di calendario: accettalo o aggiungilo al tuo calendario. Il giorno dell’evento ti basta aprire l’appuntamento e seguire il link per entrare in sala.`,
      },
      'date-change': {
        subject: (t) => `Nuova data: ${t}`,
        heading: 'La data dell’evento è cambiata',
        intro: (t) =>
          `«${t}» ha una nuova data. L’invito in questa email aggiorna l’appuntamento nel tuo calendario; il tuo link per entrare in sala non cambia.`,
      },
    },
    dateLabel: 'Data',
    timeLabel: 'Ora',
    cta: 'Entra in sala',
  },
  en: {
    reasons: {
      invite: {
        subject: (t) => `Calendar invitation: ${t}`,
        heading: 'Your calendar invitation',
        intro: (t) =>
          `We are sending you “${t}” as a calendar invitation: accept it or add it to your calendar. On the day of the event, just open the appointment and follow the link to join the room.`,
      },
      'date-change': {
        subject: (t) => `New date: ${t}`,
        heading: 'The event date has changed',
        intro: (t) =>
          `“${t}” has a new date. The invitation in this email updates the appointment in your calendar; your link to join the room does not change.`,
      },
    },
    dateLabel: 'Date',
    timeLabel: 'Time',
    cta: 'Join the room',
  },
  fr: {
    reasons: {
      invite: {
        subject: (t) => `Invitation pour votre agenda : ${t}`,
        heading: 'Votre invitation pour l’agenda',
        intro: (t) =>
          `Nous vous envoyons « ${t} » sous forme d’invitation d’agenda : acceptez-la ou ajoutez-la à votre agenda. Le jour de l’événement, il vous suffit d’ouvrir le rendez-vous et de suivre le lien pour entrer dans la salle.`,
      },
      'date-change': {
        subject: (t) => `Nouvelle date : ${t}`,
        heading: 'La date de l’événement a changé',
        intro: (t) =>
          `« ${t} » a une nouvelle date. L’invitation contenue dans ce message met à jour le rendez-vous dans votre agenda ; votre lien pour entrer dans la salle ne change pas.`,
      },
    },
    dateLabel: 'Date',
    timeLabel: 'Heure',
    cta: 'Entrer dans la salle',
  },
  de: {
    reasons: {
      invite: {
        subject: (t) => `Kalendereinladung: ${t}`,
        heading: 'Ihre Kalendereinladung',
        intro: (t) =>
          `Wir senden Ihnen „${t}“ als Kalendereinladung: Nehmen Sie sie an oder fügen Sie sie Ihrem Kalender hinzu. Am Tag der Veranstaltung öffnen Sie einfach den Termin und folgen dem Link, um den Raum zu betreten.`,
      },
      'date-change': {
        subject: (t) => `Neues Datum: ${t}`,
        heading: 'Das Datum der Veranstaltung hat sich geändert',
        intro: (t) =>
          `„${t}“ hat ein neues Datum. Die Einladung in dieser E-Mail aktualisiert den Termin in Ihrem Kalender; Ihr Link zum Betreten des Raums bleibt unverändert.`,
      },
    },
    dateLabel: 'Datum',
    timeLabel: 'Uhrzeit',
    cta: 'Raum betreten',
  },
  es: {
    reasons: {
      invite: {
        subject: (t) => `Invitación para el calendario: ${t}`,
        heading: 'Su invitación para el calendario',
        intro: (t) =>
          `Le enviamos «${t}» como invitación de calendario: acéptela o añádala a su calendario. El día del evento, basta con abrir la cita y seguir el enlace para entrar en la sala.`,
      },
      'date-change': {
        subject: (t) => `Nueva fecha: ${t}`,
        heading: 'La fecha del evento ha cambiado',
        intro: (t) =>
          `«${t}» tiene una nueva fecha. La invitación de este correo actualiza la cita en su calendario; su enlace para entrar en la sala no cambia.`,
      },
    },
    dateLabel: 'Fecha',
    timeLabel: 'Hora',
    cta: 'Entrar en la sala',
  },
};

export interface CalendarInviteEmailInput {
  locale: EmailLocale;
  reason?: CalendarInviteReason;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  /** Il link personale per entrare in sala. */
  joinUrl: string;
  /** La riga che ricorda che il link e' personale (moderatori e relatori). */
  note?: string | null;
  siteName?: string;
}

/** L'email breve che accompagna l'invito. L'oggetto (in chiaro nella coda) non ha link. */
export function calendarInviteEmail(input: CalendarInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = COPY[input.locale];
  const r = c.reasons[input.reason ?? 'invite'];
  const site = input.siteName || 'PA Webinar';
  const html = `<!DOCTYPE html>
<html lang="${input.locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f7;font-family:'Titillium Web',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" style="background:#f5f6f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:100%;">
<tr><td style="background:#06c;padding:20px 24px;">
  <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(site)}</span>
</td></tr>
<tr><td style="padding:32px 24px 8px;">
  <h1 style="margin:0;font-size:24px;color:#17324d;">${escapeHtml(r.heading)}</h1>
</td></tr>
<tr><td style="padding:16px 24px 32px;font-size:16px;line-height:1.6;color:#33475b;">
<p style="margin:0 0 16px;">${escapeHtml(r.intro(input.eventTitle))}</p>
<p style="margin:0 0 8px;"><strong>${escapeHtml(c.dateLabel)}:</strong> ${escapeHtml(input.eventDate)}<br><strong>${escapeHtml(c.timeLabel)}:</strong> ${escapeHtml(input.eventTime)}</p>
<table role="presentation" style="margin:16px 0;"><tr><td>
<a href="${escapeHtml(input.joinUrl)}" style="display:inline-block;padding:12px 28px;background:#06c;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;">${escapeHtml(c.cta)}</a>
</td></tr></table>
${input.note ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:2px;font-size:14px;color:#664d03;">${escapeHtml(input.note)}</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    r.heading,
    '',
    r.intro(input.eventTitle),
    '',
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    '',
    `${c.cta}: ${input.joinUrl}`,
    ...(input.note ? ['', input.note] : []),
  ].join('\n');
  return { subject: r.subject(input.eventTitle), html, text };
}

export interface CalendarInviteRecipients {
  registrations: number;
  /** Co-moderatori e relatori attivi con un indirizzo. */
  grants: number;
  /** 1 se il moderatore principale ha un indirizzo. */
  primary: number;
  total: number;
}

export interface CalendarInviteResult {
  recipients: CalendarInviteRecipients;
  queued: number;
  /** Gia' in coda per questo orario dell'evento: non rispediti. */
  alreadyQueued: number;
  failed: number;
}

const EVENT_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  status: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  updatedAt: true,
  accessMode: true,
  moderatorToken: true,
  moderatorName: true,
  moderatorEmail: true,
} as const;

/** Vero se all'evento si possono mandare inviti: pubblicato e non concluso. */
export function canSendCalendarInvites(
  event: { status: string; endsAt: Date },
  now: Date = new Date()
): boolean {
  return !NO_SEND_STATUSES.has(event.status) && event.endsAt.getTime() > now.getTime();
}

/** Quante persone riceverebbero l'invito. Solo letture. */
export async function countCalendarInviteRecipients(
  eventId: string
): Promise<CalendarInviteRecipients> {
  const [event, registrations, grants] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { moderatorEmail: true } }),
    prisma.registration.count({ where: { eventId } }),
    prisma.eventModerator.count({
      where: { eventId, revokedAt: null, email: { not: null } },
    }),
  ]);
  const primary = tryDecryptPII(event?.moderatorEmail)?.trim() ? 1 : 0;
  return { registrations, grants, primary, total: registrations + grants + primary };
}

/**
 * La chiave nella coda: evento, orario (inizio e fine in secondi
 * dall'epoca) e posto. Il posto porta l'impronta (HMAC) dell'indirizzo e,
 * per chi conduce, del token: mai i valori.
 */
function dedupKey(
  event: { id: string; startsAt: Date; endsAt: Date },
  posto: string
): string {
  const orario = `${Math.floor(event.startsAt.getTime() / 1000)}-${Math.floor(event.endsAt.getTime() / 1000)}`;
  return `calendar-invite:${event.id}:${orario}:${posto}`;
}

const impronta = (valore: string) => hashEmail(valore).slice(0, 16);

export interface SendCalendarInvitesOptions {
  /** La lingua per moderatori e relatori, che non ne hanno una registrata
   *  (la stessa regola dei loro link); gli iscritti ricevono la loro. */
  staffLocale: string;
  /** `all` (predefinito) o solo chi conduce (`staff`). */
  seats?: 'all' | 'staff';
  /** Salta il moderatore principale: riceve gia' il suo link con l'invito. */
  skipPrimary?: boolean;
  reason?: CalendarInviteReason;
}

/**
 * Accoda l'email con l'invito per ognuno. Non lancia per una singola
 * persona: chi non va in coda si conta fra i `failed` e si puo' ritentare con
 * una nuova richiesta (le chiavi delle altre restano). Null se l'evento non
 * esiste.
 */
export async function sendCalendarInvites(
  eventId: string,
  opts: SendCalendarInvitesOptions
): Promise<CalendarInviteResult | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: EVENT_SELECT,
  });
  if (!event) return null;
  const soloConduzione = opts.seats === 'staff';
  const reason = opts.reason ?? 'invite';

  const [registrations, grants] = await Promise.all([
    soloConduzione
      ? Promise.resolve([])
      : prisma.registration.findMany({
          where: { eventId },
          select: { id: true, email: true, accessToken: true, locale: true },
          orderBy: { createdAt: 'asc' },
        }),
    prisma.eventModerator.findMany({
      where: { eventId, revokedAt: null, email: { not: null } },
      select: { id: true, name: true, email: true, role: true, token: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const principale = opts.skipPrimary
    ? null
    : tryDecryptPII(event.moderatorEmail)?.trim() || null;
  const recipients: CalendarInviteRecipients = {
    registrations: registrations.length,
    grants: grants.length,
    primary: principale ? 1 : 0,
    total: registrations.length + grants.length + (principale ? 1 : 0),
  };
  const result: CalendarInviteResult = {
    recipients,
    queued: 0,
    alreadyQueued: 0,
    failed: 0,
  };
  if (!canSendCalendarInvites(event)) return result;

  const settings = await getSettings();
  const base = emailBaseUrl();
  const organizzatore = await organizzatoreInvito(event.id, settings);
  const bindsIdentity = !publicRegistrationFor(event, settings.publicRegistrationEnabled);
  const siteName = settings.siteName || undefined;

  // Il reinvio una volta per chiave; l'aggiornamento dopo un cambio di data
  // sempre (vedi in testa).
  const accoda = async (messaggio: EnqueueEmailInput & { dedupKey: string }) => {
    if (reason === 'date-change') {
      await enqueueEmail({ ...messaggio, dedupKey: undefined });
      result.queued += 1;
      return;
    }
    if (await enqueueEmailOnce(messaggio)) result.queued += 1;
    else result.alreadyQueued += 1;
  };

  // Gli iscritti: il link firmato nell'email, quello della sala nell'invito.
  for (const reg of registrations) {
    try {
      const to = tryDecryptPII(reg.email)?.trim();
      if (!to) {
        result.failed += 1;
        continue;
      }
      const { pagina, testi } = lingueIscrizione(reg.locale, settings.defaultLocale);
      const title = getLocalized(event.title as LocalizedField, pagina);
      const link = {
        baseUrl: base,
        slug: event.slug,
        eventId: event.id,
        accessToken: reg.accessToken,
        locale: pagina,
      };
      const invito = registrationInvite(event, {
        title,
        description: getLocalized(event.description as LocalizedField, pagina),
        roomUrl: registrationJoinUrl({ ...link, viaEmailEntry: false }),
        eventPageUrl: localizedUrl(base, `/events/${event.slug}`, pagina),
        organizerName: organizzatore,
        attendeeEmail: to,
        locale: testi,
      });
      // Senza invito l'email non ha senso: si conta come non partita.
      if (!invito) {
        result.failed += 1;
        continue;
      }
      const mail = calendarInviteEmail({
        locale: testi,
        reason,
        eventTitle: title,
        eventDate: formatDate(event.startsAt, testi, event.timezone),
        eventTime: formatTimeWithZone(event.startsAt, testi, event.timezone),
        joinUrl: registrationJoinUrl({ ...link, viaEmailEntry: true, bindsIdentity }),
        siteName,
      });
      await accoda({
        to,
        ...mail,
        calendarInvite: invito,
        metadata: {
          kind: 'calendar-invite',
          seat: 'registration',
          eventId: event.id,
          registrationId: reg.id,
        },
        dedupKey: dedupKey(event, `registration:${reg.id}:${impronta(to)}`),
      });
    } catch (err) {
      result.failed += 1;
      console.error('[email] calendar invite not queued', {
        eventId: event.id,
        registrationId: reg.id,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  // Chi conduce: il link della sala con il proprio token. Mai nei log.
  const pagina =
    linguaPagina(opts.staffLocale) ??
    linguaPagina(settings.defaultLocale) ??
    defaultLocale;
  const testi = linguaEmail(pagina);
  const title = getLocalized(event.title as LocalizedField, pagina);
  const conduzione = async (
    role: ModeratorLinkRole,
    to: string,
    name: string | null,
    token: string,
    posto: string
  ) => {
    const liveUrl = liveUrlWithToken(base, event.slug, token, pagina);
    const invito = invitoConduzione(event, {
      to,
      name,
      role,
      pagina,
      testi,
      liveUrl,
      organizzatore,
    });
    if (!invito) throw new Error('calendar invitation not built');
    const mail = calendarInviteEmail({
      locale: testi,
      reason,
      eventTitle: title,
      eventDate: formatDate(event.startsAt, testi, event.timezone),
      eventTime: formatTimeWithZone(event.startsAt, testi, event.timezone),
      joinUrl: liveUrl,
      note: personalLinkNote(testi, role),
      siteName,
    });
    await accoda({
      to,
      ...mail,
      calendarInvite: invito,
      metadata: { kind: 'calendar-invite', seat: role, eventId: event.id },
      dedupKey: dedupKey(event, `${posto}:${impronta(to)}:${impronta(token)}`),
    });
  };

  if (principale) {
    try {
      await conduzione(
        'PRIMARY',
        principale,
        event.moderatorName,
        event.moderatorToken,
        'primary'
      );
    } catch (err) {
      result.failed += 1;
      console.error('[email] calendar invite not queued', {
        eventId: event.id,
        seat: 'primary',
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  for (const g of grants) {
    try {
      const to = tryDecryptPII(g.email)?.trim();
      if (!to) {
        result.failed += 1;
        continue;
      }
      const role: ModeratorLinkRole = g.role === 'SPEAKER' ? 'SPEAKER' : 'MODERATOR';
      await conduzione(
        role,
        to,
        tryDecryptPII(g.name) ?? g.name,
        g.token,
        `grant:${g.id}`
      );
    } catch (err) {
      result.failed += 1;
      console.error('[email] calendar invite not queued', {
        eventId: event.id,
        grantId: g.id,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  return result;
}

/**
 * Dopo un cambio di data: l'invito aggiornato a moderatore principale,
 * co-moderatori e relatori, che non ricevono l'avviso degli iscritti. Non
 * lancia: e' un effetto collaterale del salvataggio dell'evento.
 */
export async function sendStaffCalendarUpdates(
  eventId: string,
  opts: { staffLocale: string; skipPrimary?: boolean }
): Promise<void> {
  try {
    await sendCalendarInvites(eventId, {
      staffLocale: opts.staffLocale,
      seats: 'staff',
      skipPrimary: opts.skipPrimary,
      reason: 'date-change',
    });
  } catch (err) {
    console.error('[email] staff calendar updates not queued', {
      eventId,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
}
