import type { Event, EventStatus, Registration } from '@prisma/client';

/**
 * Event as returned by public API (no moderator token or internal IDs exposed).
 */
export interface PublicEvent {
  id: string;
  slug: string;
  title: string; // resolved from titleIt/titleEn based on locale
  description: string; // resolved from descriptionIt/descriptionEn based on locale
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  qaEnabled: boolean;
  recordingEnabled: boolean;
  status: EventStatus;
  recordingUrl: string | null;
}

/**
 * Event as seen by moderator (includes management data).
 */
export interface ModeratorEvent extends PublicEvent {
  chatEnabled: boolean;
  moderatorToken: string;
  moderatorName: string | null;
  moderatorEmail: string | null;
  jitsiRoomName: string;
  dataRetentionDays: number;
  privacyPolicyUrl: string | null;
  registrations: Pick<Registration, 'id' | 'displayName' | 'joinedAt' | 'createdAt'>[];
}

/**
 * Role of the current user in the event context.
 */
export type EventRole = 'moderator' | 'participant' | 'anonymous';

export type { Event, EventStatus };
