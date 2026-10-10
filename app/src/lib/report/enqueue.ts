/**
 * La richiesta del resoconto dell'evento, dallo staff dopo l'evento
 * (api/admin/events/[id]/report), e il suo salvataggio quando il worker lo
 * consegna (api/internal/event-report).
 *
 * Il lavoro REPORT sta nella coda della post-produzione: lo stesso
 * orchestratore accende vLLM quando serve e il worker senza GPU lo esegue.
 * A differenza degli altri lavori e' dell'evento (`eventId`), non di una
 * registrazione: un evento senza registrazione ne' trascrizione ha comunque
 * chat, sondaggi e valutazioni, e nessuna operazione su una registrazione
 * (annullare, cancellare, sostituire) tocca il resoconto.
 */
import type { Prisma } from '@prisma/client';

import { conservazioneFinita, registrazionePubblica } from '@/lib/captions/transcript';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { parseTargetLocales } from '@/lib/ai/providers';
import { languageCodeSchema, reportPayloadSchema } from '@/lib/ai/schemas';

import { normalizzaNarrativa } from './normalize';
import type { ReportMetrics, ReportNarrative, StoredReport } from './types';

export type EsitoRichiesta =
  | { stato: 'accodato'; jobId: string }
  | { stato: 'in-corso'; jobId: string }
  | { stato: 'non-concluso' }
  | { stato: 'scaduto' }
  | { stato: 'ai-spenta' }
  | { stato: 'evento-assente' };

/** I lavori del resoconto ancora da fare o in esecuzione. */
const IN_CORSO = {
  kind: 'REPORT',
  status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
} satisfies Prisma.PostprodJobWhereInput;

/**
 * La lingua del resoconto: quella della trascrizione mostrata nella pagina (la
 * lingua della registrazione, o quella rilevata nel testo), altrimenti della
 * registrazione piu' recente; l'italiano se non ce n'e'. La stessa per la
 * richiesta, il pannello e gli ingressi del modello.
 */
export async function linguaResoconto(
  eventId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  /** La registrazione mostrata nella pagina, se chi chiama l'ha gia' cercata. */
  pubblicaNota?: string | null
): Promise<string> {
  const pubblica =
    pubblicaNota !== undefined ? pubblicaNota : await registrazionePubblica(eventId, false, db);
  const registrazione = await db.recording.findFirst({
    where: pubblica ? { id: pubblica } : { eventId },
    orderBy: { createdAt: 'desc' },
    select: {
      sourceLanguage: true,
      artifacts: { where: { type: 'TRANSCRIPT_JSON', language: null }, select: { id: true }, take: 1 },
    },
  });
  if (registrazione?.sourceLanguage) return registrazione.sourceLanguage;
  const trascrizione = registrazione?.artifacts[0];
  if (trascrizione) {
    // Il testo si legge solo qui, quando la registrazione non dice la lingua.
    const corpo = await db.postprodArtifact.findUnique({
      where: { id: trascrizione.id },
      select: { inlineBody: true },
    });
    try {
      const rilevata = (JSON.parse(tryDecryptPII(corpo?.inlineBody ?? null) ?? '{}') as { language?: unknown })
        .language;
      const lingua = languageCodeSchema.safeParse(rilevata);
      if (lingua.success) return lingua.data;
    } catch {
      /* testo illeggibile: si resta sul default */
    }
  }
  return 'it';
}

/** L'ultimo lavoro del resoconto di un evento, per lo stato in amministrazione. */
export async function ultimoLavoroResoconto(eventId: string) {
  const lavoro = await prisma.postprodJob.findFirst({
    where: { kind: 'REPORT', eventId },
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
  // La lingua in cui il lavoro scrive: quella scelta alla richiesta.
  const letto = reportPayloadSchema.safeParse(payload);
  return { ...resto, sourceLanguage: letto.success ? letto.data.sourceLanguage : null };
}

/**
 * Accoda il resoconto. Solo a evento concluso, entro la conservazione dei dati
 * (chat, d'accordo e presenze si cancellano alla scadenza), con la pipeline AI
 * accesa, e uno alla volta per evento.
 */
export async function accodaResoconto(
  eventId: string,
  opzioni: { targetLanguages?: string[] } = {}
): Promise<EsitoRichiesta> {
  const [evento, impostazioni] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        endsAt: true,
        dataRetentionDays: true,
        aiTargetLocales: true,
      },
    }),
    prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    }),
  ]);
  if (!evento) return { stato: 'evento-assente' };
  if (evento.status !== 'ENDED') return { stato: 'non-concluso' };
  if (conservazioneFinita(evento, new Date())) return { stato: 'scaduto' };
  if (!impostazioni?.aiPipelineEnabled) return { stato: 'ai-spenta' };

  return prisma.$transaction(async (tx) => {
    // Uno alla volta: la seconda richiesta trova il lavoro della prima.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event-report:${eventId}`}))`;
    const inCorso = await tx.postprodJob.findFirst({
      where: { ...IN_CORSO, eventId },
      select: { id: true },
    });
    if (inCorso) return { stato: 'in-corso' as const, jobId: inCorso.id };
    // I lavori chiusi senza consegna tengono i numeri del loro tentativo: a
    // ogni nuova richiesta si tolgono, il resoconto e' uno solo.
    await tx.$executeRaw`
      UPDATE postprod_jobs SET payload = payload - 'metrics', updated_at = NOW()
      WHERE event_id = ${eventId}::uuid AND kind = 'REPORT' AND payload ? 'metrics'
    `;

    const sorgente = await linguaResoconto(eventId, tx);
    const destinazioni = (
      opzioni.targetLanguages ?? parseTargetLocales(evento.aiTargetLocales)
    ).filter((l, i, tutte) => l !== sorgente && tutte.indexOf(l) === i);
    const lavoro = await tx.postprodJob.create({
      data: {
        eventId,
        kind: 'REPORT',
        status: 'PENDING',
        payload: { eventId, sourceLanguage: sorgente, targetLanguages: destinazioni },
        idempotencyKey: `report:${eventId}:${Date.now()}`,
      },
      select: { id: true },
    });
    return { stato: 'accodato' as const, jobId: lavoro.id };
  });
}

/**
 * Il resoconto consegnato dal worker: il testo, normalizzato, per lingua, con
 * i numeri calcolati al claim (dal payload del lavoro, non dal worker). Un
 * resoconto nuovo non e' pubblicato finche' lo staff non lo rilegge.
 */
export async function salvaResoconto(opts: {
  eventId: string;
  sourceLanguage: string;
  metrics: ReportMetrics | null;
  narratives: Record<string, unknown>;
  modelId: string | null;
  modelVersion: string | null;
}): Promise<StoredReport | null> {
  const narrative: Record<string, ReportNarrative> = {};
  for (const [lingua, grezzo] of Object.entries(opts.narratives)) {
    if (!languageCodeSchema.safeParse(lingua).success) continue;
    const n = normalizzaNarrativa(grezzo);
    if (n) narrative[lingua] = n;
  }
  if (!narrative[opts.sourceLanguage]) return null;
  const resoconto: StoredReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceLanguage: opts.sourceLanguage,
    model: { id: opts.modelId, version: opts.modelVersion },
    metrics: opts.metrics,
    narratives: narrative,
  };
  await prisma.event.update({
    where: { id: opts.eventId },
    data: {
      postEventReport: resoconto as unknown as Prisma.InputJsonValue,
      postEventReportAt: new Date(),
      postEventReportPublished: false,
    },
  });
  return resoconto;
}

/** Il resoconto salvato, se ha la forma attesa. */
export function letturaResoconto(valore: unknown): StoredReport | null {
  if (!valore || typeof valore !== 'object') return null;
  const r = valore as Partial<StoredReport>;
  if (
    r.version !== 1 ||
    !r.narratives ||
    typeof r.narratives !== 'object' ||
    !r.sourceLanguage
  )
    return null;
  return r as StoredReport;
}
