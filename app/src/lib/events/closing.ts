/**
 * «Chiudi l'evento»: cosa resta da fare dopo la fine, voce per voce.
 *
 * La scheda «Dopo l'evento» raccoglie registrazione, trascrizione, resoconto,
 * contenuti della sala, materiali, valutazioni e pagina pubblica. Qui si
 * decide lo stato di ciascuna, con le stesse regole delle superfici pubbliche
 * (quale trascrizione si vede, quando la pagina mostra i materiali, quando un
 * evento e' nella libreria video): la funzione `statoChiusura` e' pura (la si
 * prova senza database), il caricatore raccoglie i dati che le servono.
 *
 * Una voce e' «da fare» solo se chi guarda la scheda la puo' fare da li'.
 */
import { prisma } from '@/lib/db';
import {
  CAPTIONS_TRANSCRIPT_MODEL,
  conservazioneFinita,
  registrazionePubblica,
  TRASCRIZIONE_AI_IN_CORSO,
} from '@/lib/captions/transcript';
import { materialVisibilityWhere } from '@/lib/events/material-visibility';
import { isEventPageVisible } from '@/lib/events/visibility';
import { getSettings } from '@/lib/settings';

export type StatoVoce = 'fatto' | 'da-fare' | 'in-corso' | 'non-serve';

export const VOCI_CHIUSURA = [
  'registrazione',
  'trascrizione',
  'resoconto',
  'sala',
  'materiali',
  'valutazioni',
  'pagina',
] as const;
export type VoceChiusura = (typeof VOCI_CHIUSURA)[number];

/**
 * Quanti giorni dopo la fine parte ancora l'email delle valutazioni
 * (lib/events/post-event-finalize).
 */
export const GIORNI_EMAIL_VALUTAZIONI = 7;

/** Quante ore dopo la fine si aspetta ancora il file della registrazione. */
export const ORE_ATTESA_REGISTRAZIONE = 3;

export interface DatiChiusura {
  status: string;
  eventType: string;
  endsAt: Date;
  /** Quando la sala si e' chiusa davvero (l'ultima sessione), se si sa. */
  fineEffettiva: Date | null;
  dataRetentionDays: number;
  recordingEnabled: boolean;
  recordingUrl: string | null;
  recordingPublished: boolean;
  youtubeUrl: string | null;
  transcriptPublished: boolean;
  captionsTranscriptEnabled: boolean;
  /** La trascrizione che la pagina pubblica mostrerebbe, e da dove viene. */
  trascrizione: { recordingId: string; origine: 'sottotitoli' | 'ai' } | null;
  trascrizioneInLavorazione: boolean;
  pipelineAi: boolean;
  resocontoGenerato: boolean;
  resocontoPubblicato: boolean;
  resocontoInLavorazione: boolean;
  messaggi: number;
  domande: number;
  /** Domande (pannello Q&A o segnate in chat) ne' risposte ne' scartate. */
  domandeInSospeso: number;
  sondaggi: number;
  nuvole: number;
  materialiDopo: number;
  postEventShowMaterials: boolean;
  feedbackEnabled: boolean;
  emailValutazioni: boolean;
  emailValutazioniInviataIl: Date | null;
  valutazioni: number;
  postEventPublic: boolean;
  postEventPublicUntil: Date | null;
  libraryListed: boolean;
}

export interface VoceStato {
  voce: VoceChiusura;
  stato: StatoVoce;
  /** Il caso preciso, per il testo: una chiave sotto admin.closing.<voce>. */
  caso: string;
  numeri?: Record<string, number>;
  recordingId?: string;
}

export interface StatoChiusura {
  voci: VoceStato[];
  daFare: number;
}

export function statoChiusura(
  d: DatiChiusura,
  {
    adesso = Date.now(),
    staff = true,
  }: {
    adesso?: number;
    /** Chi guarda ha una sessione dello staff; falso per il link del moderatore. */
    staff?: boolean;
  } = {}
): StatoChiusura {
  const voci: VoceStato[] = [];
  const oreDallaFine = (adesso - d.endsAt.getTime()) / 3_600_000;
  // Il file della registrazione arriva dopo la chiusura vera della sala, che
  // puo' essere prima (chiamata rapida) o dopo (fuori orario) dell'orario.
  const oreDallaChiusura = (adesso - (d.fineEffettiva ?? d.endsAt).getTime()) / 3_600_000;
  const videoPubblicato = !!d.youtubeUrl || (!!d.recordingUrl && d.recordingPublished);
  // Il resoconto si genera solo su un evento concluso con i dati ancora
  // conservati (lib/report/enqueue, stessa regola); pubblicare cio' che c'e'
  // resta possibile. Su un evento archiviato pubblicare non serve: la sua
  // pagina non e' mai pubblica.
  const archiviato = d.status === 'ARCHIVED';
  const resocontoGenerabile =
    d.status === 'ENDED' &&
    !conservazioneFinita(
      { endsAt: d.endsAt, dataRetentionDays: d.dataRetentionDays },
      new Date(adesso)
    );
  const paginaVisibile =
    d.status !== 'ARCHIVED' &&
    isEventPageVisible(
      {
        status: 'ENDED',
        eventType: d.eventType,
        endsAt: d.endsAt,
        postEventPublic: d.postEventPublic,
        postEventPublicUntil: d.postEventPublicUntil,
      },
      adesso
    );

  // Registrazione
  if (videoPubblicato) {
    voci.push({ voce: 'registrazione', stato: 'fatto', caso: 'pubblicata' });
  } else if (d.recordingUrl) {
    voci.push({ voce: 'registrazione', stato: 'da-fare', caso: 'daPubblicare' });
  } else if (!d.recordingEnabled) {
    voci.push({ voce: 'registrazione', stato: 'non-serve', caso: 'spenta' });
  } else if (oreDallaChiusura <= ORE_ATTESA_REGISTRAZIONE) {
    // Se in sala si e' registrato il file arriva dopo: nessun segnale dice
    // con certezza che e' in viaggio, quindi si aspetta per qualche ora.
    voci.push({ voce: 'registrazione', stato: 'in-corso', caso: 'inArrivo' });
  } else {
    voci.push({ voce: 'registrazione', stato: 'non-serve', caso: 'nessunFile' });
  }

  // Trascrizione: quella che la pagina pubblica mostrerebbe, con le sue
  // regole (lib/ai/access): si vede se la funzione c'e' (pipeline o
  // trascrizione dai sottotitoli) e se e' pubblicata la trascrizione o il video.
  const trascrizioneMostrabile = d.pipelineAi || d.captionsTranscriptEnabled;
  if (
    d.trascrizione &&
    trascrizioneMostrabile &&
    (d.transcriptPublished || d.recordingPublished)
  ) {
    voci.push({
      voce: 'trascrizione',
      stato: 'fatto',
      caso: 'pubblicata',
      recordingId: d.trascrizione.recordingId,
    });
  } else if (d.pipelineAi && d.trascrizioneInLavorazione) {
    voci.push({ voce: 'trascrizione', stato: 'in-corso', caso: 'inLavorazione' });
  } else if (d.trascrizione && trascrizioneMostrabile && archiviato) {
    voci.push({ voce: 'trascrizione', stato: 'non-serve', caso: 'nonPiu' });
  } else if (d.trascrizione && trascrizioneMostrabile) {
    voci.push(
      staff
        ? {
            voce: 'trascrizione',
            stato: 'da-fare',
            caso: d.trascrizione.origine === 'ai' ? 'prontaAi' : 'prontaSottotitoli',
            recordingId: d.trascrizione.recordingId,
          }
        : { voce: 'trascrizione', stato: 'non-serve', caso: 'soloStaff' }
    );
  } else {
    voci.push({ voce: 'trascrizione', stato: 'non-serve', caso: 'nessuna' });
  }

  // Resoconto
  if (!d.pipelineAi) {
    voci.push({ voce: 'resoconto', stato: 'non-serve', caso: 'senzaPipeline' });
  } else if (d.resocontoInLavorazione) {
    voci.push({ voce: 'resoconto', stato: 'in-corso', caso: 'inLavorazione' });
  } else if (d.resocontoGenerato && d.resocontoPubblicato) {
    voci.push({ voce: 'resoconto', stato: 'fatto', caso: 'pubblicato' });
  } else if (archiviato || (!d.resocontoGenerato && !resocontoGenerabile)) {
    voci.push({ voce: 'resoconto', stato: 'non-serve', caso: 'nonPiu' });
  } else if (!staff) {
    voci.push({ voce: 'resoconto', stato: 'non-serve', caso: 'soloStaff' });
  } else {
    voci.push({
      voce: 'resoconto',
      stato: 'da-fare',
      caso: d.resocontoGenerato ? 'daPubblicare' : 'daGenerare',
    });
  }

  // Cosa e' successo in sala: da fare se restano domande ne' risposte ne'
  // scartate, che si chiudono dalla revisione qui sotto. I sondaggi chiusi e
  // non pubblicati no: tenere i risultati per se' e' una scelta legittima.
  const numeriSala = {
    messaggi: d.messaggi,
    domande: d.domande,
    sondaggi: d.sondaggi,
    nuvole: d.nuvole,
  };
  if (d.messaggi + d.domande + d.sondaggi + d.nuvole === 0) {
    voci.push({ voce: 'sala', stato: 'non-serve', caso: 'vuota' });
  } else if (d.domandeInSospeso > 0 && d.status === 'ENDED') {
    voci.push({
      voce: 'sala',
      stato: 'da-fare',
      caso: 'inSospeso',
      numeri: { domandeInSospeso: d.domandeInSospeso },
    });
  } else {
    voci.push({ voce: 'sala', stato: 'fatto', caso: 'rivista', numeri: numeriSala });
  }

  // Materiali per chi non c'era: facoltativi, quindi se mancano non sono
  // «da fare». Lo e' accendere la sezione dei materiali, se ce ne sono e la
  // pagina si vede.
  if (d.materialiDopo > 0 && d.postEventShowMaterials) {
    voci.push({
      voce: 'materiali',
      stato: 'fatto',
      caso: 'presenti',
      numeri: { materiali: d.materialiDopo },
    });
  } else if (d.materialiDopo > 0) {
    // Ci sono ma la pagina non li mostra: da accendere se la pagina si vede.
    voci.push({
      voce: 'materiali',
      stato: paginaVisibile ? 'da-fare' : 'non-serve',
      caso: 'nascosti',
      numeri: { materiali: d.materialiDopo },
    });
  } else {
    voci.push({ voce: 'materiali', stato: 'non-serve', caso: 'nessuno' });
  }

  // Valutazioni. L'email parte da sola solo per un evento concluso (non
  // archiviato), entro la settimana dalla fine.
  const emailPossibile =
    d.status === 'ENDED' &&
    d.eventType !== 'LEGACY' &&
    oreDallaFine <= GIORNI_EMAIL_VALUTAZIONI * 24;
  const numeriValutazioni = { valutazioni: d.valutazioni };
  if (!d.feedbackEnabled) {
    voci.push({ voce: 'valutazioni', stato: 'non-serve', caso: 'spente' });
  } else if (d.emailValutazioniInviataIl) {
    voci.push({
      voce: 'valutazioni',
      stato: 'fatto',
      caso: 'emailInviata',
      numeri: numeriValutazioni,
    });
  } else if (emailPossibile && d.emailValutazioni) {
    voci.push({
      voce: 'valutazioni',
      stato: 'in-corso',
      caso: 'emailInPartenza',
      numeri: numeriValutazioni,
    });
  } else if (emailPossibile) {
    voci.push({
      voce: 'valutazioni',
      stato: 'da-fare',
      caso: 'emailSpenta',
      numeri: numeriValutazioni,
    });
  } else {
    voci.push({
      voce: 'valutazioni',
      stato: 'fatto',
      caso: 'raccolte',
      numeri: numeriValutazioni,
    });
  }

  // Pagina pubblica: si dice com'e', non si chiede niente. Nella libreria
  // video l'evento compare solo con un video da guardare.
  if (d.status === 'ARCHIVED') {
    voci.push({ voce: 'pagina', stato: 'non-serve', caso: 'archiviato' });
  } else if (paginaVisibile) {
    voci.push({
      voce: 'pagina',
      stato: 'fatto',
      caso: !d.libraryListed
        ? 'visibile'
        : videoPubblicato
          ? 'nellaLibreria'
          : 'libreriaSenzaVideo',
    });
  } else {
    voci.push({
      voce: 'pagina',
      stato: 'fatto',
      caso: d.postEventPublic ? 'scaduta' : 'privata',
    });
  }

  return { voci, daFare: voci.filter((v) => v.stato === 'da-fare').length };
}

/** Raccoglie dal database cio' che serve a `statoChiusura`. */
export async function caricaDatiChiusura(eventId: string): Promise<DatiChiusura | null> {
  const evento = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      status: true,
      eventType: true,
      endsAt: true,
      dataRetentionDays: true,
      recordingEnabled: true,
      recordingUrl: true,
      recordingPublished: true,
      youtubeUrl: true,
      transcriptPublished: true,
      captionsTranscriptEnabled: true,
      postEventReportAt: true,
      postEventReportPublished: true,
      postEventShowMaterials: true,
      feedbackEnabled: true,
      postEventEmailEnabled: true,
      postEventEmailSentAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
      libraryListed: true,
    },
  });
  if (!evento) return null;
  const impostazioni = await getSettings();
  const pipelineAi = impostazioni.aiPipelineEnabled;

  const [
    pubblica,
    trascrizioniAttive,
    resocontiAttivi,
    perTipoMessaggio,
    domandeChatInSospeso,
    domande,
    domandeInSospeso,
    sondaggi,
    nuvole,
    materialiDopo,
    valutazioniStelle,
    valutazioniQuestionari,
    sessioni,
  ] = await Promise.all([
    registrazionePubblica(eventId, !pipelineAi),
    prisma.postprodJob.count({
      where: { ...TRASCRIZIONE_AI_IN_CORSO, recording: { eventId } },
    }),
    prisma.postprodJob.count({
      where: {
        kind: 'REPORT',
        eventId,
        status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
      },
    }),
    prisma.chatMessage.groupBy({
      by: ['isQuestion'],
      where: { eventId, hiddenAt: null },
      _count: { _all: true },
    }),
    prisma.chatMessage.count({
      where: {
        eventId,
        hiddenAt: null,
        isQuestion: true,
        answeredAt: null,
        dismissedAt: null,
      },
    }),
    prisma.question.count({ where: { eventId } }),
    prisma.question.count({
      where: { eventId, status: { in: ['PENDING', 'HIGHLIGHTED'] } },
    }),
    prisma.poll.count({ where: { eventId } }),
    prisma.wordCloudRound.count({ where: { eventId } }),
    prisma.eventMaterial.count({
      where: { eventId, ...materialVisibilityWhere('AFTER') },
    }),
    prisma.eventFeedback.count({ where: { eventId } }),
    prisma.questionnaireResponse.count({
      where: { questionnaire: { eventId, placement: 'POST_EVENT' } },
    }),
    prisma.callSession.aggregate({ where: { eventId }, _max: { endedAt: true } }),
  ]);

  // La registrazione che la pagina pubblica userebbe ha una trascrizione? E
  // di che origine? (registrazionePubblica puo' ripiegare su una registrazione
  // conclusa che una trascrizione non ce l'ha.)
  const artefatto = pubblica
    ? await prisma.postprodArtifact.findFirst({
        where: { recordingId: pubblica, type: 'TRANSCRIPT_JSON', language: null },
        orderBy: { createdAt: 'desc' },
        select: { modelId: true },
      })
    : null;
  const conteggio = (domanda: boolean) =>
    perTipoMessaggio.find((g) => g.isQuestion === domanda)?._count._all ?? 0;

  return {
    status: evento.status,
    eventType: evento.eventType,
    endsAt: evento.endsAt,
    fineEffettiva: sessioni._max.endedAt,
    dataRetentionDays: evento.dataRetentionDays,
    recordingEnabled: evento.recordingEnabled,
    recordingUrl: evento.recordingUrl,
    recordingPublished: evento.recordingPublished,
    youtubeUrl: evento.youtubeUrl,
    transcriptPublished: evento.transcriptPublished,
    captionsTranscriptEnabled: evento.captionsTranscriptEnabled,
    trascrizione:
      pubblica && artefatto
        ? {
            recordingId: pubblica,
            origine:
              pipelineAi && artefatto.modelId !== CAPTIONS_TRANSCRIPT_MODEL
                ? 'ai'
                : 'sottotitoli',
          }
        : null,
    trascrizioneInLavorazione: trascrizioniAttive > 0,
    pipelineAi,
    resocontoGenerato: evento.postEventReportAt != null,
    resocontoPubblicato: evento.postEventReportPublished,
    resocontoInLavorazione: resocontiAttivi > 0,
    messaggi: conteggio(false),
    domande: domande + conteggio(true),
    domandeInSospeso: domandeInSospeso + domandeChatInSospeso,
    sondaggi,
    nuvole,
    materialiDopo,
    postEventShowMaterials: evento.postEventShowMaterials,
    feedbackEnabled: evento.feedbackEnabled,
    emailValutazioni: evento.postEventEmailEnabled,
    emailValutazioniInviataIl: evento.postEventEmailSentAt,
    valutazioni: valutazioniStelle + valutazioniQuestionari,
    postEventPublic: evento.postEventPublic,
    postEventPublicUntil: evento.postEventPublicUntil,
    libraryListed: evento.libraryListed,
  };
}
