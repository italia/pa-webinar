/**
 * La traduzione automatica di titolo e descrizione dell'evento: la richiesta
 * dello staff (api/admin/events/[id]/text-translation) e il salvataggio della
 * proposta quando il worker la consegna (api/internal/event-text-translation).
 *
 * Il lavoro TRANSLATE_TEXT sta nella coda della post-produzione ma non usa
 * vLLM ne' la GPU: lo esegue il worker senza GPU chiamando il motore di
 * traduzione su CPU (postprod.mt nel chart, lib/ai/providers
 * resolveMtProvider), che l'orchestratore accende solo per questi lavori. E'
 * dell'evento, come il resoconto, e il risultato e' una proposta
 * (Event.textTranslations): titolo e descrizione dell'evento non cambiano
 * finche' qualcuno non la rilegge e la salva nel wizard.
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
import { improntaSorgente, type TestoSorgente } from './source';

type Db = Prisma.TransactionClient | typeof prisma;

/** Il motivo con cui si chiude un lavoro quando il motore su CPU non e'
 *  configurato (al claim e nel reclaim): chi lo mostra lo riconosce e dice
 *  la cosa nella lingua della pagina (errorCode MT_UNAVAILABLE). */
export const MOTIVO_MOTORE_ASSENTE = 'The CPU translation engine is not configured (AI_MT_BASE_URL)';

export type EsitoRichiesta =
  | { stato: 'accodato'; jobId: string }
  /** Una traduzione dell'evento e' gia' in coda o in corso (anche di un altro testo). */
  | { stato: 'in-corso'; jobId: string; sourceHash: string | null }
  /** La proposta per questo testo e queste lingue c'e' gia'. */
  | { stato: 'pronto' }
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

/** L'ultimo lavoro di traduzione dei testi di un evento, per lo stato in amministrazione. */
export async function ultimoLavoroTraduzione(eventId: string) {
  const lavoro = await prisma.postprodJob.findFirst({
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
    errorCode: resto.lastError === MOTIVO_MOTORE_ASSENTE ? ('MT_UNAVAILABLE' as const) : null,
    sourceLanguage: letto.success ? letto.data.sourceLanguage : null,
    sourceHash: letto.success ? letto.data.sourceHash : null,
    targetLanguages: letto.success ? letto.data.targetLanguages : [],
  };
}

/** La proposta salvata copre gia' queste lingue per questo testo. */
function giaTradotto(
  proposta: TextTranslations | null,
  sorgente: TestoSorgente,
  impronta: string,
  lingue: string[]
) {
  if (!proposta || proposta.sourceHash !== impronta) return false;
  return lingue.every(
    (l) =>
      (!sorgente.title || !!proposta.title[l]) &&
      (!sorgente.description || !!proposta.description[l])
  );
}

/**
 * Accoda la traduzione del testo di partenza (quello del modulo, anche non
 * salvato) nelle `lingue`. Le lingue le controlla chi chiama (quelle attive
 * dell'istanza, senza la lingua di partenza). Una alla volta per evento: la
 * seconda richiesta trova il lavoro della prima. La stessa richiesta con una
 * proposta gia' pronta non accoda niente.
 */
export async function accodaTraduzioneTesti(
  eventId: string,
  sorgente: TestoSorgente,
  lingue: string[]
): Promise<EsitoRichiesta> {
  const [evento, impostazioni] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { id: true } }),
    prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    }),
  ]);
  if (!evento) return { stato: 'evento-assente' };
  if (!impostazioni?.aiPipelineEnabled) return { stato: 'ai-spenta' };
  if (!resolveMtProvider()) return { stato: 'motore-assente' };

  const destinazioni = [...new Set(lingue)]
    .filter((l) => l !== sorgente.sourceLanguage)
    .sort();
  const impronta = await improntaSorgente(sorgente);
  if (!impronta) throw new Error('Web Crypto is not available');

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event-text-translation:${eventId}`}))`;
    const inCorso = await tx.postprodJob.findFirst({
      where: { ...TRADUZIONE_IN_CORSO, eventId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    if (inCorso) {
      const letto = translateTextPayloadSchema.safeParse(inCorso.payload);
      return {
        stato: 'in-corso' as const,
        jobId: inCorso.id,
        sourceHash: letto.success ? letto.data.sourceHash : null,
      };
    }
    const salvato = await tx.event.findUnique({
      where: { id: eventId },
      select: { textTranslations: true },
    });
    if (
      giaTradotto(
        letturaTraduzioni(salvato?.textTranslations),
        sorgente,
        impronta,
        destinazioni
      )
    ) {
      return { stato: 'pronto' as const };
    }
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
    return { stato: 'accodato' as const, jobId: lavoro.id };
  });
}

/**
 * La proposta consegnata dal worker, normalizzata, sull'evento. Se la
 * proposta salvata viene dallo stesso testo di partenza, le lingue nuove si
 * aggiungono a quelle che c'erano; altrimenti la sostituiscono (veniva da un
 * altro testo). Titolo e descrizione dell'evento non si toccano.
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
