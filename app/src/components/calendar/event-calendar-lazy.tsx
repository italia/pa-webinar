'use client';

import dynamic from 'next/dynamic';
import { Spinner } from 'design-react-kit';

import type { ComponentProps } from 'react';
import type EventCalendar from '@/components/calendar/event-calendar';

// FullCalendar pulls in ~7 plugins (~heavy). Load it client-only so those
// plugins are code-split into their own chunk and only fetched on the calendar
// route, instead of bundling into the shared client JS.
const EventCalendarInner = dynamic(
  () => import('@/components/calendar/event-calendar'),
  {
    ssr: false,
    loading: () => (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: 320 }}
      >
        <Spinner active />
      </div>
    ),
  },
);

export default function EventCalendarLazy(
  props: ComponentProps<typeof EventCalendar>,
) {
  return <EventCalendarInner {...props} />;
}
