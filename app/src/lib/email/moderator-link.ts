/**
 * Email con il link personale di chi conduce un evento.
 *
 * Tre destinatari, tre testi:
 *   - il moderatore principale (`Event.moderatorEmail`): il link di gestione
 *     dell'evento e quello della sala, entrambi con il token primario;
 *   - un co-moderatore (`EventModerator`, ruolo MODERATOR): il link della
 *     sala con il token della sua concessione;
 *   - un relatore (`EventModerator`, ruolo SPEAKER): lo stesso, con un testo
 *     che non promette poteri di moderazione che non ha.
 *
 * Il link e' una credenziale durevole (il token primario non scade): non
 * finisce mai nei log, nemmeno negli errori, e l'oggetto dell'email (salvato
 * in chiaro nella coda) non lo contiene. Il corpo nella coda e' cifrato.
 *
 * Una sola email per concessione. Il moderatore principale riceve il link
 * alla creazione e alla pubblicazione, ma la seconda volta trova nella coda
 * la riga della prima (stessa chiave: evento + hash dell'indirizzo) e non
 * spedisce: ripubblicare o risalvare l'evento non moltiplica le email, mentre
 * un indirizzo cambiato riceve il suo link. Le concessioni nascono una volta
 * sola (POST /moderators), quindi partono alla creazione.
 */

import { defaultLocale, locales } from '@/i18n/config';
import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { linguaEmail, linguaPagina, type EmailLocale } from '@/lib/email/lingua';
import { emailBaseUrl } from '@/lib/email/links';
import { enqueueEmailOnce } from '@/lib/email/outbox';
import { escapeHtml } from '@/lib/email/templates';
import { getSettings } from '@/lib/settings';
import { formatDate, formatTime } from '@/lib/utils/date-format';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';

export type ModeratorLinkRole = 'PRIMARY' | 'MODERATOR' | 'SPEAKER';

interface RoleCopy {
  subject: (title: string) => string;
  heading: string;
  intro: (title: string) => string;
  cta: string;
}

interface ModeratorLinkCopy {
  roles: Record<ModeratorLinkRole, RoleCopy>;
  greeting: (name: string) => string;
  manageCta: string;
  dateLabel: string;
  timeLabel: string;
  /** La riga obbligatoria: il link e' personale e non va condiviso. */
  personalPrimary: string;
  personalGrant: string;
}

const COPY: Record<EmailLocale, ModeratorLinkCopy> = {
  it: {
    roles: {
      PRIMARY: {
        subject: (t) => `Il tuo link da moderatore: ${t}`,
        heading: 'Sei il moderatore dell’evento',
        intro: (t) =>
          `Sei il moderatore principale di «${t}». Con i link qui sotto gestisci l’evento e, durante la diretta, avvii la registrazione, moderi le domande e lanci i sondaggi.`,
        cta: 'Entra in sala come moderatore',
      },
      MODERATOR: {
        subject: (t) => `Sei co-moderatore: ${t}`,
        heading: 'Sei co-moderatore dell’evento',
        intro: (t) =>
          `Sei stato aggiunto come co-moderatore di «${t}». Con il link qui sotto entri in sala con gli strumenti di moderazione.`,
        cta: 'Entra in sala come co-moderatore',
      },
      SPEAKER: {
        subject: (t) => `Sei relatore: ${t}`,
        heading: 'Sei relatore dell’evento',
        intro: (t) =>
          `Sei stato aggiunto come relatore di «${t}». Con il link qui sotto entri in sala con microfono, videocamera e condivisione dello schermo.`,
        cta: 'Entra in sala come relatore',
      },
    },
    greeting: (n) => `Ciao ${n},`,
    manageCta: 'Gestisci l’evento',
    dateLabel: 'Data',
    timeLabel: 'Ora',
    personalPrimary:
      'Questo link è personale e non scade: non inoltrarlo, non incollarlo in chat e non mostrarlo mentre condividi lo schermo. Chi lo possiede può gestire l’evento.',
    personalGrant:
      'Questo link è personale: non inoltrarlo, non incollarlo in chat e non mostrarlo mentre condividi lo schermo. Chi lo possiede entra in sala al tuo posto.',
  },
  en: {
    roles: {
      PRIMARY: {
        subject: (t) => `Your moderator link: ${t}`,
        heading: 'You are the event moderator',
        intro: (t) =>
          `You are the main moderator of “${t}”. With the links below you manage the event and, during the live session, start the recording, moderate questions and launch polls.`,
        cta: 'Join the room as moderator',
      },
      MODERATOR: {
        subject: (t) => `You are a co-moderator: ${t}`,
        heading: 'You are a co-moderator of the event',
        intro: (t) =>
          `You have been added as a co-moderator of “${t}”. The link below takes you into the room with the moderation tools.`,
        cta: 'Join the room as co-moderator',
      },
      SPEAKER: {
        subject: (t) => `You are a speaker: ${t}`,
        heading: 'You are a speaker at the event',
        intro: (t) =>
          `You have been added as a speaker at “${t}”. The link below takes you into the room with microphone, camera and screen sharing.`,
        cta: 'Join the room as speaker',
      },
    },
    greeting: (n) => `Hello ${n},`,
    manageCta: 'Manage the event',
    dateLabel: 'Date',
    timeLabel: 'Time',
    personalPrimary:
      'This link is personal and does not expire: do not forward it, do not paste it in a chat and do not show it while sharing your screen. Whoever has it can manage the event.',
    personalGrant:
      'This link is personal: do not forward it, do not paste it in a chat and do not show it while sharing your screen. Whoever has it joins the room in your place.',
  },
  fr: {
    roles: {
      PRIMARY: {
        subject: (t) => `Votre lien de modérateur : ${t}`,
        heading: 'Vous êtes le modérateur de l’événement',
        intro: (t) =>
          `Vous êtes le modérateur principal de « ${t} ». Avec les liens ci-dessous, vous gérez l’événement et, pendant le direct, vous lancez l’enregistrement, modérez les questions et lancez les sondages.`,
        cta: 'Entrer dans la salle en tant que modérateur',
      },
      MODERATOR: {
        subject: (t) => `Vous êtes co-modérateur : ${t}`,
        heading: 'Vous êtes co-modérateur de l’événement',
        intro: (t) =>
          `Vous avez été ajouté comme co-modérateur de « ${t} ». Le lien ci-dessous vous fait entrer dans la salle avec les outils de modération.`,
        cta: 'Entrer dans la salle en tant que co-modérateur',
      },
      SPEAKER: {
        subject: (t) => `Vous êtes intervenant : ${t}`,
        heading: 'Vous êtes intervenant de l’événement',
        intro: (t) =>
          `Vous avez été ajouté comme intervenant de « ${t} ». Le lien ci-dessous vous fait entrer dans la salle avec micro, caméra et partage d’écran.`,
        cta: 'Entrer dans la salle en tant qu’intervenant',
      },
    },
    greeting: (n) => `Bonjour ${n},`,
    manageCta: 'Gérer l’événement',
    dateLabel: 'Date',
    timeLabel: 'Heure',
    personalPrimary:
      'Ce lien est personnel et n’expire pas : ne le transférez pas, ne le collez pas dans une discussion et ne le montrez pas pendant un partage d’écran. Toute personne qui le possède peut gérer l’événement.',
    personalGrant:
      'Ce lien est personnel : ne le transférez pas, ne le collez pas dans une discussion et ne le montrez pas pendant un partage d’écran. Toute personne qui le possède entre dans la salle à votre place.',
  },
  de: {
    roles: {
      PRIMARY: {
        subject: (t) => `Ihr Moderationslink: ${t}`,
        heading: 'Sie moderieren die Veranstaltung',
        intro: (t) =>
          `Sie sind die Hauptmoderation von „${t}“. Mit den folgenden Links verwalten Sie die Veranstaltung und starten während der Live-Sitzung die Aufzeichnung, moderieren Fragen und starten Umfragen.`,
        cta: 'Den Raum als Moderation betreten',
      },
      MODERATOR: {
        subject: (t) => `Sie sind Ko-Moderation: ${t}`,
        heading: 'Sie sind Ko-Moderation der Veranstaltung',
        intro: (t) =>
          `Sie wurden als Ko-Moderation von „${t}“ hinzugefügt. Über den folgenden Link betreten Sie den Raum mit den Moderationswerkzeugen.`,
        cta: 'Den Raum als Ko-Moderation betreten',
      },
      SPEAKER: {
        subject: (t) => `Sie sind Vortragende/r: ${t}`,
        heading: 'Sie sind Vortragende/r der Veranstaltung',
        intro: (t) =>
          `Sie wurden als Vortragende/r von „${t}“ hinzugefügt. Über den folgenden Link betreten Sie den Raum mit Mikrofon, Kamera und Bildschirmfreigabe.`,
        cta: 'Den Raum als Vortragende/r betreten',
      },
    },
    greeting: (n) => `Guten Tag ${n},`,
    manageCta: 'Veranstaltung verwalten',
    dateLabel: 'Datum',
    timeLabel: 'Uhrzeit',
    personalPrimary:
      'Dieser Link ist persönlich und läuft nicht ab: Leiten Sie ihn nicht weiter, fügen Sie ihn nicht in einen Chat ein und zeigen Sie ihn nicht bei einer Bildschirmfreigabe. Wer ihn besitzt, kann die Veranstaltung verwalten.',
    personalGrant:
      'Dieser Link ist persönlich: Leiten Sie ihn nicht weiter, fügen Sie ihn nicht in einen Chat ein und zeigen Sie ihn nicht bei einer Bildschirmfreigabe. Wer ihn besitzt, betritt den Raum an Ihrer Stelle.',
  },
  es: {
    roles: {
      PRIMARY: {
        subject: (t) => `Su enlace de moderador: ${t}`,
        heading: 'Es el moderador del evento',
        intro: (t) =>
          `Es el moderador principal de «${t}». Con los enlaces que figuran a continuación gestiona el evento y, durante la sesión en directo, inicia la grabación, modera las preguntas y lanza las encuestas.`,
        cta: 'Entrar en la sala como moderador',
      },
      MODERATOR: {
        subject: (t) => `Es comoderador: ${t}`,
        heading: 'Es comoderador del evento',
        intro: (t) =>
          `Se le ha añadido como comoderador de «${t}». Con el enlace que figura a continuación entra en la sala con las herramientas de moderación.`,
        cta: 'Entrar en la sala como comoderador',
      },
      SPEAKER: {
        subject: (t) => `Es ponente: ${t}`,
        heading: 'Es ponente del evento',
        intro: (t) =>
          `Se le ha añadido como ponente de «${t}». Con el enlace que figura a continuación entra en la sala con micrófono, cámara y uso compartido de pantalla.`,
        cta: 'Entrar en la sala como ponente',
      },
    },
    greeting: (n) => `Hola, ${n}:`,
    manageCta: 'Gestionar el evento',
    dateLabel: 'Fecha',
    timeLabel: 'Hora',
    personalPrimary:
      'Este enlace es personal y no caduca: no lo reenvíe, no lo pegue en un chat y no lo muestre mientras comparte la pantalla. Quien lo tenga puede gestionar el evento.',
    personalGrant:
      'Este enlace es personal: no lo reenvíe, no lo pegue en un chat y no lo muestre mientras comparte la pantalla. Quien lo tenga entra en la sala en su lugar.',
  },
};

export interface ModeratorLinkEmailInput {
  locale: EmailLocale;
  role: ModeratorLinkRole;
  name: string | null;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  /** La sala, con il token della persona. */
  liveUrl: string;
  /** La gestione dell'evento: solo per il moderatore principale. */
  manageUrl?: string | null;
  siteName?: string;
}

function button(label: string, url: string, primary: boolean): string {
  const style = primary
    ? 'display:inline-block;padding:12px 28px;background:#06c;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;'
    : 'display:inline-block;padding:11px 27px;background:#fff;color:#06c;border:1px solid #06c;text-decoration:none;border-radius:4px;font-weight:600;font-size:16px;';
  return `<table role="presentation" style="margin:16px 0;"><tr><td>
<a href="${escapeHtml(url)}" style="${style}">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export function moderatorLinkEmail(input: ModeratorLinkEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = COPY[input.locale];
  const r = c.roles[input.role];
  const site = input.siteName || 'PA Webinar';
  const personal = input.role === 'PRIMARY' ? c.personalPrimary : c.personalGrant;
  const manage = input.role === 'PRIMARY' ? input.manageUrl ?? null : null;

  const greeting = input.name ? `<p style="margin:0 0 16px;">${escapeHtml(c.greeting(input.name))}</p>` : '';
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
${greeting}
<p style="margin:0 0 16px;">${escapeHtml(r.intro(input.eventTitle))}</p>
<p style="margin:0 0 8px;"><strong>${escapeHtml(c.dateLabel)}:</strong> ${escapeHtml(input.eventDate)}<br><strong>${escapeHtml(c.timeLabel)}:</strong> ${escapeHtml(input.eventTime)}</p>
${manage ? button(c.manageCta, manage, true) : ''}
${button(r.cta, input.liveUrl, !manage)}
<p style="margin:16px 0 0;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:2px;font-size:14px;color:#664d03;">${escapeHtml(personal)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    r.heading,
    '',
    ...(input.name ? [c.greeting(input.name), ''] : []),
    r.intro(input.eventTitle),
    '',
    `${c.dateLabel}: ${input.eventDate}`,
    `${c.timeLabel}: ${input.eventTime}`,
    '',
    ...(manage ? [`${c.manageCta}: ${manage}`] : []),
    `${r.cta}: ${input.liveUrl}`,
    '',
    personal,
  ].join('\n');

  // L'oggetto resta in chiaro nella coda: mai il link, solo il titolo.
  return { subject: r.subject(input.eventTitle), html, text };
}

/**
 * La lingua dell'interfaccia di amministrazione da cui arriva la richiesta.
 *
 * `?locale=`, poi la pagina da cui parte la chiamata (il primo segmento del
 * Referer: il wizard e il pannello chiamano da `/<lingua>/admin/...`), poi la
 * lingua predefinita dell'istanza. Non `Accept-Language`: e' la lingua del
 * browser, non quella che chi amministra ha scelto.
 */
export function adminRequestLocale(request: Request, predefinita?: string | null): string {
  const url = new URL(request.url);
  const param = linguaPagina(url.searchParams.get('locale'));
  if (param) return param;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const segment = new URL(referer).pathname.split('/')[1] ?? '';
      if ((locales as readonly string[]).includes(segment)) return segment;
    } catch {
      // Referer malformato: si ricade sulla lingua dell'istanza.
    }
  }
  return linguaPagina(predefinita) ?? defaultLocale;
}

/** Stati in cui un link di conduzione non serve piu'. */
const CLOSED_STATUSES = new Set(['ENDED', 'ARCHIVED']);

function dedupKeyPrimary(eventId: string, email: string): string {
  return `moderator-link:${eventId}:primary:${hashEmail(email)}`;
}

async function alreadyQueued(dedupKey: string): Promise<boolean> {
  const row = await prisma.emailOutbox.findUnique({
    where: { dedupKey },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Accoda il link del moderatore principale, se l'evento ha un indirizzo e il
 * link non e' gia' partito per quell'indirizzo. Non lancia mai: e' un effetto
 * collaterale della creazione o della pubblicazione, che non deve fallire per
 * questo. Restituisce true se ha accodato.
 */
export async function sendPrimaryModeratorLink(
  eventId: string,
  opts: { locale: string },
): Promise<boolean> {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        startsAt: true,
        timezone: true,
        moderatorToken: true,
        moderatorName: true,
        moderatorEmail: true,
      },
    });
    if (!event || CLOSED_STATUSES.has(event.status)) return false;
    const to = tryDecryptPII(event.moderatorEmail)?.trim();
    if (!to) return false;

    const dedupKey = dedupKeyPrimary(event.id, to);
    if (await alreadyQueued(dedupKey)) return false;

    const settings = await getSettings();
    const pagina = linguaPagina(opts.locale) ?? defaultLocale;
    const testi = linguaEmail(pagina);
    const base = emailBaseUrl();
    const token = encodeURIComponent(event.moderatorToken);
    const mail = moderatorLinkEmail({
      locale: testi,
      role: 'PRIMARY',
      name: event.moderatorName,
      eventTitle: getLocalized(event.title as LocalizedField, pagina),
      eventDate: formatDate(event.startsAt, testi, event.timezone),
      eventTime: formatTime(event.startsAt, testi, event.timezone),
      liveUrl: localizedUrl(base, `/events/${event.slug}/live?token=${token}`, pagina),
      manageUrl: localizedUrl(base, `/admin/events/${event.id}?token=${token}`, pagina),
      siteName: settings.siteName || undefined,
    });
    // La lettura sopra evita di comporre l'email per niente; la garanzia è
    // l'indice unico: due richieste concorrenti ne accodano una sola.
    return await enqueueEmailOnce({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      metadata: { kind: 'moderator-link', role: 'PRIMARY', eventId: event.id },
      dedupKey,
    });
  } catch (err) {
    // Mai l'errore intero: potrebbe riportare i dati della chiamata, e con
    // loro il link. Basta il tipo per la diagnosi.
    console.error('[email] moderator link not queued', {
      eventId,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return false;
  }
}

/**
 * Accoda il link di una concessione nominale (co-moderatore o relatore) appena
 * creata. Solo se la concessione ha un indirizzo e non e' revocata. Non lancia.
 */
export async function sendGrantModeratorLink(
  grantId: string,
  opts: { locale: string },
): Promise<boolean> {
  try {
    const grant = await prisma.eventModerator.findUnique({
      where: { id: grantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        token: true,
        revokedAt: true,
        event: {
          select: { id: true, slug: true, title: true, status: true, startsAt: true, timezone: true },
        },
      },
    });
    if (!grant || grant.revokedAt || CLOSED_STATUSES.has(grant.event.status)) return false;
    const to = tryDecryptPII(grant.email)?.trim();
    if (!to) return false;

    const settings = await getSettings();
    const pagina = linguaPagina(opts.locale) ?? defaultLocale;
    const testi = linguaEmail(pagina);
    const event = grant.event;
    const role: ModeratorLinkRole = grant.role === 'SPEAKER' ? 'SPEAKER' : 'MODERATOR';
    const mail = moderatorLinkEmail({
      locale: testi,
      role,
      name: tryDecryptPII(grant.name) ?? grant.name,
      eventTitle: getLocalized(event.title as LocalizedField, pagina),
      eventDate: formatDate(event.startsAt, testi, event.timezone),
      eventTime: formatTime(event.startsAt, testi, event.timezone),
      liveUrl: localizedUrl(
        emailBaseUrl(),
        `/events/${event.slug}/live?token=${encodeURIComponent(grant.token)}`,
        pagina,
      ),
      siteName: settings.siteName || undefined,
    });
    return await enqueueEmailOnce({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      metadata: { kind: 'moderator-link', role, eventId: event.id, grantId: grant.id },
      dedupKey: `moderator-link:${event.id}:grant:${grant.id}`,
    });
  } catch (err) {
    console.error('[email] moderator link not queued', {
      grantId,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return false;
  }
}
