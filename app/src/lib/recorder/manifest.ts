/**
 * Il manifesto `tracks.json` di una registrazione multitraccia segue le sue
 * tracce: va via con l'ultima. Lo cancellano i due lavori che cancellano
 * tracce, sempre da qui: multitrack-purge, che segna le tracce e ne lascia le
 * righe, quando della registrazione non resta nessuna traccia con l'audio
 * presente; postprod-retention, che cancella righe e manifesto insieme.
 * Contiene i nomi in chiaro e nessuno lo legge dopo il caricamento.
 *
 * Best-effort: un errore è un avviso nei log e un fallimento contato da chi
 * chiama. Un manifesto che resta lo trova la riconciliazione delle
 * registrazioni, che lo vede orfano e lo cancella allo scadere della
 * tolleranza.
 */

import { prisma } from '@/lib/db';
import type { StorageProvider } from '@/lib/storage';

import { multitrackManifestKey } from './lifecycle';

type Storage = Pick<StorageProvider, 'delete'>;

export type EsitoManifesto = 'cancellato' | 'assente' | 'fallito';

/**
 * Cancella il manifesto di una registrazione. Non lancia: per una
 * registrazione che non è multitraccia la chiave non esiste ('assente').
 * L'esito è quello del provider: con S3 una chiave assente risulta
 * cancellata, e un errore risulta assente (il provider lo scrive nei log).
 */
export async function cancellaManifesto(
  storage: Storage,
  eventId: string,
  recordingId: string
): Promise<EsitoManifesto> {
  try {
    return (await storage.delete(multitrackManifestKey(eventId, recordingId)))
      ? 'cancellato'
      : 'assente';
  } catch (err) {
    console.warn('[recorder/manifest] manifest delete failed', {
      recordingId,
      err: err instanceof Error ? err.message : String(err),
    });
    return 'fallito';
  }
}

/**
 * `registrazioni`: id della registrazione → id dell'evento. Cancella il
 * manifesto di quelle che non hanno più tracce con l'audio presente.
 */
export async function cancellaManifestiSenzaTracce(
  storage: Storage,
  registrazioni: Map<string, string>
): Promise<{ cancellati: number; falliti: number }> {
  if (registrazioni.size === 0) return { cancellati: 0, falliti: 0 };
  let restano: Set<string>;
  try {
    const conTracce = await prisma.recordingTrack.groupBy({
      by: ['recordingId'],
      where: { recordingId: { in: [...registrazioni.keys()] }, audioPurgedAt: null },
    });
    restano = new Set(conTracce.map((r) => r.recordingId));
  } catch (err) {
    console.warn('[recorder/manifest] track lookup failed', {
      recordingIds: [...registrazioni.keys()],
      err: err instanceof Error ? err.message : String(err),
    });
    // Quali manifesti andavano cancellati non si sa: un fallimento solo.
    return { cancellati: 0, falliti: 1 };
  }
  let cancellati = 0;
  let falliti = 0;
  for (const [recordingId, eventId] of registrazioni) {
    if (restano.has(recordingId)) continue;
    const esito = await cancellaManifesto(storage, eventId, recordingId);
    if (esito === 'cancellato') cancellati += 1;
    if (esito === 'fallito') falliti += 1;
  }
  return { cancellati, falliti };
}
