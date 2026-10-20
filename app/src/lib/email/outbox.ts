/**
 * Email outbox — durable queue for outgoing emails.
 *
 * Producers call `enqueueEmail` (a single DB INSERT). The cron
 * `/api/cron/email-outbox` drains PENDING rows with FOR UPDATE SKIP
 * LOCKED, sends them via the SMTP pool, and retries with exponential
 * backoff on failure.
 */

import { Prisma } from '@prisma/client';

import { encryptJSON, encryptPII, tryDecryptJSON } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

export interface EmailAttachment {
  filename: string;
  // nodemailer accepts utf8 strings for text attachments and base64
  // via `encoding: 'base64'` for binary. We persist the string as-is
  // in JSONB and re-hydrate at send time.
  content: string;
  contentType: string;
}

/**
 * Un invito di calendario (iCalendar) da spedire come parte alternativa
 * `text/calendar; method=…` del messaggio, piu' l'allegato `.ics`: e' la forma
 * che Gmail e Outlook riconoscono come invito (lib/ical/invitation).
 */
export interface EmailCalendarInvite {
  method: 'REQUEST';
  content: string;
}

export interface EnqueueEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  calendarInvite?: EmailCalendarInvite;
  // Free-form metadata — e.g. { kind: 'confirmation', registrationId }
  // — kept purely for audit/debug; the processor never reads it.
  metadata?: Record<string, unknown>;
  // Email da spedire una volta sola: con la stessa chiave, una seconda
  // richiesta non accoda nulla (vedi enqueueEmailOnce).
  dedupKey?: string;
}

export async function enqueueEmail(input: EnqueueEmailInput): Promise<string> {
  // toAddress, html and text are encrypted at rest so a database dump
  // or admin SELECT doesn't leak the recipient list, the personalized
  // greeting, or magic-link tokens embedded in the body. The cron
  // processor decrypts before handing the row to nodemailer.
  //
  // `subject` is intentionally left in plaintext: it's almost always
  // just the event title (already public on the event page) and
  // keeping it readable makes operational triage (DB queries, log
  // scans, the FAILED row inspector in the admin panel) much easier.
  const row = await prisma.emailOutbox.create({
    data: {
      toAddress: encryptPII(input.to),
      subject: input.subject,
      html: encryptPII(input.html),
      text: input.text != null ? encryptPII(input.text) : null,
      attachments: packOutboxParts(input),
      metadata: input.metadata
        ? (input.metadata as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      dedupKey: input.dedupKey ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Allegati e invito di calendario come si salvano nella colonna `attachments`.
 *
 * Con un invito la colonna e' cifrata (`{ enc }`, come encryptJSON): l'invito
 * porta l'indirizzo di chi lo riceve e il suo link personale, che a riposo
 * stanno cifrati come il corpo dell'email. Senza invito resta l'elenco in
 * chiaro di sempre. Un processo della versione precedente che legge una riga
 * cifrata non vede un elenco e spedisce l'email senza allegati, invece di
 * allegare testo cifrato.
 */
export function packOutboxParts(
  input: Pick<EnqueueEmailInput, 'attachments' | 'calendarInvite'>,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const attachments = input.attachments?.length ? input.attachments : undefined;
  if (input.calendarInvite) {
    return encryptJSON({ attachments: attachments ?? [], calendarInvite: input.calendarInvite });
  }
  return attachments ? (attachments as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
}

function isAttachment(v: unknown): v is EmailAttachment {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.filename === 'string' &&
    typeof a.content === 'string' &&
    typeof a.contentType === 'string'
  );
}

/**
 * L'inverso di packOutboxParts: legge sia le righe in chiaro (un elenco di
 * allegati) sia quelle cifrate. Una forma che non si riconosce non blocca
 * l'invio: l'email parte senza le parti che non si leggono.
 */
export function unpackOutboxParts(stored: unknown): {
  attachments?: EmailAttachment[];
  calendarInvite?: EmailCalendarInvite;
} {
  const valore = tryDecryptJSON<unknown>(stored);
  if (Array.isArray(valore)) {
    const attachments = valore.filter(isAttachment);
    return attachments.length ? { attachments } : {};
  }
  if (typeof valore !== 'object' || valore === null) return {};
  if ('enc' in valore) {
    // Cifrato ma illeggibile: l'email parte senza, ma resta traccia (senza dati).
    console.warn('[email] outbox attachments unreadable, sending without them');
    return {};
  }
  const v = valore as { attachments?: unknown; calendarInvite?: unknown };
  const attachments = Array.isArray(v.attachments) ? v.attachments.filter(isAttachment) : [];
  const invito = v.calendarInvite as Partial<EmailCalendarInvite> | undefined;
  const calendarInvite =
    invito && invito.method === 'REQUEST' && typeof invito.content === 'string'
      ? { method: invito.method, content: invito.content }
      : undefined;
  return {
    ...(attachments.length ? { attachments } : {}),
    ...(calendarInvite ? { calendarInvite } : {}),
  };
}

/**
 * La colonna `attachments` senza l'invito di calendario, oppure null se non
 * c'e' un invito da togliere. Serve quando cambia l'indirizzo di una riga in
 * coda: l'invito porta il vecchio indirizzo (ATTENDEE e UID), e mandarlo al
 * nuovo darebbe una voce intestata ad altri. Le email successive portano
 * l'invito giusto.
 */
export function stripCalendarInvite(
  stored: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | null {
  const parti = unpackOutboxParts(stored);
  if (!parti.calendarInvite) return null;
  return packOutboxParts({ attachments: parti.attachments });
}

/**
 * Come enqueueEmail, ma una volta sola per `dedupKey`: se una riga con la
 * stessa chiave esiste già (anche spedita da tempo), non accoda e restituisce
 * false. Il controllo è l'indice unico della colonna, quindi regge anche due
 * richieste concorrenti.
 */
export async function enqueueEmailOnce(
  input: EnqueueEmailInput & { dedupKey: string },
): Promise<boolean> {
  try {
    await enqueueEmail(input);
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}

/**
 * Exponential backoff schedule. attempts is the NEW attempts value
 * after the failure (i.e. 1 on first failure). After MAX_ATTEMPTS the
 * row transitions to FAILED.
 */
export function nextAttemptDelayMs(attempts: number): number {
  // attempts=1 → 1 min, 2 → 5 min, 3 → 30 min, 4 → 2h, 5 → 12h.
  const delaysMin = [1, 5, 30, 120, 720];
  const idx = Math.min(attempts - 1, delaysMin.length - 1);
  return delaysMin[idx]! * 60_000;
}

export const MAX_EMAIL_OUTBOX_ATTEMPTS = 6;
