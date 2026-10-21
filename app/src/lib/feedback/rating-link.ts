import { issueScopedLinkToken, verifyScopedLinkToken } from '@/lib/auth/scoped-link';

/**
 * Il link della valutazione nell'email di ringraziamento: un token firmato che
 * serve solo a valutare un evento come una certa iscrizione (lib/auth/scoped-link).
 * Chi lo riceve inoltrato puo' al massimo spendere quella valutazione, una
 * volta. Non scade: la finestra della valutazione la decide l'evento
 * (feedbackOpen).
 */

const SCOPO = 'valutazione|';

export function issueRatingToken(eventId: string, registrationId: string): string | null {
  return issueScopedLinkToken(SCOPO, eventId, registrationId);
}

/** L'iscrizione del link, se il token e' valido e di questo evento. */
export function verifyRatingToken(token: string, eventId: string): string | null {
  return verifyScopedLinkToken(SCOPO, token, eventId);
}
