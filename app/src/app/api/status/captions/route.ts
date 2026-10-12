/**
 * GET /api/status/captions
 *
 * Lo stato dei sottotitoli live per la sala: dice a chi guarda se tacciono
 * perché il servizio si è sospeso per sovraccarico o non risponde. Solo lo
 * stato, nessun dettaglio d'infrastruttura: la sala lo chiede anche con la
 * pagina di stato spenta. La risposta resta in memoria qualche secondo,
 * perché la interrogano tutti i partecipanti.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { getSettings } from '@/lib/settings';
import { getCaptionsStatus } from '@/lib/status/captions';
import { cachedProbe } from '@/lib/status/probes';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => {
  const { state } = await cachedProbe(
    'captions-room-status',
    async () => getCaptionsStatus(await getSettings()),
    10_000,
  );
  return Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } });
});
