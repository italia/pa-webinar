/**
 * La traduzione automatica di titolo e descrizione dell'evento: i lavori di
 * traduzione e cio' che succede quando il worker consegna.
 *
 * Il lavoro TRANSLATE_TEXT sta nella coda della post-produzione ma non usa
 * vLLM ne' la GPU: lo esegue il worker senza GPU chiamando il motore di
 * traduzione su CPU (postprod.mt nel chart, lib/ai/providers
 * resolveMtProvider), che l'orchestratore accende solo per questi lavori. E'
 * dell'evento, come il resoconto.
 *
 * Il lavoro lo chiede il server dopo ogni salvataggio dell'evento
 * (lib/text-translation/auto riconciliaTraduzioni), o lo staff con «Riprova»
 * (accodaTraduzioneTesti). Alla consegna il testo tradotto resta come
 * versione automatica (Event.textTranslations) e va in titolo e descrizione
 * solo nelle lingue vuote o gia' tradotte in automatico, mai sopra il testo
 * di una persona (applicaTraduzioni).
 */
import type { Prisma } from '@prisma/client';

import { resolveMtProvider } from '@/lib/ai/providers';
import { translateTextPayloadSchema } from '@/lib/ai/schemas';
import { prisma } from '@/lib/db';

import {
  letturaTraduzioni,
  normalizzaDescrizione,
  normalizzaTitolo,
  type TextTranslations,
} from './proposals';
import { improntaSorgente, testoSorgente, type TestoSorgente } from './source';
import {
  haTesto,
  letturaStatoTesti,
  linguaPrincipale,
  lingueDellEvento,
  lingueDellaPagina,
  testoTraducibile,
  type StatoTesti,
} from './stato-lingue';

type Db = Prisma.TransactionClient | typeof prisma;

/** Il motivo con cui si chiude un lavoro quando il motore su CPU non e'
 *  configurato (al claim e nel reclaim): chi lo mostra lo riconosce e dice
 *  la cosa nella lingua della pagina (errorCode MT_UNAVAILABLE). */
export const MOTIVO_MOTORE_ASSENTE =
  'The CPU translation engine is not configured (AI_MT_BASE_URL)';

export type EsitoRichiesta =
  | { stato: 'accodato'; jobId: string; lingue: string[] }
  /** Una traduzione dell'evento e' gia' in coda o in corso. */
  | { stato: 'in-corso'; jobId: string }
  /** Niente da tradurre: le lingue chieste hanno il testo di una persona, non
   *  sono lingue della pagina, o l'evento non si traduce. */
  | { stato: 'nessuna' }
  | { stato: 'senza-testo' }
  | { stato: 'evento-assente' }
  | { stato: 'ai-spenta' }
  | { stato: 'motore-assente' };

/** I lavori della traduzione dei testi ancora da fare o in esecuzione. */
export const TRADUZIONE_IN_CORSO = {
  kind: 'TRANSLATE_TEXT',
  status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
} satisfies Prisma.PostprodJobWhereInput;

/** La traduzione automatica c'e' nell'installazione: pipeline AI accesa e motore installato. */
export function traduzioneDisponibile(
  impostazioni: { aiPipelineEnabled?: boolean | null } | null
): boolean {
  return !!impostazioni?.aiPipelineEnabled && resolveMtProvider() !== null;
}

/** Il testo principale si puo' mandare al motore: c'e', e sta nei limiti del lavoro. */
export function sorgenteTraducibile(sorgente: TestoSorgente): boolean {
  return testoTraducibile(sorgente.title, sorgente.description);
}

/** L'ultimo lavoro di traduzione dei testi di un evento, per lo stato in amministrazione. */
export async function ultimoLavoroTraduzione(eventId: string, db: Db = prisma) {
  const lavoro = await db.postprodJob.findFirst({
    where: { kind: 'TRANSLATE_TEXT', eventId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      completedAt: true,
      payload: true,
    },
  });
  if (!lavoro) return null;
  const { payload, ...resto } = lavoro;
  const letto = translateTextPayloadSchema.safeParse(payload);
  return {
    ...resto,
    // Il motivo per chi legge: il testo grezzo e' in inglese, per il registro.
    errorCode:
      resto.lastError === MOTIVO_MOTORE_ASSENTE ? ('MT_UNAVAILABLE' as const) : null,
    sourceLanguage: letto.success ? letto.data.sourceLanguage : null,
    sourceHash: letto.success ? letto.data.sourceHash : null,
    targetLanguages: letto.success ? letto.data.targetLanguages : [],
  };
}

export type UltimoLavoro = NonNullable<
  Awaited<ReturnType<typeof ultimoLavoroTraduzione>>
>;

/** Il lucchetto dei lavori di traduzione di un evento: uno alla volta. */
export async function bloccaTraduzioniEvento(
  tx: Prisma.TransactionClient,
  eventId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event-text-translation:${eventId}`}))`;
}

/** Crea il lavoro TRANSLATE_TEXT del testo `sorgente` nelle `destinazioni`. */
export async function creaLavoroTraduzione(
  tx: Prisma.TransactionClient,
  opts: {
    eventId: string;
    sorgente: TestoSorgente;
    impronta: string;
    destinazioni: string[];
  }
): Promise<string> {
  const { eventId, sorgente, impronta, destinazioni } = opts;
  const payload = translateTextPayloadSchema.parse({
    eventId,
    sourceLanguage: sorgente.sourceLanguage,
    targetLanguages: destinazioni,
    title: sorgente.title,
    description: sorgente.description,
    sourceHash: impronta,
  });
  const lavoro = await tx.postprodJob.create({
    data: {
      eventId,
      kind: 'TRANSLATE_TEXT',
      status: 'PENDING',
      payload,
      idempotencyKey: `text-translation:${eventId}:${impronta}:${destinazioni.join(',')}:${Date.now()}`,
    },
    select: { id: true },
  });
  return lavoro.id;
}

/** Le lingue attive del sito (come il wizard). */
export function lingueAttive(valore: unknown): string[] {
  return Array.isArray(valore) && valore.length > 0
    ? valore.filter((l): l is string => typeof l === 'string')
    : ['it', 'en'];
}

/**
 * «Riprova»: la traduzione del testo principale salvato nelle `lingue`, fra
 * quelle della pagina (le lingue dell'evento attive sul sito) che sono vuote o
 * tradotte in automatico; mai sopra il testo di una persona. Non guarda i
 * lavori precedenti: e' la richiesta esplicita di riprovare. Niente per le
 * chiamate istantanee e gli eventi archiviati, come al salvataggio. Una
 * traduzione alla volta per evento: con un lavoro aperto non si accoda niente.
 */
export async function accodaTraduzioneTesti(
  eventId: string,
  richiesta: { lingue: string[] }
): Promise<EsitoRichiesta> {
  const impostazioni = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      aiPipelineEnabled: true,
      defaultLocale: true,
      availableLocales: true,
      aiDefaultTargetLocales: true,
    },
  });
  if (!impostazioni?.aiPipelineEnabled) return { stato: 'ai-spenta' };
  if (!resolveMtProvider()) return { stato: 'motore-assente' };
  const principale = linguaPrincipale(impostazioni);

  return prisma.$transaction(async (tx) => {
    await bloccaTraduzioniEvento(tx, eventId);
    const evento = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        description: true,
        textLocaleState: true,
        aiTargetLocales: true,
        eventType: true,
        status: true,
      },
    });
    if (!evento) return { stato: 'evento-assente' as const };
    if (evento.eventType === 'INSTANT' || evento.status === 'ARCHIVED')
      return { stato: 'nessuna' as const };
    const inCorso = await tx.postprodJob.findFirst({
      where: { ...TRADUZIONE_IN_CORSO, eventId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (inCorso) return { stato: 'in-corso' as const, jobId: inCorso.id };

    const titoli = (evento.title ?? {}) as Record<string, string>;
    const descrizioni = (evento.description ?? {}) as Record<string, string>;
    const sorgente = testoSorgente(principale, titoli, descrizioni);
    if (!sorgenteTraducibile(sorgente)) return { stato: 'senza-testo' as const };
    const stato = letturaStatoTesti(evento.textLocaleState);
    const pagina = lingueDellaPagina(
      lingueDellEvento(evento.aiTargetLocales, impostazioni.aiDefaultTargetLocales),
      lingueAttive(impostazioni.availableLocales),
      principale
    );
    const destinazioni = [...new Set(richiesta.lingue)]
      .filter(
        (l) =>
          pagina.includes(l) &&
          (!haTesto(l, titoli, descrizioni) || stato[l]?.origin === 'MACHINE')
      )
      .sort();
    if (destinazioni.length === 0) return { stato: 'nessuna' as const };
    const jobId = await creaLavoroTraduzione(tx, {
      eventId,
      sorgente,
      impronta: improntaSorgente(sorgente),
      destinazioni,
    });
    return { stato: 'accodato' as const, jobId, lingue: destinazioni };
  });
}

/**
 * La traduzione consegnata dal worker, normalizzata, come versione automatica
 * (Event.textTranslations). Se la versione salvata viene dallo stesso testo di
 * partenza, le lingue nuove si aggiungono a quelle che c'erano; altrimenti la
 * sostituiscono (veniva da un altro testo). Titolo e descrizione li scrive
 * applicaTraduzioni.
 */
export async function salvaTraduzioni(
  opts: {
    eventId: string;
    sourceLanguage: string;
    sourceHash: string;
    sourceTitle: string;
    title: Record<string, string>;
    description: Record<string, string>;
    modelId: string | null;
    modelVersion: string | null;
  },
  db: Db = prisma
): Promise<TextTranslations | null> {
  const evento = await db.event.findUnique({
    where: { id: opts.eventId },
    select: { textTranslations: true },
  });
  if (!evento) return null;
  const titoli: Record<string, string> = {};
  for (const [lingua, testo] of Object.entries(opts.title)) {
    const t = normalizzaTitolo(testo, opts.sourceTitle);
    if (t) titoli[lingua] = t;
  }
  const descrizioni: Record<string, string> = {};
  for (const [lingua, testo] of Object.entries(opts.description)) {
    const d = normalizzaDescrizione(testo);
    if (d) descrizioni[lingua] = d;
  }
  const salvata = letturaTraduzioni(evento.textTranslations);
  const prima = salvata?.sourceHash === opts.sourceHash ? salvata : null;
  const proposta: TextTranslations = {
    version: 1,
    sourceLanguage: opts.sourceLanguage,
    sourceHash: opts.sourceHash,
    generatedAt: new Date().toISOString(),
    model: { id: opts.modelId, version: opts.modelVersion },
    title: { ...prima?.title, ...titoli },
    description: { ...prima?.description, ...descrizioni },
  };
  await db.event.update({
    where: { id: opts.eventId },
    data: { textTranslations: proposta as unknown as Prisma.InputJsonValue },
  });
  return proposta;
}

export interface EsitoApplicazione {
  /** Le lingue il cui titolo e la cui descrizione sono stati scritti. */
  applicate: string[];
  /** Il testo principale e' cambiato dopo la richiesta: niente e' stato scritto. */
  superata: boolean;
}

/**
 * La traduzione consegnata in titolo e descrizione dell'evento, nella stessa
 * transazione che chiude il lavoro. Solo se il testo principale e' ancora
 * quello tradotto (altrimenti resta solo come versione automatica, e chi
 * chiama ne chiede un'altra); solo nelle lingue chieste che sono ancora lingue
 * della pagina (una lingua tolta dall'evento nel frattempo non torna) e che
 * sono vuote o tradotte in automatico, mai sopra il testo di una persona. Una
 * lingua si scrive solo intera: se manca il titolo o la descrizione che il
 * testo principale ha, resta com'e'.
 */
export async function applicaTraduzioni(
  opts: {
    eventId: string;
    sourceLanguage: string;
    sourceHash: string;
    targetLanguages: readonly string[];
    proposta: TextTranslations;
    modelId: string | null;
  },
  db: Prisma.TransactionClient
): Promise<EsitoApplicazione> {
  // La riga resta bloccata fino alla fine della transazione: un salvataggio
  // del wizard nello stesso momento aspetta, e poi la ritrova.
  await db.$queryRaw`SELECT id FROM events WHERE id = ${opts.eventId}::uuid FOR NO KEY UPDATE`;
  const [evento, impostazioni] = await Promise.all([
    db.event.findUnique({
      where: { id: opts.eventId },
      select: {
        title: true,
        description: true,
        textLocaleState: true,
        aiTargetLocales: true,
      },
    }),
    db.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { availableLocales: true, aiDefaultTargetLocales: true },
    }),
  ]);
  if (!evento) return { applicate: [], superata: false };
  const pagina = lingueDellaPagina(
    lingueDellEvento(evento.aiTargetLocales, impostazioni?.aiDefaultTargetLocales),
    lingueAttive(impostazioni?.availableLocales),
    opts.sourceLanguage
  );
  const titoli = { ...((evento.title ?? {}) as Record<string, string>) };
  const descrizioni = { ...((evento.description ?? {}) as Record<string, string>) };
  const sorgente = testoSorgente(opts.sourceLanguage, titoli, descrizioni);
  if (improntaSorgente(sorgente) !== opts.sourceHash)
    return { applicate: [], superata: true };

  const stato: StatoTesti = letturaStatoTesti(evento.textLocaleState);
  const ora = new Date().toISOString();
  const applicate: string[] = [];
  for (const l of new Set(opts.targetLanguages)) {
    if (!pagina.includes(l)) continue;
    if (haTesto(l, titoli, descrizioni) && stato[l]?.origin !== 'MACHINE') continue;
    const titolo = opts.proposta.title[l]?.trim() ?? '';
    const descrizione = opts.proposta.description[l]?.trim() ?? '';
    if ((sorgente.title && !titolo) || (sorgente.description && !descrizione)) continue;
    if (!titolo && !descrizione) continue;
    if (sorgente.title) titoli[l] = opts.proposta.title[l]!;
    else delete titoli[l];
    if (sorgente.description) descrizioni[l] = opts.proposta.description[l]!;
    else delete descrizioni[l];
    stato[l] = {
      origin: 'MACHINE',
      sourceHash: opts.sourceHash,
      at: ora,
      ...(opts.modelId ? { model: opts.modelId } : {}),
    };
    applicate.push(l);
  }
  if (applicate.length > 0) {
    await db.event.update({
      where: { id: opts.eventId },
      data: {
        title: titoli,
        description: descrizioni,
        textLocaleState: stato as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { applicate: applicate.sort(), superata: false };
}
