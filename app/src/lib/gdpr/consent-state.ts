/**
 * Lo stato dei consensi di un'iscrizione, per chi la guarda dai propri dati.
 * Un consenso si puo' dare all'iscrizione o in sala (le prove
 * RecordingConsent, MultitrackConsent): vale finche' almeno uno dei due non e'
 * ritirato. `null`: quel consenso a questa persona non e' stato chiesto.
 */
export interface StatoConsenso {
  dato: boolean;
  /** L'ultimo ritiro, se non e' stato dato di nuovo. */
  ritiratoIl: string | null;
}

interface Prova {
  withdrawnAt: Date | null;
}

function stato(
  allIscrizione: boolean | null,
  ritiroIscrizione: Date | null,
  prove: readonly Prova[]
): StatoConsenso | null {
  if (allIscrizione === null && prove.length === 0) return null;
  const dato =
    (allIscrizione === true && !ritiroIscrizione) ||
    prove.some((p) => p.withdrawnAt === null);
  const ritiri = [ritiroIscrizione, ...prove.map((p) => p.withdrawnAt)].filter(
    (d): d is Date => d !== null
  );
  const ultimo = ritiri.length > 0 ? Math.max(...ritiri.map((d) => d.getTime())) : null;
  return {
    dato,
    ritiratoIl: !dato && ultimo !== null ? new Date(ultimo).toISOString() : null,
  };
}

export function consensiDellIscrizione(r: {
  consentRecording: boolean | null;
  consentRecordingWithdrawnAt: Date | null;
  recordingConsents?: readonly Prova[];
  consentMultitrack: boolean | null;
  consentMultitrackWithdrawnAt: Date | null;
  multitrackConsents?: readonly Prova[];
  consentFutureCommunications: boolean;
  consentFutureCommunicationsWithdrawnAt: Date | null;
}) {
  const ritiroComunicazioni = r.consentFutureCommunicationsWithdrawnAt;
  return {
    recording: stato(
      r.consentRecording,
      r.consentRecordingWithdrawnAt,
      r.recordingConsents ?? []
    ),
    transcription: stato(
      r.consentMultitrack,
      r.consentMultitrackWithdrawnAt,
      r.multitrackConsents ?? []
    ),
    futureCommunications:
      r.consentFutureCommunications || ritiroComunicazioni
        ? {
            dato: r.consentFutureCommunications,
            ritiratoIl: ritiroComunicazioni?.toISOString() ?? null,
          }
        : null,
  };
}
