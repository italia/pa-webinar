/**
 * Le notifiche di Prosody al portale (mod_pa_occupants) sono firmate con il
 * segreto dei token della conferenza (JITSI_JWT_SECRET, in Prosody
 * JWT_APP_SECRET), che i due condividono già: nessuna chiave in più da
 * distribuire a Prosody.
 *
 * La firma e' l'HMAC-SHA256 esadecimale del corpo, con una chiave derivata dal
 * segreto (HMAC del segreto sull'etichetta qui sotto): una firma non vale come
 * token della conferenza ne' il contrario. Il corpo porta l'ora di invio
 * (`ts`, secondi): una notifica fuori dalla finestra si rifiuta, perche' una
 * copia intercettata non si possa rigiocare a lungo.
 */
import { createHmac } from 'node:crypto';

import { constantTimeEqual } from './moderator';

const ETICHETTA = 'pa-occupants';
/** Quanto puo' essere vecchia (o avanti) una notifica, in secondi. */
export const FINESTRA_SECONDI = 300;

export function firmaProsody(corpo: string, segreto: string): string {
  const chiave = createHmac('sha256', segreto).update(ETICHETTA).digest();
  return createHmac('sha256', chiave).update(corpo).digest('hex');
}

/**
 * Vera se la firma e' del corpo, con il segreto della conferenza, e l'ora e'
 * nella finestra. Falsa senza segreto configurato.
 */
export function verificaFirmaProsody(
  corpo: string,
  firma: string | null,
  ts: number | undefined,
  adessoMs: number = Date.now(),
): boolean {
  const segreto = process.env.JITSI_JWT_SECRET;
  if (!segreto || !firma || typeof ts !== 'number') return false;
  if (Math.abs(adessoMs / 1000 - ts) > FINESTRA_SECONDI) return false;
  return constantTimeEqual(firma.toLowerCase(), firmaProsody(corpo, segreto));
}
