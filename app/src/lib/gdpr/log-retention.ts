/**
 * Conservazione delle righe che non appartengono a un evento: la coda delle
 * email e il registro delle azioni privilegiate. La pulizia per evento non le
 * raggiunge, quindi senza queste regole restavano per sempre.
 *
 * I valori predefiniti si possono cambiare con una variabile d'ambiente: la
 * durata giusta la decide il titolare del trattamento di ogni installazione.
 */

/** Giorni dopo i quali un'email inviata o fallita esce dalla coda. */
export const EMAIL_OUTBOX_RETENTION_DAYS_DEFAULT = 30;

/** Giorni dopo i quali il registro audit perde IP, user agent e nomi. */
export const AUDIT_LOG_PERSONAL_DATA_RETENTION_DAYS_DEFAULT = 90;

function days(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export function emailOutboxRetentionDays(): number {
  return days('EMAIL_OUTBOX_RETENTION_DAYS', EMAIL_OUTBOX_RETENTION_DAYS_DEFAULT);
}

export function auditLogPersonalDataRetentionDays(): number {
  return days(
    'AUDIT_LOG_PERSONAL_DATA_RETENTION_DAYS',
    AUDIT_LOG_PERSONAL_DATA_RETENTION_DAYS_DEFAULT
  );
}

/** Giorni senza accesso dopo i quali un account dello staff viene disattivato. */
export const STAFF_INACTIVE_DEACTIVATE_DAYS_DEFAULT = 365;

/**
 * 0 spegne la disattivazione automatica: un'installazione che gestisce gli
 * account con le proprie procedure puo' non volerla.
 */
export function staffInactiveDeactivateDays(): number {
  const raw = process.env.STAFF_INACTIVE_DEACTIVATE_DAYS;
  if (raw !== undefined && raw.trim() === '0') return 0;
  return days('STAFF_INACTIVE_DEACTIVATE_DAYS', STAFF_INACTIVE_DEACTIVATE_DAYS_DEFAULT);
}

/** Le azioni del registro audit il cui dettaglio contiene nomi di persone. */
export const AUDIT_ACTIONS_WITH_NAMES = ['POSTPROD_SPEAKER_MAP'] as const;
