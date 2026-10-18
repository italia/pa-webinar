/**
 * Il manifesto `tracks.json` di una registrazione multitraccia segue le sue
 * tracce: lo cancellano i due lavori che cancellano tracce (multitrack-purge e
 * postprod-retention) quando della registrazione non resta nessuna traccia con
 * l'audio presente. Contiene i nomi in chiaro e nessuno lo legge dopo il
 * caricamento.
 *
 * Best-effort: un errore resta un avviso nei log, e un manifesto che resta lo
 * trova la riconciliazione delle registrazioni, che lo vede orfano e lo
 * cancella allo scadere della tolleranza.
 */

import { prisma } from '@/lib/db';
import type { StorageProvider } from '@/lib/storage';

import { multitrackManifestKey } from './lifecycle';

/**
 * `registrazioni`: id della registrazione → id dell'evento. Restituisce
 * quanti manifesti sono stati davvero cancellati.
 */
export async function cancellaManifestiSenzaTracce(
  storage: Pick<StorageProvider, 'delete'>,
  registrazioni: Map<string, string>
): Promise<number> {
  if (registrazioni.size === 0) return 0;
  let cancellati = 0;
  try {
    const conTracce = await prisma.recordingTrack.groupBy({
      by: ['recordingId'],
      where: { recordingId: { in: [...registrazioni.keys()] }, audioPurgedAt: null },
    });
    const restano = new Set(conTracce.map((r) => r.recordingId));
    for (const [recordingId, eventId] of registrazioni) {
      if (restano.has(recordingId)) continue;
      try {
        if (await storage.delete(multitrackManifestKey(eventId, recordingId)))
          cancellati += 1;
      } catch (err) {
        console.warn('[recorder/manifest] manifest delete failed', {
          recordingId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    console.warn('[recorder/manifest] track lookup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return cancellati;
}
