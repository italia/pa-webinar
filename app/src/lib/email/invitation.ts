/**
 * L'invito a un evento, per email, a chi e' nell'elenco degli invitati
 * (`EventInvitation`).
 *
 * L'invito porta alla pagina d'iscrizione con il modulo gia' compilato (nome
 * e indirizzo dell'invito, dal token `?invito=`): il token apre solo la
 * pagina, non da' un posto. Ci si iscrive come sempre, e con l'iscrizione
 * «solo su invito» il server controlla che l'indirizzo sia fra gli invitati.
 *
 * Gli inviti partono a richiesta dello staff dalla pagina dell'evento, quando
 * l'evento accetta iscrizioni (la stessa regola della pagina d'iscrizione):
 * mai da soli al salvataggio. Si possono rimandare
 * (`sentAt` registra l'ultimo invio). Chi si e' gia' iscritto non riceve
 * l'invito: ha gia' il suo link.
 *
 * La lingua e' quella della pagina da cui parte la richiesta (chi invita
 * sceglie la lingua dell'evento), con il ripiego delle lingue delle email.
 */

import { randomBytes } from 'node:crypto';

import { defaultLocale } from '@/i18n/config';
import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { linguaEmail, linguaPagina, type EmailLocale } from '@/lib/email/lingua';
import { emailBaseUrl } from '@/lib/email/links';
import { enqueueEmailOnce } from '@/lib/email/outbox';
import { escapeHtml } from '@/lib/email/templates';
import { publicRegistrationFor } from '@/lib/events/access-mode';
import { isEventOpenForRegistration } from '@/lib/events/visibility';
import { getSettings } from '@/lib/settings';
import { formatDate, formatTimeWithZone } from '@/lib/utils/date-format';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';

interface InvitationCopy {
  subject: (title: string) => string;
  heading: string;
  greeting: (name: string) => string;
  intro: (title: string, site: string) => string;
  onlyInvited: string;
  dateLabel: string;
  timeLabel: string;
  cta: string;
  after: string;
}

const COPY: Record<EmailLocale, InvitationCopy> = {
  it: {
    subject: (t) => `Invito: ${t}`,
    heading: 'Sei invitato a un evento',
    greeting: (n) => `Ciao ${n},`,
    intro: (t, s) => `ti invitiamo a partecipare a «${t}», su ${s}.`,
    onlyInvited:
      "L'iscrizione è riservata alle persone invitate: iscriviti con questo indirizzo email.",
    dateLabel: 'Data',
    timeLabel: 'Orario',
    cta: 'Iscriviti',
    after:
      "Dopo l'iscrizione ricevi per email il tuo link personale per entrare nella sala.",
  },
  en: {
    subject: (t) => `Invitation: ${t}`,
    heading: 'You are invited to an event',
    greeting: (n) => `Hello ${n},`,
    intro: (t, s) => `you are invited to take part in “${t}”, on ${s}.`,
    onlyInvited:
      'Registration is reserved for invited people: register with this email address.',
    dateLabel: 'Date',
    timeLabel: 'Time',
    cta: 'Register',
    after: 'Once registered, you receive your personal link to enter the room by email.',
  },
  fr: {
    subject: (t) => `Invitation : ${t}`,
    heading: 'Vous êtes invité à un événement',
    greeting: (n) => `Bonjour ${n},`,
    intro: (t, s) => `nous vous invitons à participer à « ${t} », sur ${s}.`,
    onlyInvited:
      "L'inscription est réservée aux personnes invitées : inscrivez-vous avec cette adresse e-mail.",
    dateLabel: 'Date',
    timeLabel: 'Horaire',
    cta: "S'inscrire",
    after:
      "Après l'inscription, vous recevez par e-mail votre lien personnel pour entrer dans la salle.",
  },
  de: {
    subject: (t) => `Einladung: ${t}`,
    heading: 'Sie sind zu einem Event eingeladen',
    greeting: (n) => `Guten Tag ${n},`,
    intro: (t, s) => `wir laden Sie zur Teilnahme an „${t}“ auf ${s} ein.`,
    onlyInvited:
      'Die Anmeldung ist eingeladenen Personen vorbehalten: Melden Sie sich mit dieser E-Mail-Adresse an.',
    dateLabel: 'Datum',
    timeLabel: 'Uhrzeit',
    cta: 'Anmelden',
    after: 'Nach der Anmeldung erhalten Sie per E-Mail Ihren persönlichen Link zum Raum.',
  },
  es: {
    subject: (t) => `Invitación: ${t}`,
    heading: 'Tienes una invitación a un evento',
    greeting: (n) => `Hola, ${n}:`,
    intro: (t, s) => `te invitamos a participar en «${t}», en ${s}.`,
    onlyInvited:
      'La inscripción está reservada a las personas invitadas: inscríbete con esta dirección de correo.',
    dateLabel: 'Fecha',
    timeLabel: 'Hora',
    cta: 'Inscribirse',
    after:
      'Tras la inscripción recibirás por correo tu enlace personal para entrar en la sala.',
  },
};

export interface InvitationEmailInput {
  locale: EmailLocale;
  name: string | null;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  registerUrl: string;
  siteName?: string;
  /** L'iscrizione e' riservata agli invitati: lo si dice. */
  onlyInvited: boolean;
}

export function invitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = COPY[input.locale];
  const site = input.siteName || 'PA Webinar';
  const greeting = input.name
    ? `<p style="margin:0 0 16px;">${escapeHtml(c.greeting(input.name))}</p>`
    : '';
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
  <h1 style="margin:0;font-size:24px;color:#17324d;">${escapeHtml(c.heading)}</h1>
</td></tr>
<tr><td style="padding:16px 24px 32px;font-size:16px;line-height:1.6;color:#33475b;">
${greeting}
<p style="margin:0 0 16px;">${escapeHtml(c.intro(input.eventTitle, site))}</p>
<p style="margin:0 0 8px;"><strong>${escapeHtml(c.dateLabel)}:</strong> ${escapeHtml(input.eventDate)}<br><strong>${escapeHtml(c.timeLabel)}:</strong> ${escapeHtml(input.eventTime)}</p>
${input.onlyInvited ? `<p style="margin:0 0 8px;">${escapeHtml(c.onlyInvited)}</p>` : ''}
<table role="presentation" style="margin:16px 0;"><tr><td>
<a href="${escapeHtml(input.registerUrl)}" style="display:inline-block;padding:12px 28px;background:#06c;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;">${escapeHtml(c.cta)}</a>
</td></tr></table>
<p style="margin:0;font-size:14px;color:#5c6f82;">${escapeHtml(c.after)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    c.heading,
    '',
    ...(input.name ? [c.greeting(input.name), ''] : []),
    c.intro(input.eventTitle, site),
    '',
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    ...(input.onlyInvited ? ['', c.onlyInvited] : []),
    '',
    `${c.cta}: ${input.registerUrl}`,
    '',
    c.after,
  ].join('\n');
  return { subject: c.subject(input.eventTitle), html, text };
}

/** Il token dell'invito: apre la pagina d'iscrizione gia' compilata. */
function nuovoToken(): string {
  return randomBytes(24).toString('base64url');
}

/** L'evento non accetta iscrizioni (bozza, concluso, chiamata rapida): gli
 *  inviti porterebbero a una pagina che non c'e'. */
export class InvitiNonInviabili extends Error {
  constructor() {
    super('Invitations are sent only while the event accepts registrations');
  }
}

/** Quanti inviti al massimo per richiesta: il resto con la successiva. */
export const INVITI_PER_RICHIESTA = 200;

/**
 * Manda l'invito agli invitati indicati (anche di nuovo), oppure, senza
 * `ids`, a quelli non ancora invitati e non iscritti, al massimo
 * INVITI_PER_RICHIESTA alla volta. Chi si e' gia' iscritto ha il suo link e
 * non riceve l'invito. Restituisce null se l'evento non esiste.
 *
 * Due richieste insieme (due schede, due repliche) non mandano due email: la
 * chiave della coda e' l'invito con il suo ultimo invio, e il token si scrive
 * solo se manca, poi si rilegge.
 */
export async function sendInvitations(
  eventId: string,
  opts: { ids?: string[]; locale: string }
): Promise<{ sent: number; skipped: number; remaining: number } | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      eventType: true,
      accessMode: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
    },
  });
  if (!event) return null;
  // La stessa regola della pagina d'iscrizione, a cui porta l'invito.
  if (!isEventOpenForRegistration(event)) throw new InvitiNonInviabili();

  const tutti = !opts.ids;
  const righe = await prisma.eventInvitation.findMany({
    where: { eventId, ...(tutti ? { sentAt: null } : { id: { in: opts.ids } }) },
    select: {
      id: true,
      name: true,
      email: true,
      emailHash: true,
      token: true,
      sentAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Chi si e' gia' iscritto ha il suo link: niente invito.
  const impronte = righe.map((r) => {
    if (r.emailHash) return r.emailHash;
    const indirizzo = tryDecryptPII(r.email)?.trim().toLowerCase();
    return indirizzo ? hashEmail(indirizzo) : null;
  });
  const daCercare = impronte.filter((h): h is string => !!h);
  const iscritte = new Set(
    daCercare.length > 0
      ? (
          await prisma.registration.findMany({
            where: { eventId, emailHash: { in: daCercare } },
            select: { emailHash: true },
          })
        ).map((r) => r.emailHash)
      : []
  );

  const settings = await getSettings();
  const onlyInvited = !publicRegistrationFor(event, settings.publicRegistrationEnabled);
  const pagina = linguaPagina(opts.locale) ?? defaultLocale;
  const testi = linguaEmail(pagina);
  const base = emailBaseUrl();
  const titolo = getLocalized(event.title as LocalizedField, pagina);

  let sent = 0;
  let skipped = 0;
  let trattati = 0;
  let remaining = 0;
  for (const [i, r] of righe.entries()) {
    const iscritto = iscritte.has(impronte[i] ?? '');
    // Invitando tutti, gli iscritti non sono «saltati»: non c'era niente da
    // mandare. Con un elenco esplicito si dice che non sono partiti.
    if (iscritto) {
      if (!tutti) skipped += 1;
      continue;
    }
    if (trattati >= INVITI_PER_RICHIESTA) {
      remaining += 1;
      continue;
    }
    trattati += 1;
    const to = tryDecryptPII(r.email)?.trim();
    if (!to) {
      skipped += 1;
      continue;
    }
    // Il token si scrive solo se manca, e si rilegge: con due richieste
    // insieme vince la prima, e l'email porta quello salvato.
    if (!r.token) {
      await prisma.eventInvitation.updateMany({
        where: { id: r.id, token: null },
        data: { token: nuovoToken() },
      });
    }
    const token =
      r.token ??
      (
        await prisma.eventInvitation.findUnique({
          where: { id: r.id },
          select: { token: true },
        })
      )?.token;
    if (!token) {
      skipped += 1;
      continue;
    }
    const mail = invitationEmail({
      locale: testi,
      name: tryDecryptPII(r.name),
      eventTitle: titolo,
      eventDate: formatDate(event.startsAt, testi, event.timezone),
      eventTime: formatTimeWithZone(event.startsAt, testi, event.timezone),
      registerUrl: localizedUrl(
        base,
        `/events/${event.slug}/registration?invito=${token}`,
        pagina
      ),
      siteName: settings.siteName || undefined,
      onlyInvited,
    });
    // Una sola email per invito e per giro: un secondo invio uguale nello
    // stesso istante trova la chiave gia' in coda.
    const accodata = await enqueueEmailOnce({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      metadata: { kind: 'event-invitation', eventId: event.id },
      dedupKey: `event-invitation:${r.id}:${r.sentAt?.toISOString() ?? 'primo'}`,
    });
    if (!accodata) {
      skipped += 1;
      continue;
    }
    // «Invitato» solo con l'email davvero in coda.
    await prisma.eventInvitation.update({
      where: { id: r.id },
      data: { sentAt: new Date() },
    });
    sent += 1;
  }
  return { sent, skipped, remaining };
}

/** L'invito di un token, per compilare il modulo d'iscrizione. */
export async function invitoDaToken(
  eventId: string,
  token: string | null | undefined
): Promise<{ name: string | null; email: string } | null> {
  if (!token || token.length > 64) return null;
  const r = await prisma.eventInvitation.findFirst({
    where: { eventId, token },
    select: { name: true, email: true },
  });
  const email = r ? tryDecryptPII(r.email)?.trim() : null;
  return r && email ? { name: tryDecryptPII(r.name), email } : null;
}
