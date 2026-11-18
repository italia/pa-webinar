// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La deroga dell'amministrazione al contenuto di una registrazione, finche'
 * c'e' una richiesta di rimozione aperta su quella registrazione.
 *
 * Il contenuto di una registrazione (video, tracce, trascrizioni e quanto ne
 * deriva) e' di chi organizza l'evento. Quando una persona chiede di non
 * comparirvi, la richiesta va al titolare, e chi amministra l'istanza deve
 * poter vedere il video per togliere la persona: solo quella registrazione,
 * solo dall'editor di rimozione, solo finche' la richiesta e' aperta, e ogni
 * accesso resta nel registro delle operazioni con il nome dell'account.
 *
 * Chi chiama questa funzione e' l'editor di rimozione (le rotte sotto
 * api/admin/recording-removals). Una politica d'accesso piu' generale che la
 * consulti deve limitarne l'effetto alle stesse rotte: la deroga non apre la
 * pagina della registrazione ne' le altre rotte della post-produzione.
 */
import type { Prisma, RecordingRedactionStatus } from '@prisma/client';

import { logAdminAction } from '@/lib/audit/admin-audit';
import type { StaffSession } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';

type Db = Prisma.TransactionClient | typeof prisma;

/** Gli stati in cui una richiesta e' aperta, e la deroga vale. */
export const STATI_APERTI: readonly RecordingRedactionStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'PROCESSING',
];

export function richiestaAperta(status: RecordingRedactionStatus): boolean {
  return STATI_APERTI.includes(status);
}

/** La richiesta che giustifica l'accesso. */
export interface DerogaRimozione {
  requestId: string;
  recordingId: string;
  eventId: string;
  /** L'account che accede: la chiave dell'istanza non ha mai la deroga. */
  accountId: string;
}

/**
 * Se questa sessione dello staff puo' accedere al contenuto di questa
 * registrazione in forza di una richiesta di rimozione aperta su di essa.
 *
 * Vale solo per un amministratore con un account nominale: la chiave
 * dell'istanza non ha un nome, e un accesso in deroga deve averne uno. Con
 * `requestId` vale solo quella richiesta (l'editor lavora su una richiesta
 * alla volta); senza, una qualunque richiesta aperta sulla registrazione.
 * Null quando non c'e' deroga.
 */
export async function derogaPerRimozione(
  sessione: StaffSession | null,
  recordingId: string,
  opzioni: { requestId?: string; db?: Db } = {}
): Promise<DerogaRimozione | null> {
  if (!sessione || sessione.role !== 'admin' || !sessione.accountId) return null;
  const db = opzioni.db ?? prisma;
  const richiesta = await db.recordingRedactionRequest.findFirst({
    where: {
      recordingId,
      status: { in: [...STATI_APERTI] },
      ...(opzioni.requestId ? { id: opzioni.requestId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, recordingId: true, eventId: true },
  });
  if (!richiesta?.recordingId) return null;
  return {
    requestId: richiesta.id,
    recordingId: richiesta.recordingId,
    eventId: richiesta.eventId,
    accountId: sessione.accountId,
  };
}

/** Cosa si e' aperto in deroga: la pagina dell'editor, il video, la forma d'onda. */
export type RisorsaInDeroga = 'editor' | 'media' | 'waveform';

/**
 * Traccia un accesso in deroga nel registro delle operazioni dello staff: chi
 * (l'account), quale registrazione, per quale richiesta, che cosa. Nessun dato
 * della persona che ha chiesto la rimozione.
 */
export async function registraAccessoInDeroga(
  request: Request,
  deroga: DerogaRimozione,
  risorsa: RisorsaInDeroga
): Promise<void> {
  await logAdminAction({
    request,
    action: 'RECORDING_REDACTION_ACCESS',
    target: deroga.recordingId,
    details: { requestId: deroga.requestId, eventId: deroga.eventId, resource: risorsa },
    actor: `admin:${deroga.accountId}`,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per le rotte dell'editor: la richiesta, e la deroga che apre la sua
 * registrazione a questa sessione. 404 per una richiesta che non c'e' (o senza
 * registrazione), 403 senza deroga: la chiave dell'istanza, un account non
 * amministratore, una richiesta gia' chiusa.
 */
export async function richiestaInDeroga(
  sessione: StaffSession,
  requestId: string
): Promise<DerogaRimozione> {
  if (!UUID_RE.test(requestId)) throw new NotFoundError('Removal request');
  const richiesta = await prisma.recordingRedactionRequest.findUnique({
    where: { id: requestId },
    select: { recordingId: true },
  });
  if (!richiesta?.recordingId) throw new NotFoundError('Removal request');
  const deroga = await derogaPerRimozione(sessione, richiesta.recordingId, { requestId });
  if (!deroga) {
    throw new AppError(
      'Only a named administrator account can open this recording, and only while the removal request is open',
      403,
      'REDACTION_ACCESS_DENIED'
    );
  }
  return deroga;
}
