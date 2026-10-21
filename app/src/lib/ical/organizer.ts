/**
 * Il nome dell'organizzatore nelle voci di calendario (.ics e allegati delle
 * email): il primo ente che organizza l'evento, altrimenti l'ente
 * dell'installazione, altrimenti il nome del sito. Mai il moderatore
 * principale: il file del calendario si scarica dalla pagina pubblica, e il
 * nome di chi conduce va in pubblico solo se lo si sceglie fra le persone
 * dell'evento.
 */
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';

const RIPIEGO = 'PA Webinar';

export function sceltaOrganizzatore(
  ente: string | null | undefined,
  sito: { organizationName?: string | null; siteName?: string | null }
): string {
  return (
    ente?.trim() || sito.organizationName?.trim() || sito.siteName?.trim() || RIPIEGO
  );
}

export async function nomeOrganizzatoreCalendario(eventId: string): Promise<string> {
  const [ente, sito] = await Promise.all([
    prisma.eventOrganizer.findFirst({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    }),
    getSettings(),
  ]);
  return sceltaOrganizzatore(ente?.name, sito);
}
