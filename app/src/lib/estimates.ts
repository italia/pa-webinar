interface EventConfig {
  maxParticipants: number;
  /**
   * Registered participants at the time the estimate is computed. When
   * provided, estimates are sized on this value rather than on
   * `maxParticipants`, so the moderator sees the *current* demand rather
   * than the worst-case capacity. Falls back to `maxParticipants` when
   * omitted or zero.
   */
  registeredParticipants?: number;
  startsAt?: string;
  endsAt?: string;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

export interface EventEstimates {
  /** Number of participants the estimate was sized for. */
  sizedFor: number;
  /** True when the estimate is sized on `registeredParticipants`. */
  basedOnRegistrations: boolean;
  moderatorBandwidth: string;
  participantBandwidth: string;
  totalBandwidth: string;
  jvbCount: number;
  jvbRam: string;
  estimatedDuration: string;
  storageEstimate: string;
}

export function calculateEstimates(event: EventConfig): EventEstimates {
  const basedOnRegistrations =
    event.registeredParticipants !== undefined &&
    event.registeredParticipants > 0;
  const participants = basedOnRegistrations
    ? (event.registeredParticipants as number)
    : event.maxParticipants;

  let moderatorUp = 0.05;
  let participantDown = 0.05;

  moderatorUp += 2.5;
  participantDown += 1.0;

  if (event.participantsCanStartVideo) {
    const videoParticipants = Math.ceil(participants * 0.2);
    participantDown += videoParticipants * 0.1;
  }

  if (event.participantsCanUnmute) {
    participantDown += 0.05;
  }

  if (event.participantsCanShareScreen) {
    participantDown += 0.5;
  }

  const totalBandwidth = participantDown * participants + moderatorUp;

  const isWebinarMode =
    !event.participantsCanStartVideo && !event.participantsCanUnmute;
  const participantsPerJvb = isWebinarMode ? 500 : 150;
  const jvbCount = Math.max(1, Math.ceil(participants / participantsPerJvb));

  const jvbRamMB = (2048 + participants * 10) * jvbCount;

  let durationHours = 2;
  if (event.startsAt && event.endsAt) {
    const durationMs =
      new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
    durationHours = Math.max(0, durationMs / (1000 * 60 * 60));
  }

  const storageGB = event.recordingEnabled
    ? ((1.5 * durationHours * 3600) / 8 / 1024).toFixed(1)
    : '0';

  return {
    sizedFor: participants,
    basedOnRegistrations,
    moderatorBandwidth: `~${moderatorUp.toFixed(1)} Mbps ↑`,
    participantBandwidth: `~${participantDown.toFixed(1)} Mbps ↓`,
    totalBandwidth:
      totalBandwidth > 1000
        ? `~${(totalBandwidth / 1000).toFixed(1)} Gbps`
        : `~${totalBandwidth.toFixed(0)} Mbps`,
    jvbCount,
    jvbRam:
      jvbRamMB > 1024
        ? `${(jvbRamMB / 1024).toFixed(0)} GB`
        : `${jvbRamMB} MB`,
    estimatedDuration:
      durationHours >= 1
        ? `${Math.floor(durationHours)}h ${Math.round((durationHours % 1) * 60)}m`
        : `${Math.round(durationHours * 60)}m`,
    storageEstimate: `~${storageGB} GB`,
  };
}
