/**
 * La traduzione automatica al salvataggio, e lo stato delle lingue di un
 * evento per chi lo modifica.
 *
 * Dopo ogni salvataggio dell'evento (creazione, modifica) e dopo ogni
 * consegna del worker, `riconciliaTraduzioni` guarda le lingue della pagina e
 * chiede la traduzione del testo principale salvato in quelle vuote e in
 * quelle tradotte in automatico da un testo che non c'e' piu'. Lo decide il
 * server, sul testo salvato: un salvataggio automatico di una bozza non deve
 * chiamarla (tradurrebbe un testo a meta').
 *
 * Non fa niente senza motore, per le chiamate istantanee (non hanno una
 * pagina) e per gli eventi archiviati; ne' con un lavoro gia' aperto. Non
 * ripete l'ultimo lavoro (stesso testo, stesse lingue) se e' fallito, o se
 * si e' concluso senza un testo per quelle lingue: la lingua dice «Non
 * riuscita» e si riprova a mano («Riprova»), non a ogni salvataggio. Dopo una
 * consegna non lo ripete in nessun caso, cosi' non c'e' un giro senza fine.
 * Lo ripete invece se chi salva ha di nuovo vuotato una lingua che il motore
 * aveva tradotto. Un guasto si scrive nel registro e non fa fallire il
 * salvataggio.
 */
import { resolveMtProvider } from '@/lib/ai/providers';
import { translateTextPayloadSchema } from '@/lib/ai/schemas';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';

import {
  TRADUZIONE_IN_CORSO,
  bloccaTraduzioniEvento,
  creaLavoroTraduzione,
  lingueAttive,
  sorgenteTraducibile,
  traduzioneDisponibile,
  ultimoLavoroTraduzione,
  type UltimoLavoro,
} from './enqueue';
import { letturaTraduzioni } from './proposals';
import { improntaSorgente, testoSorgente, type TestoSorgente } from './source';
import {
  haTesto,
  letturaStatoTesti,
  linguaPrincipale,
  lingueDaTradurre,
  lingueDellEvento,
  lingueDellaPagina,
  statoLingua,
  stesseLingue,
  type OrigineTesto,
  type StatoScheda,
} from './stato-lingue';

/**
 * Le lingue per cui l'ultima traduzione consegnata del testo principale non e'
 * intera (manca il titolo o la descrizione che il testo principale ha: la
 * consegna non l'ha scritta, applicaTraduzioni), o tutte se non ce n'e' una.
 */
function lingueSenzaRisultato(
  ultimaConsegna: unknown,
  sorgente: TestoSorgente,
  impronta: string
): (lingua: string) => boolean {
  const proposta = letturaTraduzioni(ultimaConsegna);
  const valida = proposta && proposta.sourceHash === impronta ? proposta : null;
  return (l) =>
    !valida ||
    (!!sorgente.title && !valida.title[l]?.trim()) ||
    (!!sorgente.description && !valida.description[l]?.trim());
}

export interface EsitoRiconcilia {
  /** Un lavoro di traduzione e' stato chiesto adesso. */
  avviata: boolean;
  /** Le lingue che traduce. */
  lingue: string[];
}

const NIENTE: EsitoRiconcilia = { avviata: false, lingue: [] };

const IMPOSTAZIONI = {
  aiPipelineEnabled: true,
  defaultLocale: true,
  availableLocales: true,
  aiDefaultTargetLocales: true,
} as const;

/**
 * Chiede la traduzione delle lingue della pagina che ne hanno bisogno. Chi
 * ha salvato (`request`) si scrive nel registro dell'amministrazione;
 * `dopoConsegna` dice che chiama la consegna del worker, non un salvataggio.
 */
export async function riconciliaTraduzioni(
  eventId: string,
  opts: { request?: Request; actor?: string; dopoConsegna?: boolean } = {}
): Promise<EsitoRiconcilia> {
  // Senza motore installato non si legge nemmeno la banca dati.
  if (!resolveMtProvider()) return NIENTE;
  try {
    const [evento, impostazioni] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: {
          status: true,
          eventType: true,
          title: true,
          description: true,
          textLocaleState: true,
          textTranslations: true,
          aiTargetLocales: true,
        },
      }),
      prisma.siteSetting.findUnique({ where: { id: 'singleton' }, select: IMPOSTAZIONI }),
    ]);
    if (!evento || !impostazioni?.aiPipelineEnabled) return NIENTE;
    if (evento.eventType === 'INSTANT' || evento.status === 'ARCHIVED') return NIENTE;

    const principale = linguaPrincipale(impostazioni);
    const titoli = (evento.title ?? {}) as Record<string, string>;
    const descrizioni = (evento.description ?? {}) as Record<string, string>;
    const sorgente = testoSorgente(principale, titoli, descrizioni);
    if (!sorgenteTraducibile(sorgente)) return NIENTE;
    const impronta = improntaSorgente(sorgente);
    const destinazioni = lingueDaTradurre({
      pagina: lingueDellaPagina(
        lingueDellEvento(evento.aiTargetLocales, impostazioni.aiDefaultTargetLocales),
        lingueAttive(impostazioni.availableLocales),
        principale
      ),
      titoli,
      descrizioni,
      stato: letturaStatoTesti(evento.textLocaleState),
      impronta,
    });
    if (destinazioni.length === 0) return NIENTE;
    const senzaRisultato = lingueSenzaRisultato(
      evento.textTranslations,
      sorgente,
      impronta
    );

    const jobId = await prisma.$transaction(async (tx) => {
      await bloccaTraduzioniEvento(tx, eventId);
      const inCorso = await tx.postprodJob.findFirst({
        where: { ...TRADUZIONE_IN_CORSO, eventId },
        select: { id: true },
      });
      if (inCorso) return null;
      // Lo stesso lavoro c'e' gia' stato: fallito, o concluso senza un testo
      // per quelle lingue, si riprova a mano; appena consegnato, non si
      // richiede in un giro senza fine.
      const ultimo = await tx.postprodJob.findFirst({
        where: { kind: 'TRANSLATE_TEXT', eventId },
        orderBy: { createdAt: 'desc' },
        select: { payload: true, status: true },
      });
      const letto = translateTextPayloadSchema.safeParse(ultimo?.payload);
      if (
        letto.success &&
        letto.data.sourceHash === impronta &&
        stesseLingue(letto.data.targetLanguages, destinazioni) &&
        (ultimo?.status === 'FAILED' ||
          opts.dopoConsegna ||
          destinazioni.every((l) => senzaRisultato(l)))
      ) {
        return null;
      }
      return creaLavoroTraduzione(tx, { eventId, sorgente, impronta, destinazioni });
    });
    if (!jobId) return NIENTE;
    if (opts.request) {
      await logAdminAction({
        request: opts.request,
        action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
        target: eventId,
        details: {
          jobId,
          sourceLanguage: principale,
          targetLanguages: destinazioni,
          automatic: true,
        },
        ...(opts.actor ? { actor: opts.actor } : {}),
      });
    }
    return { avviata: true, lingue: destinazioni };
  } catch (err) {
    console.error('[text-translation] traduzione automatica non chiesta', {
      eventId,
      errore: err instanceof Error ? err.message : String(err),
    });
    return NIENTE;
  }
}

/** Lo stato di una lingua dell'evento, come lo legge il wizard. */
export interface LinguaEvento {
  code: string;
  /** Attiva sul sito: ha una scheda e una pagina. */
  page: boolean;
  /** Fra le lingue dell'evento (le altre hanno solo un testo salvato). */
  event: boolean;
  /** Lo stato, sul testo salvato. */
  state: StatoScheda;
  /** Chi l'ha scritta, se lo si sa. */
  origin: OrigineTesto | null;
  /** Il testo viene dal testo principale salvato. */
  current: boolean;
  /** Quando e' stato scritto o tradotto. */
  at?: string;
  /** Perche' l'ultima traduzione non e' riuscita. */
  failure?: 'MT_UNAVAILABLE' | 'GENERIC';
}

/** Cio' che il wizard e la pagina dell'evento sanno delle lingue di un evento. */
export interface StatoTestiEvento {
  /** La traduzione automatica c'e' per questo evento. */
  engine: 'available' | 'off';
  /** La lingua principale. */
  principale: string;
  lingue: LinguaEvento[];
  job: {
    status: string;
    createdAt: string;
    completedAt: string | null;
    errorCode: 'MT_UNAVAILABLE' | null;
    targetLanguages: string[];
  } | null;
  /** Titolo e descrizione salvati nelle lingue diverse dalla principale. */
  testi: { title: Record<string, string>; description: Record<string, string> };
}

const APERTO = new Set<string>(TRADUZIONE_IN_CORSO.status.in);

/** Lo stato delle lingue di un evento; null se l'evento non c'e'. */
export async function statoTestiEvento(
  eventId: string,
  ora: Date = new Date()
): Promise<StatoTestiEvento | null> {
  const [evento, impostazioni, lavoro] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        status: true,
        eventType: true,
        title: true,
        description: true,
        textLocaleState: true,
        textTranslations: true,
        aiTargetLocales: true,
      },
    }),
    prisma.siteSetting.findUnique({ where: { id: 'singleton' }, select: IMPOSTAZIONI }),
    ultimoLavoroTraduzione(eventId),
  ]);
  if (!evento) return null;
  return calcolaStatoTesti({ evento, impostazioni, lavoro, ora });
}

/** Il calcolo di `statoTestiEvento`, senza banca dati. */
export function calcolaStatoTesti(opts: {
  evento: {
    status: string;
    eventType: string;
    title: unknown;
    description: unknown;
    textLocaleState: unknown;
    textTranslations?: unknown;
    aiTargetLocales: string | null;
  };
  impostazioni: {
    aiPipelineEnabled?: boolean | null;
    defaultLocale?: string | null;
    availableLocales?: unknown;
    aiDefaultTargetLocales?: string | null;
  } | null;
  lavoro: Pick<
    UltimoLavoro,
    | 'status'
    | 'createdAt'
    | 'completedAt'
    | 'errorCode'
    | 'sourceHash'
    | 'targetLanguages'
  > | null;
  ora: Date;
}): StatoTestiEvento {
  const { evento, impostazioni, lavoro, ora } = opts;
  const principale = linguaPrincipale(impostazioni);
  const attive = lingueAttive(impostazioni?.availableLocales);
  const titoli = (evento.title ?? {}) as Record<string, string>;
  const descrizioni = (evento.description ?? {}) as Record<string, string>;
  const motore =
    traduzioneDisponibile(impostazioni) &&
    evento.eventType !== 'INSTANT' &&
    evento.status !== 'ARCHIVED' &&
    sorgenteTraducibile(testoSorgente(principale, titoli, descrizioni));
  const stato = letturaStatoTesti(evento.textLocaleState);
  const impronta = improntaSorgente(testoSorgente(principale, titoli, descrizioni));
  const dellEvento = lingueDellEvento(
    evento.aiTargetLocales,
    impostazioni?.aiDefaultTargetLocales
  );
  const conTesto = [
    ...new Set([...Object.keys(titoli), ...Object.keys(descrizioni)]),
  ].filter((l) => l !== principale && haTesto(l, titoli, descrizioni));
  const aperto = lavoro && APERTO.has(lavoro.status) ? lavoro : null;
  // Non riuscito sul testo di adesso: fallito, o concluso senza un testo per
  // la lingua (il prossimo salvataggio non lo ripeterebbe).
  const sulTesto = lavoro && lavoro.sourceHash === impronta ? lavoro : null;
  const senzaRisultato = lingueSenzaRisultato(
    evento.textTranslations,
    testoSorgente(principale, titoli, descrizioni),
    impronta
  );
  const nonRiuscitaPer = (code: string) =>
    !!sulTesto &&
    sulTesto.targetLanguages.includes(code) &&
    (sulTesto.status === 'FAILED' ||
      (sulTesto.status === 'DONE' && senzaRisultato(code)));

  const lingue: LinguaEvento[] = [
    principale,
    ...dellEvento.filter((l) => l !== principale),
    ...conTesto.filter((l) => !dellEvento.includes(l)),
  ].map((code) => {
    const s = stato[code];
    const conIlTesto = haTesto(code, titoli, descrizioni);
    const current = !s || s.sourceHash === impronta;
    const inTraduzione = aperto?.targetLanguages.includes(code) ?? false;
    const nonRiuscita = nonRiuscitaPer(code);
    const page = code === principale || attive.includes(code);
    const state = statoLingua({
      principale: code === principale,
      conTesto: conIlTesto,
      origine: conIlTesto ? (s?.origin ?? null) : null,
      aggiornata: current,
      // Si traducono solo le lingue della pagina: quelle dell'evento attive sul
      // sito (le altre valgono per sottotitoli e sintesi, o hanno solo un testo).
      motore: motore && page && dellEvento.includes(code),
      inTraduzioneDaMs: inTraduzione
        ? ora.getTime() - new Date(aperto!.createdAt).getTime()
        : null,
      fallita: nonRiuscita,
    });
    return {
      code,
      page,
      event: code === principale || dellEvento.includes(code),
      state,
      origin: conIlTesto ? (s?.origin ?? null) : null,
      current,
      ...(s?.at ? { at: s.at } : {}),
      ...(state === 'failed'
        ? {
            failure:
              sulTesto?.status === 'FAILED' && sulTesto.errorCode === 'MT_UNAVAILABLE'
                ? ('MT_UNAVAILABLE' as const)
                : ('GENERIC' as const),
          }
        : {}),
    };
  });

  const altre = (testi: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(testi).filter(([l, v]) => l !== principale && !!v?.trim())
    );
  return {
    engine: motore ? 'available' : 'off',
    principale,
    lingue,
    job: lavoro
      ? {
          status: lavoro.status,
          createdAt: new Date(lavoro.createdAt).toISOString(),
          completedAt: lavoro.completedAt
            ? new Date(lavoro.completedAt).toISOString()
            : null,
          errorCode: lavoro.errorCode,
          targetLanguages: lavoro.targetLanguages,
        }
      : null,
    testi: { title: altre(titoli), description: altre(descrizioni) },
  };
}
