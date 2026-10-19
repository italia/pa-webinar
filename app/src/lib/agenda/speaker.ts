/**
 * Chi interviene su un argomento dell'agenda: una persona dell'evento (la sua
 * concessione, `speakerGrantId`) oppure l'organizzatore principale
 * (`speakerPrimary`), mai tutti e due. Le rotte che scrivono l'agenda lo
 * controllano qui, una volta sola.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

/** I due campi, facoltativi: assenti = nessuno. */
export const agendaSpeakerSchema = z.object({
  speakerGrantId: z.string().uuid().nullable().optional(),
  speakerPrimary: z.boolean().optional(),
});

export interface ProblemaRelatore {
  path: (string | number)[];
  message: string;
}

/**
 * I problemi di chi interviene, per ogni argomento: tutti e due i campi
 * insieme, o una concessione che non e' di questo evento o e' stata revocata
 * (solo con `controllaPersone`). `percorso` dice dove sta il campo nel corpo
 * della richiesta.
 */
export async function verificaRelatori(
  db: Prisma.TransactionClient | PrismaClient,
  eventId: string,
  voci: ReadonlyArray<{ speakerGrantId?: string | null; speakerPrimary?: boolean }>,
  percorso: (indice: number, campo: string) => (string | number)[],
  controllaPersone = true
): Promise<ProblemaRelatore[]> {
  const problemi: ProblemaRelatore[] = [];
  voci.forEach((v, i) => {
    if (v.speakerGrantId && v.speakerPrimary) {
      problemi.push({
        path: percorso(i, 'speakerPrimary'),
        message: 'An agenda item has one speaker: a person or the lead organizer',
      });
    }
  });
  const richiesti = [
    ...new Set(voci.map((v) => v.speakerGrantId).filter((id): id is string => !!id)),
  ];
  if (!controllaPersone || richiesti.length === 0) return problemi;
  const validi = await db.eventModerator.findMany({
    where: { id: { in: richiesti }, eventId, revokedAt: null },
    select: { id: true },
  });
  const ok = new Set(validi.map((g) => g.id));
  voci.forEach((v, i) => {
    if (v.speakerGrantId && !ok.has(v.speakerGrantId)) {
      problemi.push({
        path: percorso(i, 'speakerGrantId'),
        message: 'The speaker is not a person of this event',
      });
    }
  });
  return problemi;
}
