/**
 * iCal generation for event invitations.
 * Attached to confirmation and reminder emails.
 */

import ical, { ICalCalendarMethod } from 'ical-generator';

interface EventICalInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  url: string;
  organizerName: string;
  organizerEmail: string;
}

/**
 * Generate an iCal (.ics) string for an event.
 */
export function generateEventICal(input: EventICalInput): string {
  const calendar = ical({
    name: input.title,
    method: ICalCalendarMethod.REQUEST,
    prodId: { company: 'PA Webinar', product: 'pa-webinar' },
    timezone: input.timezone,
  });

  calendar.createEvent({
    start: input.startsAt,
    end: input.endsAt,
    timezone: input.timezone,
    summary: input.title,
    description: input.description,
    url: input.url,
    organizer: {
      name: input.organizerName,
      email: input.organizerEmail,
    },
  });

  return calendar.toString();
}
