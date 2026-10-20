/**
 * Cio' che la stima della capacita' sa dell'istanza: dalle impostazioni del
 * sito i core di un ponte, le soglie di sforzo, la quota di webcam e la
 * qualita' video; dall'ambiente del portale (lo scrive il chart) quanti ponti
 * ci sono, se il ponte inoltra solo le voci piu' forti, se i ponti sono
 * collegati e quante voci trascrivono i sottotitoli. Si legge sul server e
 * arriva al pannello come prop: mai variabili `NEXT_PUBLIC_*`.
 */

import { liveCaptionsAvailable } from '@/lib/captions/availability';
import { jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import type { VideoQualityPreset } from '@/lib/jitsi/config';

import { ISTANZA_PREDEFINITA, type CapacitaIstanza } from './model';

type Ambiente = Record<string, string | undefined>;

/** Un intero non negativo dall'ambiente; vuoto o storto: il ripiego. */
function intero(valore: string | undefined, ripiego: number): number {
  const n = Number.parseInt(valore?.trim() ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : ripiego;
}

/** Le tre variabili della capacita', con i loro valori predefiniti:
 *  `JVB_NUM_LOUDEST` (0 o assente: tutte le voci), `JVB_CASCADING` ("true":
 *  ponti collegati), `CAPTIONS_MAX_STREAMS` (4). */
export function ambienteCapacita(
  env: Ambiente = process.env
): Pick<CapacitaIstanza, 'numLoudest' | 'cascading' | 'captionsMaxStreams'> {
  return {
    numLoudest: intero(env.JVB_NUM_LOUDEST, 0),
    cascading: env.JVB_CASCADING?.trim().toLowerCase() === 'true',
    captionsMaxStreams: Math.max(1, intero(env.CAPTIONS_MAX_STREAMS, 4)),
  };
}

export interface ImpostazioniCapacita {
  jvbCpuCoresPerPod?: number | null;
  jvbStressWarnPercent?: number | null;
  jvbStressCriticalPercent?: number | null;
  defaultSenderRatioPct?: number | null;
  videoQuality?: VideoQualityPreset | null;
  liveCaptionsEnabled?: boolean | null;
}

/** L'istanza per la stima, dalle impostazioni del sito e dall'ambiente. */
export function capacitaIstanza(impostazioni: ImpostazioniCapacita): CapacitaIstanza {
  const ponti = jvbMaxReplicasFromEnv();
  return {
    coresPerBridge: impostazioni.jvbCpuCoresPerPod ?? ISTANZA_PREDEFINITA.coresPerBridge,
    stressWarn: impostazioni.jvbStressWarnPercent ?? ISTANZA_PREDEFINITA.stressWarn,
    stressCritical:
      impostazioni.jvbStressCriticalPercent ?? ISTANZA_PREDEFINITA.stressCritical,
    instanceBridges: Number.isFinite(ponti) && ponti > 0 ? ponti : 1,
    ...ambienteCapacita(),
    captionsAvailable: liveCaptionsAvailable(impostazioni),
    siteCameraPct:
      impostazioni.defaultSenderRatioPct ?? ISTANZA_PREDEFINITA.siteCameraPct,
    siteVideoQuality: impostazioni.videoQuality ?? ISTANZA_PREDEFINITA.siteVideoQuality,
  };
}
