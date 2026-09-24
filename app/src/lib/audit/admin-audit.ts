import { createHash } from 'crypto';
import { jwtVerify } from 'jose';

import { prisma } from '@/lib/db';
import { getClientIp } from '@/lib/rate-limit';
import { tryGetAppSecret } from '@/lib/auth/app-secret';

/**
 * Append-only audit log for privileged admin actions. Every mutating
 * admin handler should call this so we can answer "who did what and
 * when" without depending on application logs (which rotate). Read-
 * only listings (GET /events, GET /registrations, ...) are explicitly
 * NOT recorded — that would explode the table without adding much
 * accountability beyond the access logs.
 *
 * Failures here are swallowed: an audit-log write must NOT block or
 * roll back the operation it accompanies. We surface the error in the
 * server log so it's still discoverable.
 */
export interface LogAdminActionInput {
  request: Request;
  action: string; // e.g. EVENT_CREATE, EVENT_UPDATE, RECORDING_DELETE
  target?: string | null;
  details?: Record<string, unknown> | null;
  /**
   * Chi agisce, quando la richiesta non lo porta ancora: all'accesso il
   * cookie della nuova sessione non c'e', e quello in arrivo puo' essere di
   * qualcun altro che ha usato lo stesso browser.
   */
  actor?: string;
}

/**
 * Chi ha agito. L'amministrazione dell'istanza e' una chiave condivisa, senza
 * persone: si registra un prefisso SHA-256 del cookie, che resta uguale per lo
 * stesso browser senza conservare nulla del token. L'organizzatore invece e'
 * un account (ADR-014), e si registra quello — `organizer:<id>` — cosi' «chi
 * ha fatto cosa» ha una risposta anche dopo i rinnovi della sessione, che
 * cambiano il cookie.
 */
async function deriveActor(request: Request): Promise<string> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  const cookieValue = m?.[1] ?? '';
  if (!cookieValue) return 'unknown';
  const secret = tryGetAppSecret();
  if (secret) {
    try {
      const { payload } = await jwtVerify(cookieValue, new TextEncoder().encode(secret));
      if (payload.role === 'organizer' && typeof payload.sub === 'string') {
        return `organizer:${payload.sub}`;
      }
    } catch {
      // Firma non valida o scaduta: resta l'impronta del cookie.
    }
  }
  return createHash('sha256').update(cookieValue).digest('hex').slice(0, 16);
}

export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  const { request, action } = input;
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorHash: input.actor ?? (await deriveActor(request)),
        action,
        target: input.target ?? null,
        ip: getClientIp(request),
        userAgent: request.headers.get('user-agent') ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  } catch (err) {
    // Never break the user-facing operation because of audit-log
    // failure. Log the error so it shows up in the structured logs.
    console.error('[admin-audit] failed to record action', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
