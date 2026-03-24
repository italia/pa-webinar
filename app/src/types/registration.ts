import type { Registration } from '@prisma/client';

/**
 * Registration confirmation (returned after successful registration).
 */
export interface RegistrationConfirmation {
  id: string;
  displayName: string;
  eventSlug: string;
  eventTitle: string;
  accessToken: string;
  joinUrl: string;
}

/**
 * Registration session — stored in the participant's browser (cookie or URL param).
 */
export interface RegistrationSession {
  registrationId: string;
  eventSlug: string;
  displayName: string;
  accessToken: string;
  role: 'participant';
}

/**
 * Moderator session — derived from the moderator magic link.
 */
export interface ModeratorSession {
  eventId: string;
  eventSlug: string;
  moderatorToken: string;
  displayName: string;
  role: 'moderator';
}

export type UserSession = RegistrationSession | ModeratorSession;

export type { Registration };
