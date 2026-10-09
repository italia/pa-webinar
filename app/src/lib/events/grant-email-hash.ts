import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

/**
 * Completa l'impronta dell'indirizzo sulle concessioni nate prima che
 * esistesse: serve all'export e alla cancellazione GDPR in autonomia, che
 * cercano per impronta. La pulizia giornaliera la chiama finché non resta
 * niente da fare.
 *
 * Solo sulle concessioni senza il segno di organizzatore: su quelle,
 * l'impronta dà la gestione dell'evento all'account dello staff con lo
 * stesso indirizzo, e la si scrive solo dove un responsabile lo decide
 * (PATCH con il controllo di lib/auth/organizer-mark).
 *
 * Scorre le righe in ordine e va oltre quelle che non si leggono (chiave
 * cambiata, indirizzo vuoto): restano senza impronta ma non fermano le altre.
 */
export async function completaImprontaConcessioni(
  limite = 500,
  massimoDaLeggere = 5000,
): Promise<number> {
  let scritte = 0;
  let lette = 0;
  let dopo: string | undefined;
  while (scritte < limite && lette < massimoDaLeggere) {
    const righe = await prisma.eventModerator.findMany({
      where: {
        emailHash: null,
        email: { not: null },
        organizer: false,
        ...(dopo && { id: { gt: dopo } }),
      },
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
    if (righe.length === 0) break;
    for (const r of righe) {
      lette += 1;
      dopo = r.id;
      let email: string | null = null;
      try {
        email = tryDecryptPII(r.email);
      } catch {
        continue;
      }
      if (!email || !email.includes('@')) continue;
      await prisma.eventModerator.update({
        where: { id: r.id },
        data: { emailHash: hashEmail(email) },
      });
      scritte += 1;
      if (scritte >= limite) break;
    }
  }
  return scritte;
}
