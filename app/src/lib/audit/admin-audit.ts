import { createHash } from 'crypto';

import { prisma } from '@/lib/db';
import { getClientIp } from '@/lib/rate-limit';

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
}

/**
 * Best-effort identifier for the admin session. The platform has no
 * per-admin accounts yet (single shared ADMIN_API_KEY); we derive a
 * short SHA-256 prefix of the session-cookie ciphertext so that the
 * same browser shows the same actorHash across actions, without ever
 * persisting any part of the JWT itself.
 */
function deriveActorHash(request: Request): string {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  const cookieValue = m?.[1] ?? '';
  if (!cookieValue) return 'unknown';
  return createHash('sha256').update(cookieValue).digest('hex').slice(0, 16);
}

export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  const { request, action } = input;
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorHash: deriveActorHash(request),
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
