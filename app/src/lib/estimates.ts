/**
 * La stima della capacita' salvata con un evento (`capacityEstimateJson`,
 * alla creazione e quando cambia uno dei suoi ingressi): un adattatore sul
 * modello di lib/capacity/model, con i valori predefiniti dell'istanza.
 * Nessuno la rilegge; il pannello e la pagina dell'evento calcolano con le
 * impostazioni correnti del sito.
 */

import {
  ISTANZA_PREDEFINITA,
  durataInOre,
  stimaCapacita,
  type CapacitaIstanza,
  type LivelloCapacita,
} from '@/lib/capacity/model';
import type { VideoQualityPreset } from '@/lib/jitsi/config';

interface EventConfig {
  maxParticipants: number;
  /**
   * Gli iscritti al momento della stima. Se sono piu' dei partecipanti attesi
   * la stima si fa su di loro.
   */
  registeredParticipants?: number;
  startsAt?: string;
  endsAt?: string;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  /** La quota di webcam accese; null: quella del sito. */
  expectedSenderRatioPct?: number | null;
  /** Le persone che presentano (1 se non si sa). */
  presenters?: number;
  videoQuality?: VideoQualityPreset | null;
  liveCaptionsEnabled?: boolean;
  /** L'istanza; senza, i valori predefiniti. */
  istanza?: CapacitaIstanza;
}

/** Le stime in numeri. */
export interface EventEstimateNumbers {
  /** La versione del modello che le ha fatte. */
  model: 2;
  /** I partecipanti su cui si e' stimato. */
  sizedFor: number;
  basedOnRegistrations: boolean;
  /** Chi presenta in primo piano: tutti gli strati della webcam. */
  moderatorUpMbps: number;
  /** Chi guarda. */
  participantDownMbps: number;
  /** Il ponte, entrata piu' uscita. */
  totalMbps: number;
  bridgeOutMbps: number;
  bridgeInMbps: number;
  packetsPerSecond: number;
  cores: number;
  bridgeLoadPct: number;
  level: LivelloCapacita;
  jvbCount: number;
  durationHours: number;
  storageGB: number;
  storageGBMax: number;
}

/** Le stesse stime, anche in parole: e' la forma salvata con l'evento. */
export interface EventEstimates extends EventEstimateNumbers {
  moderatorBandwidth: string;
  participantBandwidth: string;
  totalBandwidth: string;
  estimatedDuration: string;
  storageEstimate: string;
}

/** Senza date si conta un evento di due ore. */
const DURATA_PREDEFINITA_ORE = 2;

export function estimateNumbers(event: EventConfig): EventEstimateNumbers {
  const iscritti = event.registeredParticipants ?? 0;
  const basedOnRegistrations = iscritti > event.maxParticipants;
  const durationHours =
    durataInOre(event.startsAt, event.endsAt) ??
    (event.startsAt && event.endsAt ? 0 : DURATA_PREDEFINITA_ORE);
  const s = stimaCapacita(
    {
      maxParticipants: basedOnRegistrations ? iscritti : event.maxParticipants,
      expectedSenderRatioPct: event.expectedSenderRatioPct ?? null,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanUnmute: event.participantsCanUnmute,
      presenters: event.presenters ?? 1,
      videoQuality: event.videoQuality ?? null,
      recordingEnabled: event.recordingEnabled,
      liveCaptionsEnabled: event.liveCaptionsEnabled ?? false,
      durationHours,
    },
    event.istanza ?? ISTANZA_PREDEFINITA,
  );
  return {
    model: 2,
    sizedFor: s.partecipanti,
    basedOnRegistrations,
    moderatorUpMbps: s.perPartecipante.upPiccoMbps,
    participantDownMbps: s.perPartecipante.downMbps,
    totalMbps: s.ponte.outMbps + s.ponte.inMbps,
    bridgeOutMbps: s.ponte.outMbps,
    bridgeInMbps: s.ponte.inMbps,
    packetsPerSecond: s.ponte.outPps + s.ponte.inPps,
    cores: s.ponte.core,
    bridgeLoadPct: s.ponte.carico * 100,
    level: s.ponte.livello,
    jvbCount: s.ponte.ponti,
    durationHours,
    storageGB: s.registrazione?.gbMin ?? 0,
    storageGBMax: s.registrazione?.gbMax ?? 0,
  };
}

export function calculateEstimates(event: EventConfig): EventEstimates {
  const n = estimateNumbers(event);
  const ore = Math.floor(n.durationHours);
  const minuti = Math.round((n.durationHours % 1) * 60);
  return {
    ...n,
    moderatorBandwidth: `~${n.moderatorUpMbps.toFixed(1)} Mbps ↑`,
    participantBandwidth: `~${n.participantDownMbps.toFixed(1)} Mbps ↓`,
    totalBandwidth:
      n.totalMbps > 1000
        ? `~${(n.totalMbps / 1000).toFixed(1)} Gbps`
        : `~${n.totalMbps.toFixed(0)} Mbps`,
    estimatedDuration: n.durationHours >= 1 ? `${ore}h ${minuti}m` : `${minuti}m`,
    storageEstimate: `~${event.recordingEnabled ? n.storageGB.toFixed(1) : '0'} GB`,
  };
}
