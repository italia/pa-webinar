/**
 * GET /api/internal/recorder-desired  (ADR-013 Fase 3)
 *
 * Stato *desiderato* per l'operator recorder: gli eventi LIVE che devono
 * avere un recorder multi-traccia attivo. Per ciascuno garantisce (early)
 * la riga Recording multitraccia e ne ritorna l'id — l'operator non tocca
 * il DB, fa solo il diff col mondo reale (Job/container) e crea i mancanti.
 *
 * Gate: `status=LIVE` + `recordingEnabled` + `aiTranscriptEnabled` +
 * **`multitrackRecordingEnabled`** (opt-in esplicito dell'admin — ADR-013
 * Fase 5 GDPR: l'audio isolato per-partecipante è PII ad alta sensibilità e
 * NON va attivato automaticamente con la sola trascrizione). Il consenso del
 * partecipante è quello di registrazione, con disclosure potenziata.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { ensureMultitrackRecording } from '@/lib/recorder/lifecycle';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const events = await prisma.event.findMany({
    where: {
      status: 'LIVE',
      recordingEnabled: true,
      aiTranscriptEnabled: true,
      multitrackRecordingEnabled: true,
    },
    select: { id: true, jitsiRoomName: true, startsAt: true },
  });

  const recorders: Array<{ recordingId: string; eventId: string }> = [];
  for (const ev of events) {
    const { recordingId } = await prisma.$transaction((tx) =>
      ensureMultitrackRecording(tx, ev),
    );
    recorders.push({ recordingId, eventId: ev.id });
  }

  return Response.json({ recorders });
});
