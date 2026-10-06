/**
 * Il questionario di valutazione predefinito di un evento (POST_EVENT, dal
 * modello di sistema «Feedback generico»): lo riceve alla creazione ogni
 * evento, chiamate rapide comprese, se la raccolta e' accesa. Chi organizza
 * puo' cambiarlo o toglierlo: una lettura non lo rimette mai.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import { FEEDBACK_GENERIC_TEMPLATE_NAME } from './constants';

/**
 * Collega il questionario predefinito all'evento, se non ne ha gia' uno di
 * valutazione. Vero se ora c'e' (creato qui o gia' presente); falso se il
 * modello di sistema manca. Sicuro in parallelo: la chiave (evento,
 * collocazione) e' unica, e chi arriva secondo trova quello del primo.
 */
export async function ensurePostEventQuestionnaire(eventId: string): Promise<boolean> {
  const esistente = await prisma.eventQuestionnaire.findUnique({
    where: { eventId_placement: { eventId, placement: 'POST_EVENT' } },
    select: { id: true },
  });
  if (esistente) return true;
  const generico = await prisma.questionTemplate.findUnique({
    where: { name: FEEDBACK_GENERIC_TEMPLATE_NAME },
    select: { id: true },
  });
  if (!generico) return false;
  try {
    await prisma.eventQuestionnaire.create({
      data: {
        eventId,
        placement: 'POST_EVENT',
        title: { it: 'Il tuo feedback', en: 'Your feedback' },
        templates: { create: [{ templateId: generico.id, sortOrder: 0 }] },
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
  return true;
}

/** Quando la valutazione di fine evento si puo' vedere e inviare: raccolta
 *  accesa, evento in corso (anche con la sala ferma per inattivita') o
 *  concluso. Mai prima dell'inizio, mai da archiviato. */
export function feedbackOpen(event: { feedbackEnabled: boolean; status: string }): boolean {
  return event.feedbackEnabled && (event.status === 'LIVE' || event.status === 'IDLE' || event.status === 'ENDED');
}
