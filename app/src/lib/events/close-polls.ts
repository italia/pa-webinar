import type { Prisma } from '@prisma/client';

import { deleteCacheByPrefix } from '@/lib/cache';

/**
 * A evento concluso o archiviato i sondaggi rimasti aperti si chiudono: la
 * sala non c'e' piu', e un sondaggio aperto accetterebbe voti da chiunque
 * abbia ancora la pagina. Si chiama nella stessa transazione che cambia lo
 * stato dell'evento. I risultati restano come li ha decisi chi modera: chiuso
 * non vuol dire pubblicato.
 */
export async function chiudiSondaggiAperti(
  tx: Prisma.TransactionClient,
  eventIds: string[],
  now: Date,
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const r = await tx.poll.updateMany({
    where: { eventId: { in: eventIds }, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: now },
  });
  // La lettura pubblica dei sondaggi tiene una copia per pochi secondi: la si
  // butta, cosi' nessuno vede ancora aperto un sondaggio chiuso. Il pannello
  // della sala non va avvisato: con la fine dell'evento la sala si chiude.
  if (r.count > 0) for (const id of eventIds) deleteCacheByPrefix(`polls:${id}`);
  return r.count;
}
