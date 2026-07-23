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
 *
 * Times are emitted as UTC instants (`…Z`), NOT as local times tagged with a
 * TZID. Setting `timezone` here used to produce
 *
 *     DTSTART;TZID=Europe/Rome:20260722T091500
 *
 * for an event starting at 09:15Z — the UTC wall clock relabelled as Rome time,
 * because ical-generator does not convert the Date and we ship no VTIMEZONE
 * component for the TZID to resolve against. Calendar clients therefore booked
 * the event two hours early in summer (one in winter). Verified on the DevIt
 * invitation before the fix.
 *
 * A UTC instant is unambiguous and needs no VTIMEZONE: every client renders it
 * in the reader's own zone, which is also what you want for an online event
 * whose audience is not necessarily in the organiser's country. `timezone`
 * stays on the input because callers use it to render the human-readable time
 * in the email body.
 */
export function generateEventICal(input: EventICalInput): string {
  const calendar = ical({
    name: input.title,
    method: ICalCalendarMethod.REQUEST,
    prodId: { company: 'PA Webinar', product: 'pa-webinar' },
  });

  calendar.createEvent({
    start: input.startsAt,
    end: input.endsAt,
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
