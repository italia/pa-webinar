import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { scalerDriverActive } from '@/lib/events/lifecycle-driver';
import {
  dispatchRecorder,
  lifecycleWindows,
  probeBridge,
  runLifecycleTick,
} from '@/lib/events/lifecycle-tick';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/lifecycle
 *
 * Il giro del ciclo di vita a bridge fisso, ogni minuto: apre le sale
 * all'orario d'inizio, le chiude alla fine della grace (o, se sono a tempo
 * indefinito, dopo la finestra di inattività), chiude le chiamate istantanee
 * abbandonate e le sessioni di chiamata di ogni evento che lascia LIVE. Le
 * regole sono in lib/events/lifecycle-tick (modo 'fixed').
 *
 * Quando lo scaler dei bridge conduce il ciclo di vita (il suo battito è
 * fresco, lib/events/lifecycle-driver) non fa nulla: i due conduttori non
 * devono mai lavorare insieme, perché lo scaler scalda e mette in pausa le
 * sale attorno all'accensione dei bridge.
 *
 * Protetto da CRON_API_KEY. Lo chiamano il CronJob del chart quando lo scaler
 * non è installato e il ciclo cron di Docker Compose.
 */
export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  if (await scalerDriverActive()) {
    return Response.json({ skipped: 'scaler' });
  }

  const now = new Date();
  const settings = await getSettings();
  const windows = lifecycleWindows(settings);

  // Con JVB_HEALTH_URL la sala si apre solo se il bridge risponde; senza
  // (un Jitsi esterno) non c'è niente da chiedere e il bridge si dà per
  // presente.
  const probed = !!process.env.JVB_HEALTH_URL;
  const stats = await probeBridge();

  const { transitions, sessionsRepaired } = await runLifecycleTick({
    mode: 'fixed',
    now,
    windows,
    bridge: { probed, reachable: stats.reachable, participants: stats.participants },
  });

  if (transitions.toLive > 0) {
    dispatchRecorder();
  }

  const moved =
    transitions.liveEmptyClosed + transitions.toLive + transitions.toEnded + sessionsRepaired;
  if (moved > 0) {
    // Una riga per giro con qualcosa da dire: serve a ricostruire chi ha
    // aperto o chiuso una sala, e quando.
    // eslint-disable-next-line no-console
    console.log(
      `[lifecycle] giro ${now.toISOString()} bridge=${probed ? (stats.reachable ? 'up' : 'down') : 'n/d'} ` +
        `transitions=${JSON.stringify(transitions)} sessionsRepaired=${sessionsRepaired}`,
    );
  }

  return Response.json({
    mode: 'fixed',
    bridgeProbed: probed,
    bridgeReachable: stats.reachable,
    transitions,
    sessionsRepaired,
    checkedAt: now.toISOString(),
  });
});
