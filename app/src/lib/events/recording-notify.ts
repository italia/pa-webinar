/**
 * L'avviso agli iscritti quando la registrazione di un evento concluso diventa
 * visibile sulla sua pagina pubblica.
 *
 * Si guarda lo stato, non l'azione che l'ha prodotto: la registrazione si
 * pubblica dalla pagina dell'evento, dalle Pubblicazioni o con un video
 * esterno, e conta solo che chi apre il link la trovi. Quindi: evento
 * concluso, avviso acceso, registrazione pubblicata (o video esterno), pagina
 * pubblica visibile, avviso non ancora partito.
 *
 * Gira con il cron dei promemoria. Come l'email dopo l'evento
 * (lib/events/post-event-finalize), l'evento si «prenota» con un updateMany
 * condizionato PRIMA di accodare le email: due giri sovrapposti non mandano
 * due avvisi. Gli iscritti sono quelli che la conservazione dei dati non ha
 * ancora cancellato: una registrazione pubblicata mesi dopo non avvisa nessuno.
 */

import { prisma } from '@/lib/db';
import { decryptPII } from '@/lib/crypto/pii';
import { enqueueEmail } from '@/lib/email/outbox';
import { lingueIscrizione } from '@/lib/email/lingua';
import { recordingPublishedEmail } from '@/lib/email/templates';
import { isEventPageVisible } from '@/lib/events/visibility';
import { rubricaOptOutUrl } from '@/lib/persons/opt-out-link';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';

export async function notifyPublishedRecordings(opts: {
  now: Date;
  baseUrl: string;
  siteName: string;
  defaultLocale?: string;
}): Promise<{ eventsNotified: number; emailsQueued: number; emailsFailed: number }> {
  const { now, baseUrl, siteName } = opts;

  const candidati = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      recordingNotifyEnabled: true,
      recordingNotifiedAt: null,
      eventType: { not: 'LEGACY' },
      OR: [
        { recordingPublished: true, recordingUrl: { not: null } },
        { youtubeUrl: { not: null } },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
    },
  });

  let eventsNotified = 0;
  let emailsQueued = 0;
  let emailsFailed = 0;

  for (const event of candidati) {
    // Il link porta alla pagina dell'evento: se non si vede, l'avviso aspetta
    // che chi organizza la renda pubblica.
    if (!isEventPageVisible(event, now.getTime())) continue;

    const prenotato = await prisma.event.updateMany({
      where: { id: event.id, recordingNotifiedAt: null },
      data: { recordingNotifiedAt: now },
    });
    if (prenotato.count === 0) continue;
    eventsNotified++;

    const iscrizioni = await prisma.registration.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        email: true,
        locale: true,
        person: { select: { id: true, optedInToAddressBook: true } },
      },
    });
    for (const reg of iscrizioni) {
      try {
        const { pagina, testi } = lingueIscrizione(reg.locale, opts.defaultLocale);
        const mail = recordingPublishedEmail({
          locale: testi,
          eventTitle: getLocalized(event.title as LocalizedField, pagina),
          eventPageUrl: localizedUrl(baseUrl, `/events/${event.slug}`, pagina),
          siteName,
          addressBookOptOutUrl: rubricaOptOutUrl(reg.person, baseUrl, pagina),
        });
        await enqueueEmail({
          to: decryptPII(reg.email),
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          metadata: { kind: 'recording_published', eventId: event.id, registrationId: reg.id },
        });
        emailsQueued++;
      } catch (err) {
        console.error(
          `[recording-notify] email failed (event ${event.id}, reg ${reg.id}):`,
          err,
        );
        emailsFailed++;
      }
    }
  }

  return { eventsNotified, emailsQueued, emailsFailed };
}
