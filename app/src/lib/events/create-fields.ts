/**
 * Quali campi accettati alla creazione di un evento finiscono davvero in
 * banca dati, e quali no — con il motivo.
 *
 * PERCHÉ UNA LISTA E NON SOLO L'OGGETTO NELLA ROTTA: la rotta di creazione
 * enumera a mano i campi da scrivere, e ogni campo aggiunto allo schema di
 * validazione dopo di allora è stato semplicemente dimenticato. Lo schema lo
 * accettava, il modulo lo inviava, la rotta lo buttava, e nessuno se ne
 * accorgeva: la risposta era un 201 identico a quello di un salvataggio
 * completo. È così che si sono persi per mesi il modello dell'informativa, i
 * requisiti sui dati dell'organizzazione, l'immagine di copertina, il periodo
 * di tolleranza, i comandi della pagina di fine evento e la nuvola di parole.
 *
 * Il difetto gemello sulla duplicazione ha già il suo presidio
 * (`duplicate-fields.ts`), che però confronta le colonne Prisma e resta verde
 * qualunque cosa le rotte scrivano: è precisamente il controllo che questo
 * difetto ha attraversato indisturbato. Qui il confronto è con lo schema di
 * validazione, cioè con ciò che la rotta dichiara di accettare.
 *
 * Aggiungi un campo allo schema e dimenticalo nella rotta, e la suite diventa
 * rossa — invece del prossimo evento che nasce senza.
 */

/** Campi accettati dallo schema che la creazione persiste. */
export const CREATED_EVENT_FIELDS = [
  // contenuto e calendario
  'title',
  'description',
  'startsAt',
  'endsAt',
  'timezone',

  // capienza e dimensionamento
  'maxParticipants',
  'expectedSenderRatioPct',
  'expectedSpeakers',
  'gracePeriodMinutes',
  'videoQuality',

  // funzioni della sala
  'qaEnabled',
  'chatEnabled',
  'whiteboardEnabled',
  'wordCloudEnabled',
  'agendaEnabled',
  'feedbackEnabled',
  'waitingRoomEngine',
  'waitingRoomAudioUrl',

  // permessi
  'participantsCanUnmute',
  'participantsCanStartVideo',
  'participantsCanShareScreen',
  'permissionMatrix',

  // regole di iscrizione
  'requireOrganization',
  'requireOrganizationRole',
  'requireOrganizationType',

  // dati personali e informativa
  'dataRetentionDays',
  'privacyPolicyUrl',
  'privacyPolicyText',
  'gdprTemplateId',
  'recordingConsentText',

  // registrazione e pubblicazione
  'recordingEnabled',
  'autoStartRecording',
  'multitrackRecordingEnabled',
  'retainParticipantTracks',
  'youtubeUrl',
  'libraryListed',

  // post-produzione
  'aiTranscriptEnabled',
  'aiSummaryEnabled',
  'aiTranslationEnabled',
  'aiDubbingEnabled',
  'aiTargetLocales',

  // pagina di fine evento
  'postEventPublic',
  'postEventPublicUntil',
  'postEventShowQA',
  'postEventShowMaterials',
  'postEventShowPolls',
  'postEventShowFeedback',
  'postEventShowRecap',
  'postEventShowWordCloud',
  'postEventEmailEnabled',

  // presentazione
  'coverImageUrl',
  'imageUrl',
  'parseTitleKicker',
  'speakersInfo',
  'organizerName',
  'moderatorName',
  'moderatorEmail',

  // serie
  'recurrenceRule',
  'recurrenceSeriesId',
] as const;

/**
 * Campi accettati dallo schema che la creazione NON scrive come colonna, e
 * perché. Ogni voce è una scelta, non una dimenticanza: è la differenza che
 * questo file esiste per rendere visibile.
 */
export const NOT_CREATED_EVENT_FIELDS: Record<string, string> = {
  joinPassword:
    'non si conserva in chiaro: viene ridotta a impronta in joinPasswordHash',
  tagSlugs:
    'non è una colonna: diventa una riga di collegamento per ogni etichetta, scritta dopo la creazione',
};
