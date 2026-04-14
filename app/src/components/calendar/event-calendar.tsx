'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button, Icon, Spinner } from 'design-react-kit';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg } from '@fullcalendar/core';

import { useRouter } from '@/i18n/navigation';

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  DRAFT: { bg: '#E9ECEF', border: '#5A768A', text: '#5A768A' },
  PUBLISHED: { bg: '#E8F0FE', border: '#0066CC', text: '#0066CC' },
  LIVE: { bg: '#D4EDDA', border: '#008758', text: '#008758' },
  ENDED: { bg: '#FFF3CD', border: '#A66300', text: '#A66300' },
  ARCHIVED: { bg: '#E9ECEF', border: '#6C757D', text: '#6C757D' },
};

type ViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'multiMonthYear' | 'listMonth';

interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  start: string;
  end: string;
  status: string;
  eventType: string;
  registrationCount?: number;
}

interface EventCalendarProps {
  mode: 'admin' | 'public';
  initialEvents?: CalendarEvent[];
}

export default function EventCalendar({ mode, initialEvents = [] }: EventCalendarProps) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);

  const [currentView, setCurrentView] = useState<ViewType>('dayGridMonth');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [headerTitle, setHeaderTitle] = useState('');

  const fetchEvents = useCallback(async (start: string, end: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start, end, mode });
      const res = await fetch(`/api/events/calendar?${params}`);
      if (res.ok) {
        const data: CalendarEvent[] = await res.json();
        setEvents(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setHeaderTitle(arg.view.title);
    fetchEvents(arg.startStr, arg.endStr);
  }, [fetchEvents]);

  const handleEventClick = useCallback((info: EventClickArg) => {
    const evt = info.event;
    const slug = evt.extendedProps.slug as string;
    if (mode === 'admin') {
      router.push(`/admin/events/${evt.id}?token=`);
    } else {
      router.push(`/events/${slug}`);
    }
  }, [mode, router]);

  const defaultColors = { bg: '#E9ECEF', border: '#5A768A', text: '#5A768A' };

  const calendarEvents: EventInput[] = events.map((evt) => {
    const colors = STATUS_COLORS[evt.status] ?? defaultColors;
    return {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      extendedProps: {
        slug: evt.slug,
        status: evt.status,
        eventType: evt.eventType,
        registrationCount: evt.registrationCount,
      },
    };
  });

  const changeView = useCallback((view: ViewType) => {
    setCurrentView(view);
    calendarRef.current?.getApi().changeView(view);
  }, []);

  const goToday = useCallback(() => {
    calendarRef.current?.getApi().today();
  }, []);

  const goPrev = useCallback(() => {
    calendarRef.current?.getApi().prev();
  }, []);

  const goNext = useCallback(() => {
    calendarRef.current?.getApi().next();
  }, []);

  useEffect(() => {
    const cal = calendarRef.current?.getApi();
    if (cal) setHeaderTitle(cal.view.title);
  }, []);

  const viewButtons: { view: ViewType; label: string }[] = [
    { view: 'timeGridDay', label: t('views.day') },
    { view: 'timeGridWeek', label: t('views.week') },
    { view: 'dayGridMonth', label: t('views.month') },
    { view: 'multiMonthYear', label: t('views.year') },
    { view: 'listMonth', label: t('views.list') },
  ];

  return (
    <div className="event-calendar">
      {/* Custom toolbar */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <Button
            color="primary"
            outline
            size="xs"
            onClick={goToday}
            className="px-3"
          >
            {t('today')}
          </Button>
          <div className="btn-group">
            <Button color="link" size="xs" onClick={goPrev} aria-label={t('prev')}>
              <Icon icon="it-arrow-left" size="sm" />
            </Button>
            <Button color="link" size="xs" onClick={goNext} aria-label={t('next')}>
              <Icon icon="it-arrow-right" size="sm" />
            </Button>
          </div>
          <h5 className="mb-0 fw-semibold" style={{ color: '#17324D', fontSize: '1.1rem' }}>
            {headerTitle}
          </h5>
          {loading && <Spinner active small className="ms-2" />}
        </div>

        <div className="btn-group">
          {viewButtons.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              className={`btn btn-sm ${
                currentView === view
                  ? 'btn-primary'
                  : 'btn-outline-secondary'
              }`}
              onClick={() => changeView(view)}
              style={{ fontSize: '0.78rem', padding: '4px 10px' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'admin' && (
        <div className="d-flex flex-wrap gap-2 mb-3" style={{ fontSize: '0.75rem' }}>
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <span
              key={status}
              className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded-1"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              <span
                className="rounded-circle d-inline-block"
                style={{ width: 8, height: 8, backgroundColor: colors.border }}
              />
              {t(`status.${status}`)}
            </span>
          ))}
        </div>
      )}

      {/* FullCalendar */}
      <div className="fc-bootstrap-italia">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, multiMonthPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={locale}
          firstDay={1}
          weekNumbers={true}
          weekNumberFormat={{ week: 'numeric' }}
          headerToolbar={false}
          height="auto"
          events={calendarEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          dayMaxEvents={3}
          moreLinkText={(n) => `+${n}`}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
          }}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          allDaySlot={false}
          nowIndicator={true}
          weekNumberClassNames="fc-week-number-cell"
          dayCellClassNames={(arg) => {
            const day = arg.date.getDay();
            return day === 0 || day === 6 ? 'fc-weekend-cell' : '';
          }}
          eventContent={(eventInfo) => {
            const { status, eventType } = eventInfo.event.extendedProps;
            const isInstant = eventType === 'INSTANT';
            return (
              <div
                className="d-flex align-items-center gap-1 px-1"
                style={{
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  fontSize: '0.78rem',
                  lineHeight: 1.3,
                  cursor: 'pointer',
                }}
              >
                {isInstant && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                )}
                {status === 'LIVE' && (
                  <span
                    className="rounded-circle d-inline-block flex-shrink-0"
                    style={{
                      width: 6,
                      height: 6,
                      backgroundColor: '#008758',
                      animation: 'pulse-dot 1.5s ease-in-out infinite',
                    }}
                  />
                )}
                <span className="text-truncate">
                  {eventInfo.timeText && (
                    <span className="fw-semibold me-1">{eventInfo.timeText}</span>
                  )}
                  {eventInfo.event.title}
                </span>
              </div>
            );
          }}
        />
      </div>

      {/* Custom CSS for Bootstrap Italia integration */}
      <style>{`
        .fc-bootstrap-italia {
          --fc-border-color: #d9dadb;
          --fc-today-bg-color: rgba(0, 102, 204, 0.04);
          --fc-event-border-color: transparent;
          --fc-page-bg-color: #fff;
          --fc-neutral-bg-color: #f8f9fa;
          --fc-list-event-hover-bg-color: rgba(0, 102, 204, 0.06);
          font-family: 'Titillium Web', sans-serif;
        }

        .fc-bootstrap-italia .fc-scrollgrid {
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #d9dadb;
        }

        .fc-bootstrap-italia .fc-col-header-cell {
          background-color: #f8f9fa;
          padding: 8px 4px;
          font-size: 0.82rem;
          font-weight: 600;
          color: #17324D;
          text-transform: capitalize;
        }

        .fc-bootstrap-italia .fc-daygrid-day-number {
          color: #17324D;
          font-size: 0.85rem;
          font-weight: 500;
          padding: 6px 8px;
        }

        .fc-bootstrap-italia .fc-weekend-cell {
          background-color: rgba(90, 118, 138, 0.03);
        }

        .fc-bootstrap-italia .fc-weekend-cell .fc-daygrid-day-number {
          color: #5A768A;
          opacity: 0.7;
        }

        .fc-bootstrap-italia .fc-week-number-cell {
          font-size: 0.68rem;
          color: #5A768A;
          opacity: 0.6;
        }

        .fc-bootstrap-italia .fc-daygrid-event {
          border-radius: 4px;
          padding: 1px 2px;
          margin: 1px 2px;
          border-left-width: 3px !important;
          border-left-style: solid !important;
        }

        .fc-bootstrap-italia .fc-daygrid-more-link {
          color: #0066CC;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .fc-bootstrap-italia .fc-timegrid-slot {
          height: 2.5em;
        }

        .fc-bootstrap-italia .fc-timegrid-slot-label {
          font-size: 0.75rem;
          color: #5A768A;
        }

        .fc-bootstrap-italia .fc-list-event:hover td {
          background-color: rgba(0, 102, 204, 0.06);
        }

        .fc-bootstrap-italia .fc-list-day-cushion {
          background-color: #f8f9fa;
          font-weight: 600;
          color: #17324D;
        }

        .fc-bootstrap-italia .fc-multimonth-title {
          font-size: 1rem;
          font-weight: 600;
          color: #17324D;
          text-transform: capitalize;
          padding: 8px;
        }

        .fc-bootstrap-italia .fc-multimonth-daygrid {
          font-size: 0.75rem;
        }

        .fc-bootstrap-italia .fc-day-today .fc-daygrid-day-number {
          background-color: #0066CC;
          color: #fff;
          border-radius: 50%;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fc-bootstrap-italia .fc-now-indicator-line {
          border-color: #CC334D;
        }

        .fc-bootstrap-italia .fc-now-indicator-arrow {
          border-color: #CC334D;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
